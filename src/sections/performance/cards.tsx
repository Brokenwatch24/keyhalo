import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Gauge as GaugeIcon, Info } from "lucide-react";
import { useDevices } from "@/core/devices";
import { useLightingFrame } from "@/core/lighting";
import { backend, type PointerSettings } from "@/core/backend";
import { pointerMultiplier, useStats } from "@/core/stats";
import type { ConnectedDevice } from "@/core/types";
import { Badge, Card, MouseView, Progress, Segmented, Slider, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { navigate } from "@/app/router";
import { errorText, write } from "./util";

const fmt = (v: number) => v.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Polling rate + sniper
// ---------------------------------------------------------------------------

export function ResponseCard({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const caps = device.definition.capabilities;
  const live = useDevices((s) => s.live[device.uid]);
  const setMouseSettings = useDevices((s) => s.setMouseSettings);
  const mouse = live?.mouse;
  const rates = caps.pollingRates ?? [];
  const dpiCap = caps.dpi;
  const [sniper, setSniper] = useState(mouse?.sniperDpi ?? 400);
  useEffect(() => setSniper(mouse?.sniperDpi ?? 400), [mouse?.sniperDpi]);

  return (
    <Card title={t("performance.response.title")}>
      <div className="col perf-gap">
        {rates.length > 0 && (
          <div className="col">
            <div className="perf-label-row">
              <span className="perf-label">{t("performance.polling.title")}</span>
              {mouse && <span className="subtle perf-small tabular">{t("performance.polling.interval", { ms: (1000 / mouse.pollingRate).toFixed(mouse.pollingRate > 1000 ? 3 : 1) })}</span>}
            </div>
            <Segmented
              value={String(mouse?.pollingRate ?? rates[rates.length - 1])}
              onChange={(v) => void write(() => setMouseSettings(device.uid, { pollingRate: Number(v) }))}
              options={rates.map((r) => ({ value: String(r), label: `${fmt(r)} Hz` }))}
            />
            <span className="perf-small subtle">
              {t("performance.polling.hint")}{" "}
              <a
                href="#/testbench"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("testbench");
                }}
              >
                {t("performance.polling.test")}
              </a>
            </span>
          </div>
        )}
        {dpiCap && (
          <div className="col perf-divider">
            <Slider
              label={t("performance.sniper.title")}
              value={sniper}
              min={dpiCap.min}
              max={Math.min(dpiCap.max, 3200)}
              step={dpiCap.step}
              unit="DPI"
              format={fmt}
              onChange={setSniper}
              onCommit={(v) => void write(() => setMouseSettings(device.uid, { sniperDpi: v }))}
            />
            <span className="perf-small subtle">
              {t("performance.sniper.hint")}{" "}
              <a
                href="#/keymaps"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("keymaps");
                }}
              >
                {t("performance.sniper.bind")}
              </a>
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lighting (logo brightness)
// ---------------------------------------------------------------------------

export function LightingCard({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const live = useDevices((s) => s.live[device.uid]);
  const setBrightness = useDevices((s) => s.setBrightness);
  const frame = useLightingFrame(device.uid);
  const [value, setValue] = useState(Math.round((live?.brightness ?? 1) * 100));
  useEffect(() => setValue(Math.round((live?.brightness ?? 1) * 100)), [live?.brightness]);
  const leds = device.definition.leds ?? [];
  return (
    <Card title={t("performance.lighting.title")} actions={live?.mode && <Badge>{t(`devices.mode.${live.mode}`)}</Badge>}>
      <div className="perf-light">
        <div className="perf-light__mouse">
          <MouseView leds={leds} colors={frame} height={150} />
        </div>
        <Slider
          label={t("performance.lighting.brightness")}
          value={value}
          min={0}
          max={100}
          unit="%"
          onChange={setValue}
          onCommit={(v) => void write(() => setBrightness(device.uid, v / 100))}
          disabled={!device.definition.capabilities.brightness}
        />
        <span className="perf-small subtle">
          {t("performance.lighting.hint", { zones: leds.map((l) => l.name).join(", ") || "—" })}{" "}
          <a
            href="#/lighting"
            onClick={(e) => {
              e.preventDefault();
              navigate("lighting");
            }}
          >
            {t("performance.lighting.open")}
          </a>
        </span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

function batteryIcon(pct: number, charging: boolean) {
  if (charging) return <BatteryCharging />;
  if (pct < 20) return <BatteryLow />;
  if (pct < 70) return <BatteryMedium />;
  return <BatteryFull />;
}

function formatIdle(s: number, t: ReturnType<typeof useT>) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? t("performance.battery.minutes", { m }) : t("performance.battery.minSec", { m, s: String(r).padStart(2, "0") });
}

/** Pixel-exact area chart (0..100 %) with day labels; scales to its container. */
function BatteryChart({ points, low, locale }: { points: { t: number; v: number }[]; low: number; locale: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const h = 96;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => 4 + (1 - v / 100) * (h - 8);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const days: { t: number; label: string }[] = [];
  const fmtDay = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const d = new Date(t0);
  d.setHours(24, 0, 0, 0);
  for (; d.getTime() < t1; d.setDate(d.getDate() + 1)) days.push({ t: d.getTime(), label: fmtDay.format(d) });
  return (
    <div ref={ref} className="perf-bchart">
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Battery history">
          <defs>
            <linearGradient id="perf-bfill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((v) => (
            <line key={v} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" />
          ))}
          {days.map((day) => (
            <line key={day.t} x1={x(day.t)} x2={x(day.t)} y1={0} y2={h} stroke="var(--chart-grid)" strokeDasharray="2 3" />
          ))}
          <line x1={0} x2={w} y1={y(low)} y2={y(low)} stroke="var(--danger)" strokeOpacity="0.45" strokeDasharray="3 3" />
          <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#perf-bfill)" />
          <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
      <div className="perf-bchart__days">
        {days.map((day) => (
          <span key={day.t} style={{ left: w ? x(day.t) + ((x(day.t + 86_400_000) > w ? w : x(day.t + 86_400_000)) - x(day.t)) / 2 : 0 }}>
            {day.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BatteryCard({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const caps = device.definition.capabilities;
  const live = useDevices((s) => s.live[device.uid]);
  const setMouseSettings = useDevices((s) => s.setMouseSettings);
  const samples = useStats((s) => s.battery);
  const mouse = live?.mouse;
  const battery = live?.battery;
  const idleCap = caps.idleSleep ?? { min: 60, max: 900 };
  const lowCap = caps.lowBatteryThreshold ?? { min: 5, max: 25 };
  const [idle, setIdle] = useState(mouse?.idleSleepSeconds ?? 300);
  const [low, setLow] = useState(mouse?.lowBatteryThreshold ?? 15);
  useEffect(() => setIdle(mouse?.idleSleepSeconds ?? 300), [mouse?.idleSleepSeconds]);
  useEffect(() => setLow(mouse?.lowBatteryThreshold ?? 15), [mouse?.lowBatteryThreshold]);

  const history = useMemo(() => {
    let mine = samples.filter((b) => b.uid === device.uid);
    // Browser demo: stats seeds a week of history under a placeholder uid.
    if (backend.kind === "mock") mine = [...samples.filter((b) => b.uid === "demo-mouse"), ...mine].sort((a, b) => a.t - b.t);
    if (mine.length < 2) return [] as { t: number; v: number }[];
    // 1 h buckets over the last 7 days.
    const end = mine[mine.length - 1].t;
    const start = end - 7 * 86_400_000;
    const bucket = 3_600_000;
    const out: { t: number; v: number }[] = [];
    let i = 0;
    while (i < mine.length && mine[i].t < start) i++;
    for (let b = start; b <= end; b += bucket) {
      let last: number | undefined;
      while (i < mine.length && mine[i].t < b + bucket) last = mine[i++].percent;
      if (last === undefined) {
        if (!out.length) continue;
        last = out[out.length - 1].v;
      }
      out.push({ t: b, v: last });
    }
    return out;
  }, [samples, device.uid]);

  // Derived from the history: lowest level and average drain while discharging.
  const summary = useMemo(() => {
    if (history.length < 2) return null;
    let drop = 0;
    let hours = 0;
    for (let i = 1; i < history.length; i++) {
      const d = history[i - 1].v - history[i].v;
      if (d >= 0) {
        drop += d;
        hours += (history[i].t - history[i - 1].t) / 3_600_000;
      }
    }
    return { min: Math.min(...history.map((p) => p.v)), drain: hours ? drop / hours : 0 };
  }, [history]);

  const pct = battery?.percent;
  const tone = pct === undefined ? undefined : pct <= low ? "var(--danger)" : pct < 30 ? "var(--warning)" : undefined;

  return (
    <Card title={t("performance.battery.title")} actions={battery?.charging && <Badge tone="success" dot>{t("devices.battery.charging")}</Badge>}>
      <div className="perf-battery">
        <div className="perf-battery__level">
          <div className="perf-battery__icon" style={tone ? { color: tone } : undefined}>
            {batteryIcon(pct ?? 0, !!battery?.charging)}
          </div>
          <div className="grow col perf-gap-xs">
            <div className="row">
              <span className="perf-battery__pct tabular">{pct !== undefined ? `${Math.round(pct)}%` : "—"}</span>
              <span className="subtle perf-small">{t("performance.battery.warnAt", { pct: low })}</span>
            </div>
            <Progress value={(pct ?? 0) / 100} color={tone} />
          </div>
        </div>
        <div className="perf-battery__chart">
          {history.length > 1 ? (
            <BatteryChart points={history} low={low} locale={t("performance.locale")} />
          ) : (
            <div className="subtle perf-small perf-battery__empty">{t("performance.battery.noHistory")}</div>
          )}
        </div>
        {summary && (
          <div className="perf-battery__stats">
            <div>
              <span className="subtle">{t("performance.battery.lowest")}</span>
              <span className="mono">{Math.round(summary.min)}%</span>
            </div>
            <div>
              <span className="subtle">{t("performance.battery.drain")}</span>
              <span className="mono">{t("performance.battery.perHour", { v: summary.drain.toFixed(2) })}</span>
            </div>
          </div>
        )}
        <div className="grid-2">
          <Slider
            label={t("performance.battery.idle")}
            value={idle}
            min={idleCap.min}
            max={idleCap.max}
            step={30}
            format={(v) => formatIdle(v, t)}
            onChange={setIdle}
            onCommit={(v) => void write(() => setMouseSettings(device.uid, { idleSleepSeconds: v }))}
            disabled={!mouse}
          />
          <Slider
            label={t("performance.battery.low")}
            value={low}
            min={lowCap.min}
            max={lowCap.max}
            unit="%"
            onChange={setLow}
            onCommit={(v) => void write(() => setMouseSettings(device.uid, { lowBatteryThreshold: v }))}
            disabled={!mouse}
          />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Windows pointer
// ---------------------------------------------------------------------------

export function PointerCard({ dpi }: { dpi?: number }) {
  const t = useT();
  const [ptr, setPtr] = useState<PointerSettings | null>(null);
  const [speed, setSpeed] = useState(10);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    backend
      .pointerGet()
      .then((p) => {
        if (!alive) return;
        setPtr(p);
        setSpeed(p.speed);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: PointerSettings) => {
    const prev = ptr;
    setPtr(next);
    try {
      await backend.pointerSet(next);
    } catch (e) {
      setPtr(prev);
      if (prev) setSpeed(prev.speed);
      toast(errorText(e), "danger");
    }
  };

  const mult = pointerMultiplier(speed);
  const markerPct = ((10 - 1) / 19) * 100;

  return (
    <Card title={t("performance.pointer.title")} subtitle={t("performance.pointer.subtitle")} actions={<GaugeIcon className="perf-head-icon" />}>
      {error ? (
        <div className="subtle perf-small">{error}</div>
      ) : (
        <div className="col perf-gap">
          <div className="perf-speed">
            <Slider
              label={t("performance.pointer.speed")}
              value={speed}
              min={1}
              max={20}
              format={(v) => `${v} · ×${pointerMultiplier(v).toFixed(v < 4 ? 3 : 2)}`}
              onChange={setSpeed}
              onCommit={(v) => ptr && v !== ptr.speed && void save({ ...ptr, speed: v })}
              disabled={!ptr}
            />
            <div className="perf-speed__scale">
              <span>{t("performance.pointer.slow")}</span>
              <span className="perf-speed__marker" style={{ left: `calc(8px + (100% - 16px) * ${markerPct / 100})` }}>
                {t("performance.pointer.oneToOne")}
              </span>
              <span>{t("performance.pointer.fast")}</span>
            </div>
          </div>
          {speed !== 10 && (
            <div className="perf-callout">
              <Info />
              <span>{t("performance.pointer.notOne", { mult: mult.toFixed(2) })}</span>
            </div>
          )}
          <div className="perf-divider col">
            <Toggle
              checked={!!ptr?.enhancePrecision}
              onChange={(v) => ptr && void save({ ...ptr, enhancePrecision: v })}
              label={t("performance.pointer.enhance")}
              disabled={!ptr}
            />
            <span className="perf-small subtle">{t("performance.pointer.enhanceHint")}</span>
          </div>
          {dpi !== undefined && (
            <div className="perf-small subtle tabular">{t("performance.pointer.effective", { dpi: fmt(dpi), eff: fmt(Math.round(dpi * mult)) })}</div>
          )}
        </div>
      )}
    </Card>
  );
}
