import type { InputStats } from "@/core/types";
import { backend, type InputKeyEvent, type InputMouseSample } from "@/core/backend";
import { useSettings } from "@/core/state/settings";
import { useSignals } from "@/core/lighting/signals";
import { useDevices, primaryMouse } from "@/core/devices/store";
import { loadJson, saveJsonDebounced } from "@/core/state/persist";
import { isKeyRemapped } from "@/core/keymaps/store";
import { acquireInputListening } from "./input";
import { dayKey, emptyStats, isPrintableCode, pixelsToMeters, RollingRate, wpmFromChars } from "./metrics";
import { clearHooks, emptyLifetime, useStats, type BatterySample, type LifetimeStats } from "./store";
import { seedBattery, seedDay, seedLifetime } from "./seed";

const TICK_MS = 250;
const SAVE_MS = 5_000;
const BATTERY_EVERY_MS = 5 * 60_000;
const BATTERY_KEEP_MS = 7 * 86_400_000;

let started = false;

/** Called once at startup (see src/core/init.ts). */
export async function init(): Promise<void> {
  if (started) return;
  started = true;
  const mock = backend.kind === "mock";

  // --- Load persisted state ------------------------------------------------------------------
  let today: InputStats = (await loadJson<InputStats>(`stats/${dayKey()}.json`)) ?? emptyStats(dayKey());
  let lifetime: LifetimeStats = (await loadJson<LifetimeStats>("stats/lifetime.json")) ?? emptyLifetime();
  let battery: BatterySample[] = (await loadJson<BatterySample[]>("stats/battery.json")) ?? [];
  if (mock) {
    // Browser demo: make the dashboard look lived-in (never persisted as real data).
    if (today.keys === 0) today = { ...seedDay(today.day), keys: Math.round(seedDay(today.day).keys * 0.4) };
    if (lifetime.keys === 0) lifetime = seedLifetime(dayKey(new Date(Date.now() - 120 * 86_400_000)));
    if (battery.length === 0) battery = seedBattery("demo-mouse", "Demo wireless mouse");
  }
  useStats.setState({ today: { ...today }, lifetime: { ...lifetime }, battery });

  clearHooks.add(() => {
    const s = useStats.getState();
    today = { ...s.today, perKey: {} };
    lifetime = { ...s.lifetime };
    battery = [];
  });

  const save = () => {
    saveJsonDebounced(`stats/${today.day}.json`, today, SAVE_MS);
    saveJsonDebounced("stats/lifetime.json", lifetime, SAVE_MS);
  };

  // --- Live rates -------------------------------------------------------------------------------
  const chars = new RollingRate(10_000);
  const actions = new RollingRate(10_000);
  let pointerSpeed = 10;
  const refreshPointer = () =>
    backend
      .pointerGet()
      .then((p) => (pointerSpeed = p.speed || 10))
      .catch(() => {});
  refreshPointer();
  setInterval(refreshPointer, 10 * 60_000);

  const mouseDpi = (): number => {
    const ds = useDevices.getState();
    const m = primaryMouse(ds.devices);
    const ms = m ? ds.live[m.uid]?.mouse : undefined;
    const stage = ms?.dpiStages[ms.activeStage] ?? ms?.dpiStages[0];
    return stage?.x || 800;
  };

  const rollDay = () => {
    const d = dayKey();
    if (today.day === d) return;
    save();
    useStats.setState((s) => ({ history: { ...s.history, [today.day]: today } }));
    today = emptyStats(d);
  };

  const onKey = (e: InputKeyEvent) => {
    if (!e.down) return;
    // Caps lock (best effort): the OS toggles on a physical CapsLock unless a pack remaps it,
    // and on synthetic CapsLock presses sent by the remap engine.
    if (e.code === "CapsLock" && (e.synthetic || !isKeyRemapped("CapsLock"))) {
      useSignals.getState().set({ capsLock: !useSignals.getState().capsLock });
    }
    if (e.synthetic) return;
    rollDay();
    const now = performance.now();
    today.keys++;
    today.perKey[e.code] = (today.perKey[e.code] ?? 0) + 1;
    lifetime.keys++;
    actions.add(now);
    if (isPrintableCode(e.code)) chars.add(now);
    save();
  };

  const onMouse = (m: InputMouseSample) => {
    rollDay();
    const meters = m.distance > 0 ? pixelsToMeters(m.distance, mouseDpi(), pointerSpeed) : 0;
    today.clicks += m.clicks;
    today.mouseMeters += meters;
    lifetime.clicks += m.clicks;
    lifetime.mouseMeters += meters;
    if (m.clicks) actions.add(performance.now(), m.clicks);
    save();
  };

  // --- Enable/disable with settings.inputStats --------------------------------------------------
  let release: (() => void) | null = null;
  let unsubs: (() => void)[] = [];
  let tick: ReturnType<typeof setInterval> | undefined;
  let lastSeries = 0;
  let lastPublished = "";

  const doTick = () => {
    rollDay();
    const now = performance.now();
    const wpm = Math.round(wpmFromChars(chars.perMinute(now)));
    const apm = Math.round(actions.perMinute(now));
    if (wpm > today.peakWpm) today.peakWpm = wpm;
    if (wpm > lifetime.peakWpm) lifetime.peakWpm = wpm;
    const pub = `${wpm}/${apm}`;
    if (pub !== lastPublished) {
      lastPublished = pub;
      useSignals.getState().set({ wpm, apm });
    }
    const patch: Partial<ReturnType<typeof useStats.getState>> = { wpm, apm, today: { ...today }, lifetime: { ...lifetime } };
    const t = Date.now();
    if (t - lastSeries >= 1000) {
      lastSeries = t;
      patch.series = [...useStats.getState().series, { t, wpm, apm }].slice(-60);
    }
    useStats.setState(patch);
  };

  const start = async () => {
    if (release) return;
    release = acquireInputListening();
    unsubs.push(await backend.on("input-key", onKey), await backend.on("input-mouse", onMouse));
    tick = setInterval(doTick, TICK_MS);
    useStats.setState({ active: true });
  };
  const stop = () => {
    release?.();
    release = null;
    unsubs.forEach((u) => u());
    unsubs = [];
    clearInterval(tick);
    chars.clear();
    actions.clear();
    useSignals.getState().set({ wpm: undefined, apm: undefined });
    useStats.setState({ active: false, wpm: 0, apm: 0 });
  };
  const sync = () => (useSettings.getState().settings.inputStats ? start() : stop());
  useSettings.subscribe((s, p) => s.settings.inputStats !== p.settings.inputStats && sync());
  await sync();

  // --- Battery history ------------------------------------------------------------------------------
  const sampleBattery = () => {
    const ds = useDevices.getState();
    const t = Date.now();
    const fresh: BatterySample[] = [];
    for (const d of ds.devices) {
      const b = ds.live[d.uid]?.battery;
      if (b) fresh.push({ t, uid: d.uid, name: d.definition.name, percent: Math.round(b.percent), charging: b.charging });
    }
    battery = [...battery.filter((s) => t - s.t < BATTERY_KEEP_MS), ...fresh];
    useStats.setState({ battery });
    if (fresh.length) saveJsonDebounced("stats/battery.json", battery, 2_000);
  };
  setTimeout(sampleBattery, 15_000);
  setInterval(sampleBattery, BATTERY_EVERY_MS);
}
