import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Card } from "@/ui";
import { useT } from "@/i18n";
import { Metric, TestHeader, fmt } from "./shared";

const TRIES = 5;
const MIN_WAIT = 1500;
const MAX_WAIT = 4500;

type Phase = "idle" | "waiting" | "go" | "early" | "result" | "done";

export function ReactionTest() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [tries, setTries] = useState<number[]>([]);
  const [falseStarts, setFalseStarts] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const goAt = useRef(0);
  const padRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const arm = () => {
    clearTimeout(timer.current);
    setPhase("waiting");
    timer.current = setTimeout(
      () => {
        setPhase("go");
        // Time from the frame that paints the colour change.
        requestAnimationFrame((ts) => (goAt.current = ts));
      },
      MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT),
    );
  };

  const hit = (e: SyntheticEvent) => {
    e.preventDefault();
    const now = e.timeStamp;
    switch (phase) {
      case "idle":
      case "early":
      case "result":
        arm();
        break;
      case "done":
        setTries([]);
        setFalseStarts(0);
        arm();
        break;
      case "waiting":
        clearTimeout(timer.current);
        setFalseStarts((n) => n + 1);
        setPhase("early");
        break;
      case "go": {
        const rt = now - (goAt.current || now);
        const next = [...tries, rt];
        setTries(next);
        setPhase(next.length >= TRIES ? "done" : "result");
        break;
      }
    }
  };

  const reset = () => {
    clearTimeout(timer.current);
    setTries([]);
    setFalseStarts(0);
    setPhase("idle");
  };

  const avg = tries.length ? tries.reduce((a, b) => a + b, 0) / tries.length : NaN;
  const best = tries.length ? Math.min(...tries) : NaN;
  const last = tries[tries.length - 1];

  const title: Record<Phase, string> = {
    idle: t("testbench.reaction.idle"),
    waiting: t("testbench.reaction.waiting"),
    go: t("testbench.reaction.go"),
    early: t("testbench.reaction.early"),
    result: `${fmt(last ?? 0)} ms`,
    done: `${fmt(avg)} ms`,
  };
  const sub: Record<Phase, string> = {
    idle: t("testbench.reaction.idleSub", { n: TRIES }),
    waiting: t("testbench.reaction.waitingSub"),
    go: " ",
    early: t("testbench.reaction.earlySub"),
    result: t("testbench.reaction.resultSub", { n: tries.length, total: TRIES }),
    done: t("testbench.reaction.doneSub"),
  };

  return (
    <div className="tb-stack">
      <TestHeader hint={t("testbench.reaction.hint", { n: TRIES })} onReset={reset} />

      <div className="tb-split">
        <div
          ref={padRef}
          tabIndex={0}
          role="button"
          className={`tb-pad tb-react tb-react--${phase}`}
          onPointerDown={hit}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) hit(e);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="tb-pad__center">
            <div className="tb-react__title tabular">{title[phase]}</div>
            <div className="tb-react__sub">{sub[phase]}</div>
          </div>
        </div>

        <Card className="tb-panel">
          <div className="tb-metrics">
            <Metric label={t("testbench.reaction.average")} value={fmt(avg)} unit={tries.length ? "ms" : undefined} />
            <Metric label={t("testbench.reaction.best")} value={fmt(best)} unit={tries.length ? "ms" : undefined} />
            <Metric label={t("testbench.reaction.tries")} value={tries.length} unit={`/ ${TRIES}`} />
            <Metric label={t("testbench.reaction.falseStarts")} value={falseStarts} tone={falseStarts ? "warning" : undefined} />
          </div>
          <div className="tb-trials">
            <div className="tb-trials__row">
              {Array.from({ length: TRIES }, (_, i) => (
                <div key={i} className={`tb-trial${tries[i] !== undefined ? " tb-trial--done" : ""}${tries[i] !== undefined && tries[i] === best ? " tb-trial--best" : ""}`}>
                  {tries[i] !== undefined ? fmt(tries[i]) : "—"}
                </div>
              ))}
            </div>
          </div>
          <div className="tb-callout">{t("testbench.reaction.note")}</div>
        </Card>
      </div>
    </div>
  );
}
