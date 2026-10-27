import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, AppWindow, ArrowUpRight, Bot, Command, Cpu, Gpu, Keyboard, Layers, MemoryStick, Mic, MicOff, Pause, Play, Printer, Route, Square, Sun, Timer, Trophy } from "lucide-react";
import { Badge, BarChart, Button, Card, Gauge, KeyboardView, LineChart, MouseView, Progress, Slider, Sparkline, Toggle } from "@/ui";
import { useT } from "@/i18n";
import { useSettings } from "@/core/state/settings";
import { navigate } from "@/app/router";
import { useDevices, primaryKeyboard, primaryMouse, layoutOf, getTemplate } from "@/core/devices";
import { useLightingFrame, useLighting, useEffects, useProfiles, useSignals, VIRTUAL_KEYBOARD, VIRTUAL_MOUSE } from "@/core/lighting";
import { useStats } from "@/core/stats";
import { useSystemMetrics, onSystemMetrics, lastSystemMetrics, usePomodoro, useIntegrations, toggleMic } from "@/core/integrations";
import { useKeymaps } from "@/core/keymaps";
import type { ConnectedDevice, InputStats, Profile, RGB } from "@/core/types";
import { BatteryIcon, DeviceIcon, batteryTone, formatCount, formatDistance, useProfilePreview } from "./shared";
import { demoTypistEnabled, isDemo, setDemoTypistEnabled, useDemoTypist } from "./demoTypist";
import "./dashboard.css";

type TFn = ReturnType<typeof useT>;

