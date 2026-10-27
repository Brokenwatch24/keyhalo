import { useEffect, useRef, useState } from "react";
import { Badge, BarChart, Card, Gauge, LineChart } from "@/ui";
import { useT } from "@/i18n";
import { Metric, TestHeader, fmt } from "./shared";

/** Standard USB polling rates used to bucket the measured intervals. */
const RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
/** A gap longer than this means the mouse stopped: the interval is not a polling interval. */
const GAP_MS = 60;
const TICK_MS = 250;
const MAX_SAMPLES = 48;

interface Engine {
  last: number;
  /** Timestamps of the last second (rate window). */
  recent: number[];
  /** Last intervals (ms) for the stability figure. */
  intervals: number[];
  buckets: number[];
  samples: number[];
  total: number;
}

const fresh = (): Engine => ({ last: 0, recent: [], intervals: [], buckets: RATES.map(() => 0), samples: [], total: 0 });

function bucketOf(dt: number) {
  const rate = Math.log(1000 / dt);
  let best = 0;
  for (let i = 1; i < RATES.length; i++) if (Math.abs(Math.log(RATES[i]) - rate) < Math.abs(Math.log(RATES[best]) - rate)) best = i;
  return best;
}

/** Share of intervals within ±25 % of the median interval (0..1). */
function stability(intervals: number[]) {
  if (intervals.length < 20) return NaN;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const ok = intervals.filter((d) => Math.abs(d - median) <= median * 0.25).length;
  return ok / intervals.length;
}

export function PollingTest() {
  const t = useT();
  const padRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine>(fresh());
  const [, setVersion] = useState(0);
  const [live, setLive] = useState(0);
  const [moving, setMoving] = useState(false);
  const raw = typeof window !== "undefined" && "onpointerrawupdate" in window;

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const record = (ts: number) => {
      const e = engine.current;
      const dt = ts - e.last;
      if (e.last && dt <= 0) return; // duplicate timestamp (same report)
      if (e.last && dt < GAP_MS) {
        e.intervals.push(dt);
        if (e.intervals.length > 4000) e.intervals.splice(0, e.intervals.length - 4000);
        e.buckets[bucketOf(dt)]++;
      }
      e.last = ts;
      e.recent.push(ts);
      e.total++;
    };
    const onMove = (ev: Event) => {
      const pe = ev as PointerEvent;
      const list = pe.getCoalescedEvents?.() ?? [];
      if (list.length) for (const c of list) record(c.timeStamp);
      else record(pe.timeStamp);
    };
    const type = raw ? "pointerrawupdate" : "pointermove";
    pad.addEventListener(type, onMove);

    const timer = setInterval(() => {
      const e = engine.current;
      const now = performance.now();
      e.recent = e.recent.filter((x) => x > now - 1000);
      const win = e.recent.filter((x) => x > now - TICK_MS);
      const isMoving = now - e.last < 100 && win.length >= 3;
      if (isMoving) {
        const rate = ((win.length - 1) / (win[win.length - 1] - win[0])) * 1000;
        if (Number.isFinite(rate)) {
          e.samples.push(rate);
          if (e.samples.length > MAX_SAMPLES * 4) e.samples.splice(0, e.samples.length - MAX_SAMPLES * 4);
          setLive(rate);
        }
      } else setLive((v) => (v > 1 ? v * 0.5 : 0));
      setMoving(isMoving);
      setVersion((v) => v + 1);
    }, TICK_MS);

    return () => {
      pad.removeEventListener(type, onMove);
      clearInterval(timer);
    };
  }, [raw]);

  const e = engine.current;
  const avg = e.samples.length ? e.samples.reduce((a, b) => a + b, 0) / e.samples.length : NaN;
  const peak = e.samples.length ? Math.max(...e.samples) : NaN;
  const stab = stability(e.intervals);
  const gaugeMax = RATES.find((r) => r >= Math.max(1000, (Number.isFinite(peak) ? peak : 0) * 1.05)) ?? 8000;
  const chart = e.samples.slice(-MAX_SAMPLES);
  const totalIntervals = e.buckets.reduce((a, b) => a + b, 0);

  const reset = () => {
    engine.current = fresh();
    setLive(0);
    setVersion((v) => v + 1);
  };

  return (
    <div className="tb-stack">
      <TestHeader hint={t("testbench.polling.hint")} onReset={reset}>
        <Badge tone={raw ? "success" : undefined} dot>
          {raw ? t("testbench.polling.sourceRaw") : t("testbench.polling.sourceMove")}
        </Badge>
      </TestHeader>

      <div className="tb-split">
        <div ref={padRef} className={`tb-pad tb-pad--grid${moving ? " tb-pad--active" : ""}`}>
          <div className="tb-pad__center">
            <div className="tb-pad__big tabular">
              {Math.round(live)}
              <span>Hz</span>
            </div>
            <div className="tb-pad__label">{moving ? t("testbench.polling.measuring") : t("testbench.polling.prompt")}</div>
          </div>
        </div>

        <Card className="tb-panel">
          <div className="tb-gauge">
            <Gauge value={live} max={gaugeMax} label={t("testbench.polling.live")} unit="Hz" size={200} />
          </div>
          <div className="tb-metrics">
            <Metric label={t("testbench.polling.average")} value={fmt(avg)} unit="Hz" />
            <Metric label={t("testbench.polling.peak")} value={fmt(peak)} unit="Hz" />
            <Metric
              label={t("testbench.polling.stability")}
              value={Number.isFinite(stab) ? fmt(stab * 100) : "—"}
              unit={Number.isFinite(stab) ? "%" : undefined}
              tone={Number.isFinite(stab) ? (stab > 0.9 ? "success" : stab > 0.7 ? "warning" : "danger") : undefined}
            />
            <Metric label={t("testbench.polling.samples")} value={e.total.toLocaleString()} />
          </div>
          <div className="tb-callout">{t("testbench.polling.note")}</div>
        </Card>
      </div>

      <div className="tb-grid-2">
        <Card title={t("testbench.polling.overTime")} subtitle={t("testbench.polling.overTimeSub")}>
          {chart.length > 1 ? (
            <LineChart series={[{ name: "Hz", data: chart }]} height={180} yMin={0} yMax={gaugeMax} unit="" />
          ) : (
            <div className="tb-chart-empty">{t("testbench.polling.noData")}</div>
          )}
        </Card>
        <Card title={t("testbench.polling.histogram")} subtitle={t("testbench.polling.histogramSub")}>
          <BarChart
            height={180}
            data={RATES.map((r, i) => ({ label: r >= 1000 ? `${r / 1000}k` : String(r), value: totalIntervals ? Math.round((e.buckets[i] / totalIntervals) * 100) : 0 }))}
          />
        </Card>
      </div>
    </div>
  );
}
