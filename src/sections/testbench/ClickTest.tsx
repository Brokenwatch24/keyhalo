import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Badge, Card, Progress, Segmented } from "@/ui";
import { useT } from "@/i18n";
import { Metric, TestHeader, fmt } from "./shared";

/** Two presses of the same button closer than this are flagged as a possible double-click fault. */
const CHATTER_MS = 80;
/** DOM `MouseEvent.button` → label key, in display order. */
const BUTTONS = [
  { id: 0, key: "left" },
  { id: 2, key: "right" },
  { id: 1, key: "middle" },
  { id: 3, key: "back" },
  { id: 4, key: "forward" },
] as const;

interface LogEntry {
  n: number;
  button: number;
  dt: number | null;
  flagged: boolean;
}

type Phase = "idle" | "running" | "done";

export function ClickTest() {
  const t = useT();
  const [duration, setDuration] = useState<"5" | "10">("5");
  const [phase, setPhase] = useState<Phase>("idle");
  const [clicks, setClicks] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0, 0]);
  const [chatter, setChatter] = useState<number[]>([0, 0, 0, 0, 0]);
  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const lastDown = useRef<number[]>([0, 0, 0, 0, 0]);
  const startAt = useRef(0);
  const cooldownUntil = useRef(0);
  const seq = useRef(0);
  const runClicks = useRef(0);

  const seconds = Number(duration);

  // Run timer.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => {
      const ms = performance.now() - startAt.current;
      setElapsed(Math.min(ms, seconds * 1000));
      if (ms >= seconds * 1000) {
        setPhase("done");
        cooldownUntil.current = performance.now() + 700;
        const cps = runClicks.current / seconds;
        setBest((b) => (cps > (b[duration] ?? 0) ? { ...b, [duration]: cps } : b));
      }
    }, 40);
    return () => clearInterval(timer);
  }, [phase, seconds, duration]);

  // Side buttons navigate back/forward in the webview: swallow them while this test is open.
  useEffect(() => {
    const guard = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    window.addEventListener("mouseup", guard, true);
    window.addEventListener("mousedown", guard, true);
    window.addEventListener("auxclick", guard, true);
    return () => {
      window.removeEventListener("mouseup", guard, true);
      window.removeEventListener("mousedown", guard, true);
      window.removeEventListener("auxclick", guard, true);
    };
  }, []);

  const onDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    const b = e.button;
    if (b < 0 || b > 4) return;
    const now = e.timeStamp;
    const prev = lastDown.current[b];
    const dt = prev ? now - prev : null;
    const flagged = dt !== null && dt < CHATTER_MS;
    lastDown.current[b] = now;
    setCounts((c) => c.map((v, i) => (i === b ? v + 1 : v)));
    if (flagged) setChatter((c) => c.map((v, i) => (i === b ? v + 1 : v)));
    setPressed((p) => new Set(p).add(b));
    const entry: LogEntry = { n: ++seq.current, button: b, dt, flagged };
    setLog((l) => [entry, ...l].slice(0, 9));

    if (phase === "running") {
      runClicks.current++;
      setClicks(runClicks.current);
    } else if (performance.now() > cooldownUntil.current) {
      startAt.current = performance.now();
      runClicks.current = 1;
      setClicks(1);
      setElapsed(0);
      setPhase("running");
    }
  };

  const onUp = (e: ReactMouseEvent) => {
    e.preventDefault();
    const b = e.button;
    setPressed((p) => {
      const n = new Set(p);
      n.delete(b);
      return n;
    });
  };

  const reset = () => {
    setPhase("idle");
    setClicks(0);
    setElapsed(0);
    setCounts([0, 0, 0, 0, 0]);
    setChatter([0, 0, 0, 0, 0]);
    setLog([]);
    lastDown.current = [0, 0, 0, 0, 0];
    runClicks.current = 0;
  };

  const liveCps = phase === "running" && elapsed > 250 ? clicks / (elapsed / 1000) : phase === "done" ? clicks / seconds : 0;
  const buttonName = (id: number) => t(`testbench.clicks.buttons.${BUTTONS.find((x) => x.id === id)?.key ?? "left"}`);
  const totalChatter = chatter.reduce((a, b) => a + b, 0);

  return (
    <div className="tb-stack">
      <TestHeader hint={t("testbench.clicks.hint", { ms: CHATTER_MS })} onReset={reset}>
        <Segmented
          value={duration}
          onChange={(v) => {
            setDuration(v);
            setPhase("idle");
            setClicks(0);
            setElapsed(0);
          }}
          options={[
            { value: "5", label: "5 s" },
            { value: "10", label: "10 s" },
          ]}
        />
      </TestHeader>

      <div className="tb-split">
        <div
          className={`tb-pad tb-pad--click${phase === "running" ? " tb-pad--active" : ""}`}
          onMouseDown={onDown}
          onMouseUp={onUp}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="tb-pad__center">
            {phase === "idle" && (
              <>
                <div className="tb-pad__big tabular">
                  0<span>CPS</span>
                </div>
                <div className="tb-pad__label">{t("testbench.clicks.prompt", { s: seconds })}</div>
              </>
            )}
            {phase === "running" && (
              <>
                <div className="tb-pad__big tabular">
                  {clicks}
                  <span>{t("testbench.clicks.clicksUnit")}</span>
                </div>
                <div className="tb-pad__label tabular">
                  {fmt(liveCps, 1)} CPS · {fmt(Math.max(0, seconds - elapsed / 1000), 1)} s
                </div>
                <div className="tb-pad__progress">
                  <Progress value={elapsed / (seconds * 1000)} />
                </div>
              </>
            )}
            {phase === "done" && (
              <>
                <div className="tb-pad__big tabular">
                  {fmt(clicks / seconds, 1)}
                  <span>CPS</span>
                </div>
                <div className="tb-pad__label">{t("testbench.clicks.result", { clicks, s: seconds })}</div>
              </>
            )}
          </div>
        </div>

        <Card className="tb-panel">
          <div className="tb-metrics">
            <Metric label={t("testbench.clicks.cps")} value={fmt(liveCps, 1)} />
            <Metric label={t("testbench.clicks.best", { s: seconds })} value={best[duration] ? fmt(best[duration], 1) : "—"} />
            <Metric label={t("testbench.clicks.total")} value={counts.reduce((a, b) => a + b, 0)} />
            <Metric label={t("testbench.clicks.flagged")} value={totalChatter} tone={totalChatter ? "danger" : undefined} />
          </div>
          <div className="tb-buttons">
            {BUTTONS.map((b) => (
              <div key={b.id} className={`tb-button${pressed.has(b.id) ? " tb-button--down" : ""}${chatter[b.id] ? " tb-button--bad" : ""}`}>
                <span className="tb-button__name">{t(`testbench.clicks.buttons.${b.key}`)}</span>
                <span className="tb-button__count tabular">{counts[b.id]}</span>
                <span className="tb-button__chatter">{chatter[b.id] ? t("testbench.clicks.doubles", { n: chatter[b.id] }) : " "}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={t("testbench.clicks.log")} subtitle={t("testbench.clicks.logSub", { ms: CHATTER_MS })} flush>
        {log.length === 0 ? (
          <div className="tb-chart-empty">{t("testbench.clicks.noClicks")}</div>
        ) : (
          <div className="tb-log">
            {log.map((l) => (
              <div key={l.n} className="tb-log__row">
                <span className="subtle tabular">#{l.n}</span>
                <span>{buttonName(l.button)}</span>
                <span className="mono tabular">{l.dt === null ? "—" : `${fmt(l.dt, 1)} ms`}</span>
                <span>{l.flagged ? <Badge tone="danger">{t("testbench.clicks.doubleClick")}</Badge> : <span className="subtle">{t("testbench.clicks.ok")}</span>}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
