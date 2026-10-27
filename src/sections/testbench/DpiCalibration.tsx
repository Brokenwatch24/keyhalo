import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Badge, Button, Card, Input, Kbd, Segmented } from "@/ui";
import { useT } from "@/i18n";
import { primaryMouse, useDevices } from "@/core/devices";
import { Metric, TestHeader, fmt, lockPointer, usePointerLocked, type LockMode } from "./shared";

const DISTANCES = {
  "5cm": { inches: 5 / 2.54, value: 5, unit: "cm" },
  "10cm": { inches: 10 / 2.54, value: 10, unit: "cm" },
  "20cm": { inches: 20 / 2.54, value: 20, unit: "cm" },
  "4in": { inches: 4, value: 4, unit: "in" },
} as const;
type DistanceId = keyof typeof DISTANCES;
const MAX_TRIALS = 5;

/** Ruler drawing with a marker at the distance the configured DPI predicts for the live counts. */
function Ruler({ value, unit, progress }: { value: number; unit: "cm" | "in"; progress: number | null }) {
  const W = 1000;
  const sub = unit === "cm" ? 10 : 8; // mm / eighths
  const ticks = value * sub;
  const x = (i: number) => 22 + (i / ticks) * (W - 84);
  return (
    <svg viewBox={`0 0 ${W} 92`} className="tb-ruler" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x="2" y="8" width={W - 4} height="62" rx="8" className="tb-ruler__body" />
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const major = i % sub === 0;
        const half = i % (sub / 2) === 0;
        return <line key={i} x1={x(i)} x2={x(i)} y1={8} y2={8 + (major ? 26 : half ? 18 : 10)} className={major ? "tb-ruler__major" : "tb-ruler__minor"} />;
      })}
      {Array.from({ length: value + 1 }, (_, i) => (
        <text key={i} x={x(i * sub)} y={54} textAnchor="middle" className="tb-ruler__num">
          {i}
        </text>
      ))}
      {progress !== null && (
        <g>
          <rect x={x(0)} y={74} width={Math.max(0, Math.min(1.08, progress)) * (x(ticks) - x(0))} height="6" rx="3" className="tb-ruler__fill" />
        </g>
      )}
      <text x={W - 16} y={54} textAnchor="end" className="tb-ruler__unit">
        {unit}
      </text>
    </svg>
  );
}