export default function Dashboard() {
  const t = useT();
  const [ghost, setGhost] = useState(demoTypistEnabled);
  useDemoTypist(ghost);
  useSystemMetrics(true);

  return (
    <div className="kh-page dash">
      <header className="dash-head">
        <div>
          <h1 className="kh-page__title">{t("dashboard.title")}</h1>
          <p className="kh-page__desc">{t("dashboard.subtitle")}</p>
        </div>
        {isDemo && (
          <div className="dash-ghost" title={t("dashboard.demoTypingHint")}>
            <Toggle
              checked={ghost}
              onChange={(v) => {
                setGhost(v);
                setDemoTypistEnabled(v);
              }}
              label={t("dashboard.demoTyping")}
            />
          </div>
        )}
      </header>
      <DeskHero />
      <Instruments />
      <DevicesColumn />
      <ChartsColumn />
      <Widgets />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero: the live desk + profile switcher
// ---------------------------------------------------------------------------

function avgColor(frame: Record<string, RGB>): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const c of Object.values(frame)) {
    r += c[0];
    g += c[1];
    b += c[2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

function DeskHero() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const definitions = useDevices((s) => s.definitions);
  const live = useDevices((s) => s.live);
  const kb = primaryKeyboard(devices);
  const mouse = primaryMouse(devices);
  const virtual = devices.length === 0;

  const layout = kb ? layoutOf(kb) : undefined;
  const tpl = getTemplate("ansi-60");
  const keys = layout?.keys ?? tpl.layout.keys;
  const size = kb?.definition.size ?? tpl.size;
  const mouseDef = mouse?.definition ?? (virtual ? definitions.find((d) => d.id === "razer-deathadder-v2-pro") : undefined);

  const kbFrame = useLightingFrame(kb?.uid ?? VIRTUAL_KEYBOARD);
  const mouseFrame = useLightingFrame(mouse?.uid ?? VIRTUAL_MOUSE);
  const glow = avgColor(kbFrame);
  const glowCss = `rgb(${glow.map((v) => Math.round(Math.min(255, v * 1.3))).join(",")})`;

  const scene = useLighting((s) => s.scene);
  const effects = useEffects();
  const effectName = (id: string) => effects.find((e) => e.id === id)?.name ?? id.replace(/^widget:/, "");
  const setBrightness = useLighting((s) => s.setBrightness);
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeId);
  const dirty = useProfiles((s) => s.dirty);
  const active = profiles.find((p) => p.id === activeId);
  const hwMode = [kb, mouse].some((d) => d && live[d.uid]?.mode === "hardware");

  return (
    <section className="dash-hero">
      <div className="dash-stage" style={{ ["--glow" as string]: glowCss }}>
        <div className="dash-stage__meta">
          <span className="dash-live">
            <span className="dash-live__dot" />
            {t("dashboard.liveLighting")}
          </span>
          {virtual && <Badge>{t("dashboard.virtualDesk")}</Badge>}
          {hwMode && <Badge tone="info">{t("devices.mode.hardware")}</Badge>}
        </div>
        <div className="dash-stage__desk">
          <div className="dash-stage__kb">
            <div className="dash-stage__underglow" />
            <KeyboardView keys={keys} size={size} colors={kbFrame} maxWidth={760} />
            <div className="dash-stage__name">{kb?.definition.name ?? t("dashboard.previewKeyboard")}</div>
          </div>
          {mouseDef && (
            <div className="dash-stage__mouse">
              <div className="dash-stage__underglow dash-stage__underglow--mouse" />
              <MouseView leds={mouseDef.leds} colors={mouseFrame} height={176} />
              <div className="dash-stage__name">{mouseDef.name}</div>
            </div>
          )}
        </div>
        <div className="dash-stage__layers">
          <Layers />
          {scene.layers
            .filter((l) => l.enabled)
            .slice(0, 5)
            .map((l) => (
              <span key={l.id} className="dash-chip">
                {effectName(l.effect)}
                {l.blend !== "normal" && <span className="subtle">{l.blend}</span>}
              </span>
            ))}
          <span className="grow" />
          <span className="dash-stage__fps mono">{scene.fps} fps</span>
        </div>
      </div>

      <aside className="dash-profiles">
        <div className="dash-profiles__head">
          <div className="dash-eyebrow">{t("dashboard.activeProfile")}</div>
          <div className="dash-profiles__name">
            <span>{active?.name ?? "—"}</span>
            {dirty && <Badge>{t("dashboard.edited")}</Badge>}
          </div>
        </div>
        <div className="dash-profiles__bright">
          <Sun />
          <div className="grow">
            <Slider value={Math.round(scene.brightness * 100)} min={0} max={100} onChange={(v) => setBrightness(v / 100)} />
          </div>
          <span className="mono">{Math.round(scene.brightness * 100)}%</span>
        </div>
        <div className="dash-profiles__grid">
          {profiles.slice(0, 8).map((p) => (
            <ProfileTile key={p.id} profile={p} keyboard={kb} active={p.id === activeId} />
          ))}
        </div>
        <button type="button" className="dash-link" onClick={() => navigate("lighting")}>
          {t("dashboard.openLighting")} <ArrowUpRight />
        </button>
      </aside>
    </section>
  );
}

function ProfileTile({ profile, keyboard, active }: { profile: Profile; keyboard?: ConnectedDevice; active: boolean }) {
  const url = useProfilePreview(profile, keyboard, 12);
  const apply = useProfiles((s) => s.apply);
  return (
    <button type="button" className="dash-ptile" aria-pressed={active} onClick={() => void apply(profile.id, "user")} title={profile.description ?? profile.name}>
      <span className="dash-ptile__img">{url ? <img src={url} alt="" /> : <span className="dash-ptile__ph" />}</span>
      <span className="dash-ptile__name">{profile.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Instruments: live WPM / APM, today, odometer, peak
// ---------------------------------------------------------------------------

function Instruments() {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const wpm = useStats((s) => s.wpm);
  const apm = useStats((s) => s.apm);
  const series = useStats((s) => s.series);
  const today = useStats((s) => s.today);
  const lifetime = useStats((s) => s.lifetime);
  const active = useStats((s) => s.active);
  const todayDist = formatDistance(today.mouseMeters, lang);
  const lifeDist = formatDistance(lifetime.mouseMeters, lang);
  const wpmSeries = series.map((s) => s.wpm);

  return (
    <div className="dash-instruments">
      <div className="dash-inst dash-inst--gauges">
        <div className="dash-inst__label">
          <Activity /> {t("dashboard.liveRates")}
          {!active && <Badge>{t("dashboard.paused")}</Badge>}
        </div>
        <div className="dash-gauges">
          <Gauge value={wpm} max={160} label={t("stats.wpm")} size={176} />
          <Gauge value={apm} max={400} label={t("stats.apm")} size={176} color="var(--text-2)" />
        </div>
        <div className="dash-spark">
          <span className="dash-inst__sub">{t("dashboard.last60s")}</span>
          <div className="grow dash-spark__line">
            <Sparkline data={wpmSeries.length > 1 ? wpmSeries : [0, 0]} width={300} height={28} />
          </div>
        </div>
      </div>

      <div className="dash-inst">
        <div className="dash-inst__label">
          <Keyboard /> {t("dashboard.today")}
        </div>
        <div className="dash-big">{formatCount(today.keys, lang)}</div>
        <div className="dash-inst__sub">{t("dashboard.keystrokes")}</div>
        <div className="dash-inst__split">
          <div>
            <div className="dash-mid">{formatCount(today.clicks, lang)}</div>
            <div className="dash-inst__sub">{t("stats.clicks")}</div>
          </div>
          <div>
            <div className="dash-mid">{formatCount(lifetime.keys, lang)}</div>
            <div className="dash-inst__sub">{t("dashboard.lifetimeKeys")}</div>
          </div>
        </div>
      </div>

      <div className="dash-inst">
        <div className="dash-inst__label">
          <Route /> {t("dashboard.odometer")}
        </div>
        <div className="dash-big">
          {todayDist.value}
          <span className="dash-unit">{todayDist.unit}</span>
        </div>
        <div className="dash-inst__sub">{t("dashboard.mouseToday")}</div>
        <div className="dash-inst__split dash-inst__split--odo">
          <div>
            <div className="dash-odo" aria-label={`${lifeDist.value} ${lifeDist.unit}`}>
              {odometerDigits(lifetime.mouseMeters + today.mouseMeters).map((d, i) => (
                <span key={i} className={d.dec ? "dash-odo__d dash-odo__d--dec" : "dash-odo__d"}>
                  {d.ch}
                </span>
              ))}
              <span className="dash-odo__unit">km</span>
            </div>
            <div className="dash-inst__sub">{t("dashboard.lifetimeSince", { date: formatDay(lifetime.since, lang) })}</div>
          </div>
        </div>
      </div>

      <div className="dash-inst">
        <div className="dash-inst__label">
          <Trophy /> {t("stats.peakWpm")}
        </div>
        <div className="dash-big">{Math.round(Math.max(today.peakWpm, wpm))}</div>
        <div className="dash-inst__sub">{t("dashboard.peakToday")}</div>
        <div className="dash-inst__split">
          <div>
            <div className="dash-mid">{Math.round(Math.max(lifetime.peakWpm, today.peakWpm))}</div>
            <div className="dash-inst__sub">{t("dashboard.personalBest")}</div>
          </div>
          <div>
            <div className="dash-mid">{formatCount(lifetime.clicks, lang)}</div>
            <div className="dash-inst__sub">{t("dashboard.lifetimeClicks")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lifetime metres as a 4+1 digit km odometer (0013.9). */
function odometerDigits(meters: number) {
  const km = Math.min(9999.9, meters / 1000);
  const [int, dec] = km.toFixed(1).split(".");
  return [...int.padStart(4, "0").split("").map((ch) => ({ ch, dec: false })), { ch: dec, dec: true }];
}

function formatDay(day: string, lang: string) {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(lang, { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

function DevicesColumn() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const shown = devices.slice(0, 3);
  return (
    <div className="dash-col">
      <div className="dash-section-title">
        <span>{t("dashboard.devices")}</span>
        <button type="button" className="dash-link" onClick={() => navigate("devices")}>
          {t("dashboard.manage")} <ArrowUpRight />
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="dash-device dash-device--empty">
          <div className="dash-device__icon">
            <Keyboard />
          </div>
          <div className="dash-device__main">
            <div className="dash-device__name">{t("dashboard.noDevices")}</div>
            <div className="dash-device__facts">{t("dashboard.noDevicesHint")}</div>
          </div>
        </div>
      ) : (
        <div className="dash-devgrid">
          {shown.map((d) => (
            <DeviceTile key={d.uid} device={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceTile({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const live = useDevices((s) => s.live[device.uid]);
  const signalBattery = useSignals((s) => s.battery[device.uid]);
  const battery = live?.battery ?? signalBattery;
  const isMouse = device.definition.type === "mouse";
  const status = device.definition.status;
  const dpi = live?.dpi?.x ?? live?.mouse?.dpiStages[live.mouse.activeStage]?.x;
  const polling = live?.mouse?.pollingRate;
  const tone = batteryTone(battery?.percent ?? 100, battery?.charging);
  const layout = device.definition.type === "keyboard" ? layoutOf(device) : undefined;

  return (
    <button type="button" className="dash-device" onClick={() => navigate(isMouse ? "performance" : "devices")}>
      <div className="dash-device__icon">
        <DeviceIcon type={device.definition.type} size={18} />
      </div>
      <div className="dash-device__main">
        <div className="dash-device__top">
          <span className="dash-device__name">{device.definition.name}</span>
          <Badge tone={status === "verified" ? "success" : status === "community" ? "info" : "warning"} dot>
            {t(`devices.status.${status}`)}
          </Badge>
          {!device.online && <Badge tone="danger">{t("common.disconnected")}</Badge>}
        </div>
        <div className="dash-device__facts">
          {device.firmware && (
            <span>
              {t("dashboard.firmware")} <b>{device.firmware}</b>
            </span>
          )}
          {dpi !== undefined && (
            <span>
              <b>{dpi}</b> DPI
            </span>
          )}
          {polling !== undefined && (
            <span>
              <b>{polling}</b> Hz
            </span>
          )}
          <span>{t(`devices.mode.${live?.mode ?? "software"}`)}</span>
        </div>
        {!battery && layout && (
          <div className="dash-device__battery">
            <span className="dash-bat">
              <Keyboard width={14} height={14} />
              <b>{layout.name}</b>
            </span>
            <span className="subtle">{t("dashboard.keys", { n: layout.keys.length })}</span>
          </div>
        )}
        {battery && (
          <div className="dash-device__battery">
            <span className={`dash-bat${tone ? ` dash-bat--${tone}` : ""}`}>
              <BatteryIcon percent={battery.percent} charging={battery.charging} />
              <b>{Math.round(battery.percent)}%</b>
              {battery.charging && <span className="subtle">{t("devices.battery.charging")}</span>}
            </span>
            <div className="grow">
              <Progress value={battery.percent / 100} color={tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : undefined} />
            </div>
          </div>
        )}
      </div>
      <ArrowUpRight className="dash-device__go" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function ChartsColumn() {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const loadHistory = useStats((s) => s.loadHistory);
  const todayKeys = useStats((s) => s.today.keys);
  const [days, setDays] = useState<InputStats[]>([]);
  useEffect(() => {
    void loadHistory(14).then(setDays);
  }, [loadHistory]);

  const bars = days.map((d, i) => {
    const date = new Date(`${d.day}T12:00:00`);
    const last = i === days.length - 1;
    return { label: last ? t("dashboard.todayShort") : date.toLocaleDateString(lang, { weekday: "narrow" }) + "​".repeat(i), value: last ? todayKeys : d.keys };
  });
  const past = days.slice(0, -1);
  const avg = past.length ? past.reduce((a, d) => a + d.keys, 0) / past.length : 0;

  return (
    <div className="dash-charts">
      <Card title={t("dashboard.keysPerDay")} subtitle={t("dashboard.avgPerDay", { value: formatCount(avg, lang) })}>
        <BarChart data={bars} height={140} color="color-mix(in srgb, var(--chart-1) 78%, transparent)" />
      </Card>
      <BatteryChart />
    </div>
  );
}

function BatteryChart() {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const devices = useDevices((s) => s.devices);
  const samples = useStats((s) => s.battery);
  const mouse = primaryMouse(devices);
  const { data, labels } = useMemo(() => {
    let own = mouse ? samples.filter((b) => b.uid === mouse.uid) : [];
    // Little history for the connected mouse yet: show the longest history we have.
    if (own.length < 12 && samples.length) {
      const uid = samples[0].uid;
      own = samples.filter((b) => b.uid === uid);
    }
    const bucketMs = 2 * 3_600_000;
    const buckets = new Map<number, number>();
    for (const s of own) buckets.set(Math.floor(s.t / bucketMs), s.percent);
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    return {
      data: keys.map((k) => buckets.get(k)!),
      labels: keys.map((k) => new Date(k * bucketMs).toLocaleDateString(lang, { weekday: "short" })),
    };
  }, [samples, mouse, lang]);

  return (
    <Card title={t("stats.battery")} subtitle={`${mouse?.definition.name ?? t("dashboard.mouse")} · ${t("dashboard.last7days")}`}>
      {data.length > 1 ? (
        <LineChart series={[{ name: "battery", data }]} labels={labels} height={140} yMin={0} yMax={100} unit="%" />
      ) : (
        <div className="dash-chart-empty subtle">{t("dashboard.noBattery")}</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

const HISTORY = 60;

function useMetricHistory() {
  const [hist, setHist] = useState<{ cpu: number[]; gpu: number[]; ram: number[] }>(() => {
    const m = lastSystemMetrics();
    return m ? { cpu: [m.cpuLoad], gpu: m.gpu ? [m.gpu.load] : [], ram: [m.ramTotalMb ? (m.ramUsedMb / m.ramTotalMb) * 100 : 0] } : { cpu: [], gpu: [], ram: [] };
  });
  useEffect(
    () =>
      onSystemMetrics((m) =>
        setHist((h) => ({
          cpu: [...h.cpu, m.cpuLoad].slice(-HISTORY),
          gpu: m.gpu ? [...h.gpu, m.gpu.load].slice(-HISTORY) : h.gpu,
          ram: [...h.ram, m.ramTotalMb ? (m.ramUsedMb / m.ramTotalMb) * 100 : 0].slice(-HISTORY),
        })),
      ),
    [],
  );
  return hist;
}

function Widget({ icon, label, value, sub, children, onClick, accent, actions }: { icon: ReactNode; label: ReactNode; value?: ReactNode; sub?: ReactNode; children?: ReactNode; onClick?: () => void; accent?: string; actions?: ReactNode }) {
  return (
    <div
      className={onClick ? "dash-w dash-w--btn" : "dash-w"}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) : undefined}
    >
      <div className="dash-w__head">
        <span className="dash-w__icon" style={accent ? { color: accent } : undefined}>
          {icon}
        </span>
        <span className="dash-w__label">{label}</span>
        {actions && (
          <span className="dash-w__actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {value !== undefined && <div className="dash-w__value">{value}</div>}
      <div className="dash-w__sub">{sub ?? " "}</div>
      {children}
    </div>
  );
}

function MiniSpark({ data }: { data: number[] }) {
  const d = data.length > 1 ? data : [data[0] ?? 0, data[0] ?? 0];
  // Fixed 0..100 range: append invisible bounds by clamping through a scaled copy.
  return (
    <div className="dash-w__spark">
      <Sparkline data={[...d]} width={220} height={26} />
    </div>
  );
}

function Widgets() {
  const t = useT();
  const hist = useMetricHistory();
  const cpu = useSignals((s) => s.cpu);
  const gpu = useSignals((s) => s.gpu);
  const ram = useSignals((s) => s.ram);
  const sysEnabled = useIntegrations((s) => s.config.system.enabled);

  return (
    <div className="dash-col">
      <div className="dash-section-title">
        <span>{t("dashboard.widgets")}</span>
        <button type="button" className="dash-link" onClick={() => navigate("integrations")}>
          {t("nav.integrations")} <ArrowUpRight />
        </button>
      </div>
      <div className="dash-widgets">
        <Widget icon={<Cpu />} label="CPU" value={cpu ? `${Math.round(cpu.load)}%` : "—"} sub={!sysEnabled ? t("dashboard.off") : cpu?.temp ? `${Math.round(cpu.temp)} °C` : undefined}>
          <MiniSpark data={hist.cpu} />
        </Widget>
        <Widget icon={<Gpu />} label="GPU" value={gpu ? `${Math.round(gpu.load)}%` : "—"} sub={gpu ? `${Math.round(gpu.temp)} °C · VRAM ${Math.round(gpu.vramPct)}%` : undefined}>
          <MiniSpark data={hist.gpu} />
        </Widget>
        <Widget icon={<MemoryStick />} label="RAM" value={ram ? `${Math.round(ram.pct)}%` : "—"} sub={lastRamLabel()}>
          <MiniSpark data={hist.ram} />
        </Widget>
        <PrinterWidget t={t} />
        <ClaudeWidget t={t} />
        <PomodoroWidget t={t} />
        <MicWidget t={t} />
        <ForegroundWidget t={t} />
      </div>
    </div>
  );
}

function lastRamLabel() {
  const m = lastSystemMetrics();
  return m ? `${(m.ramUsedMb / 1024).toFixed(1)} / ${Math.round(m.ramTotalMb / 1024)} GB` : undefined;
}

function PrinterWidget({ t }: { t: TFn }) {
  const enabled = useIntegrations((s) => s.config.bambu.enabled);
  const bambu = useSignals((s) => s.bambu);
  if (!enabled) return <Widget icon={<Printer />} label={t("dashboard.printer")} value="—" sub={t("dashboard.notConfigured")} onClick={() => navigate("integrations")} />;
  const running = bambu?.state === "RUNNING";
  const sub = !bambu
    ? t("dashboard.connecting")
    : running
      ? [
          bambu.layer !== undefined && bambu.totalLayers ? t("dashboard.layer", { layer: bambu.layer, total: bambu.totalLayers }) : null,
          bambu.remainingMin !== undefined ? t("dashboard.minLeft", { min: bambu.remainingMin }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : t(`dashboard.printerState.${bambu.state === "FINISH" ? "finish" : bambu.state === "FAILED" ? "failed" : "idle"}`);
  return (
    <Widget icon={<Printer />} label={t("dashboard.printer")} value={bambu ? `${Math.round(bambu.progress)}%` : "—"} sub={sub} onClick={() => navigate("integrations")}>
      <div className="dash-w__bar">
        <Progress value={(bambu?.progress ?? 0) / 100} color={bambu?.state === "FAILED" ? "var(--danger)" : bambu?.state === "FINISH" ? "var(--success)" : undefined} />
      </div>
    </Widget>
  );
}

const CLAUDE_TONE: Record<string, string | undefined> = {
  working: "var(--info)",
  waiting: "var(--warning)",
  done: "var(--success)",
  error: "var(--danger)",
};

function ClaudeWidget({ t }: { t: TFn }) {
  const enabled = useIntegrations((s) => s.config.claude.enabled);
  const claude = useSignals((s) => s.claude);
  const state = claude?.state ?? "idle";
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const mins = claude ? Math.max(0, Math.round((Date.now() - claude.since) / 60_000)) : null;
  return (
    <Widget
      icon={<Bot />}
      label="Claude Code"
      value={
        <span className="dash-w__state">
          <span className="dash-w__dot" style={{ background: CLAUDE_TONE[state] ?? "var(--text-3)" }} />
          {t(`dashboard.claude.${state}`)}
        </span>
      }
      sub={!enabled ? t("dashboard.off") : mins !== null && claude ? t("dashboard.since", { min: mins }) : t("dashboard.claudeHint")}
      onClick={() => navigate("integrations")}
    />
  );
}

function PomodoroWidget({ t }: { t: TFn }) {
  const p = usePomodoro();
  const focusMin = useIntegrations((s) => s.config.pomodoro.focusMin);
  const [, tick] = useState(0);
  useEffect(() => {
    if (p.phase === "idle") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [p.phase]);
  const remaining = p.phase === "idle" ? focusMin * 60_000 : (p.pausedRemaining ?? Math.max(0, p.endsAt - Date.now()));
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  const progress = p.phase === "idle" || !p.totalMs ? 0 : 1 - remaining / p.totalMs;
  const accent = p.phase === "focus" ? "#ff8a65" : p.phase === "break" ? "#7ee0a1" : undefined;
  return (
    <Widget
      icon={<Timer />}
      label="Pomodoro"
      accent={accent}
      actions={
        p.phase === "idle" ? (
          <Button size="sm" icon={<Play />} onClick={() => p.start()}>
            {t("dashboard.pomodoroStart")}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" iconOnly icon={p.pausedRemaining !== null ? <Play /> : <Pause />} title={t("dashboard.pomodoroToggle")} onClick={() => p.toggle()} />
            <Button size="sm" variant="ghost" iconOnly icon={<Square />} title={t("dashboard.pomodoroStop")} onClick={() => p.stop()} />
          </>
        )
      }
      value={`${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}
      sub={t(`dashboard.pomodoroPhase.${p.phase}`, { n: p.completed })}
    >
      <div className="dash-w__bar">
        <Progress value={progress} color={accent} />
      </div>
    </Widget>
  );
}

function MicWidget({ t }: { t: TFn }) {
  const muted = useSignals((s) => s.micMuted);
  const enabled = useIntegrations((s) => s.config.mic.enabled);
  const hotkey = useIntegrations((s) => s.config.mic.hotkey);
  return (
    <Widget
      icon={muted ? <MicOff /> : <Mic />}
      accent={muted ? "var(--danger)" : undefined}
      label={t("dashboard.mic")}
      value={muted === undefined ? "—" : muted ? t("dashboard.muted") : t("dashboard.micLive")}
      sub={enabled ? (hotkey ? t("dashboard.micHotkey", { key: hotkey }) : t("dashboard.micClick")) : t("dashboard.off")}
      onClick={() => void toggleMic()}
    />
  );
}

function ForegroundWidget({ t }: { t: TFn }) {
  const foreground = useKeymaps((s) => s.foreground);
  const activePackId = useKeymaps((s) => s.activePackId);
  const packs = useKeymaps((s) => s.packs);
  const pack = packs.find((p) => p.id === activePackId);
  return (
    <Widget
      icon={<AppWindow />}
      label={t("dashboard.foreground")}
      value={<span className="dash-w__text">{foreground ?? "—"}</span>}
      sub={
        <span className="dash-w__pack">
          <Command />
          {pack ? pack.name : t("dashboard.noPack")}
        </span>
      }
      onClick={() => navigate("keymaps")}
    />
  );
}