export function DpiCalibration() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const live = useDevices((s) => s.live);
  const mouse = primaryMouse(devices);
  const mouseLive = mouse ? live[mouse.uid] : undefined;
  const deviceDpi = mouseLive?.dpi?.x ?? mouseLive?.mouse?.dpiStages[mouseLive.mouse.activeStage]?.x;
  const [manualDpi, setManualDpi] = useState("800");
  const configured = deviceDpi ?? (Number(manualDpi) || 0);

  const [distance, setDistance] = useState<DistanceId>("10cm");
  const dist = DISTANCES[distance];
  const wrapRef = useRef<HTMLDivElement>(null);
  const locked = usePointerLocked(wrapRef);
  const [mode, setMode] = useState<LockMode | null>(null);
  const [dragging, setDragging] = useState(false);
  const [liveCounts, setLiveCounts] = useState(0);
  const [trials, setTrials] = useState<number[]>([]);
  const acc = useRef({ x: 0, y: 0, on: false });

  useEffect(() => {
    if (!locked) return;
    const onMove = (e: MouseEvent) => {
      if (!acc.current.on) return;
      acc.current.x += e.movementX;
      acc.current.y += e.movementY;
      setLiveCounts(Math.hypot(acc.current.x, acc.current.y));
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      acc.current = { x: 0, y: 0, on: true };
      setLiveCounts(0);
      setDragging(true);
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0 || !acc.current.on) return;
      acc.current.on = false;
      setDragging(false);
      const counts = Math.hypot(acc.current.x, acc.current.y);
      if (counts > 20) setTrials((tr) => [...tr, counts / dist.inches].slice(-MAX_TRIALS));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      acc.current.on = false;
      setDragging(false);
    };
  }, [locked, dist.inches]);

  const start = async () => {
    if (wrapRef.current) setMode(await lockPointer(wrapRef.current));
  };
  const reset = () => {
    setTrials([]);
    setLiveCounts(0);
    acc.current = { x: 0, y: 0, on: false };
  };

  const measured = trials.length ? trials.reduce((a, b) => a + b, 0) / trials.length : NaN;
  const deviation = Number.isFinite(measured) && configured > 0 ? ((measured - configured) / configured) * 100 : NaN;
  const spread = trials.length > 1 ? Math.max(...trials) - Math.min(...trials) : NaN;
  const tone = Number.isFinite(deviation) ? (Math.abs(deviation) < 3 ? "success" : Math.abs(deviation) < 8 ? "warning" : "danger") : undefined;
  const progress = configured > 0 && (dragging || liveCounts > 0) ? liveCounts / configured / dist.inches : null;

  return (
    <div className="tb-stack">
      <TestHeader hint={t("testbench.dpi.hint")} onReset={reset}>
        {mode && <Badge tone={mode === "raw" ? "success" : "warning"} dot>{mode === "raw" ? t("testbench.lock.raw") : t("testbench.lock.adjusted")}</Badge>}
        <Segmented
          value={distance}
          onChange={(v) => {
            setDistance(v);
            reset();
          }}
          options={(Object.keys(DISTANCES) as DistanceId[]).map((id) => ({ value: id, label: `${DISTANCES[id].value} ${DISTANCES[id].unit}` }))}
        />
      </TestHeader>

      <div className="tb-split">
        <div ref={wrapRef} className={`tb-pad tb-pad--dpi${locked ? " tb-pad--active" : ""}`}>
          <div className="tb-dpi">
            <ol className="tb-steps">
              <li>{t("testbench.dpi.step1")}</li>
              <li>{t("testbench.dpi.step2", { d: `${dist.value} ${dist.unit}` })}</li>
              <li>{t("testbench.dpi.step3")}</li>
            </ol>
            <Ruler value={dist.value} unit={dist.unit} progress={progress} />
            <div className="tb-dpi__live">
              <span className="tb-pad__big tb-pad__big--sm tabular">
                {Math.round(liveCounts).toLocaleString()}
                <span>{t("testbench.counts")}</span>
              </span>
              <span className="tb-pad__label">
                {locked ? (dragging ? t("testbench.dpi.measuring") : t("testbench.dpi.holdToMeasure")) : t("testbench.dpi.prompt")}
              </span>
            </div>
            {!locked ? (
              <Button variant="primary" icon={<Lock />} onClick={start}>
                {t("testbench.lock.start")}
              </Button>
            ) : (
              <div className="tb-pad__label">
                {t("testbench.lock.release")} <Kbd>Esc</Kbd>
              </div>
            )}
          </div>
        </div>

        <Card className="tb-panel">
          <div className="tb-metrics">
            <Metric label={t("testbench.dpi.measured")} value={Number.isFinite(measured) ? fmt(measured) : "—"} unit="DPI" />
            <Metric
              label={t("testbench.dpi.configured")}
              value={deviceDpi !== undefined ? deviceDpi : <Input className="tb-dpi__input" type="number" min={50} step={50} value={manualDpi} onChange={(e) => setManualDpi(e.target.value)} />}
              unit="DPI"
              hint={mouse ? mouse.definition.name : t("testbench.dpi.noMouse")}
            />
            <Metric
              label={t("testbench.dpi.deviation")}
              value={Number.isFinite(deviation) ? `${deviation > 0 ? "+" : ""}${fmt(deviation, 1)}` : "—"}
              unit={Number.isFinite(deviation) ? "%" : undefined}
              tone={tone}
            />
            <Metric label={t("testbench.dpi.spread")} value={Number.isFinite(spread) ? fmt(spread) : "—"} unit={Number.isFinite(spread) ? "DPI" : undefined} />
          </div>
          <div className="tb-trials">
            <div className="tb-metric__label">{t("testbench.dpi.trials", { n: trials.length, max: MAX_TRIALS })}</div>
            <div className="tb-trials__row">
              {Array.from({ length: MAX_TRIALS }, (_, i) => (
                <div key={i} className={`tb-trial${trials[i] ? " tb-trial--done" : ""}`}>
                  {trials[i] ? fmt(trials[i]) : "—"}
                </div>
              ))}
            </div>
          </div>
          <div className={`tb-callout${mode === "adjusted" ? " tb-callout--warn" : ""}`}>
            {mode === "adjusted" ? t("testbench.dpi.adjustedWarning") : t("testbench.dpi.note")}
          </div>
        </Card>
      </div>
    </div>
  );
}
