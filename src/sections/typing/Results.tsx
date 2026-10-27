import { useMemo, useState } from "react";
import { ArrowRight, RotateCcw, Ghost as GhostIcon, Image as ImageIcon, Download, Keyboard as KeyboardIcon, Trophy } from "lucide-react";
import { Badge, Button, Card, KeyboardView, Kbd, LineChart, toast } from "@/ui";
import { useT } from "@/i18n";
import { useSettings } from "@/core/state/settings";
import { HEAT_GRADIENT, heatColor, keyHeat } from "@/core/typing/progress";
import { renderShareCard, downloadCanvas, downloadBlob } from "@/core/typing/share";
import { chordLabel } from "@/core/typing/drills";
import type { RGB, TypingResult } from "@/core/types";
import type { Trainer } from "./useTrainer";
import type { TypingKeyboard } from "./useKeyboard";
import { describeConfig, formatDate } from "./labels";

export function Results({ trainer, kb }: { trainer: Trainer; kb: TypingKeyboard }) {
  const o = trainer.outcome;
  if (!o) return null;
  return o.kind === "text" ? <TextResults trainer={trainer} kb={kb} /> : <DrillResults trainer={trainer} />;
}

function Actions({ trainer, result, kb, ghost }: { trainer: Trainer; result: TypingResult; kb: TypingKeyboard; ghost?: boolean }) {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const share = async () => {
    const canvas = await renderShareCard({
      result,
      keys: kb.keys,
      size: kb.size,
      text: {
        mode: describeConfig(t, result.mode, result.config, result.language),
        wpm: t("typing.results.wpm"),
        accuracy: t("typing.results.accuracy"),
        consistency: t("typing.results.consistency"),
        raw: t("typing.results.raw"),
        time: t("typing.results.time"),
        date: formatDate(result.date, lang),
        tagline: t("typing.share.tagline"),
      },
    });
    downloadCanvas(canvas, `keyhalo-${Math.round(result.wpm)}wpm.png`);
    toast(t("typing.share.saved"));
  };
  const exportGhost = () => {
    downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }), `keyhalo-ghost-${Math.round(result.wpm)}wpm.json`);
    toast(t("typing.share.ghostSaved"));
  };
  return (
    <div className="typing-results__actions">
      <Button variant="primary" icon={<ArrowRight />} onClick={trainer.next}>
        {t("typing.results.next")} <Kbd>Enter</Kbd>
      </Button>
      <Button icon={<RotateCcw />} onClick={trainer.restart}>
        {t("typing.results.retry")} <Kbd>Esc</Kbd>
      </Button>
      <div className="grow" />
      {ghost && result.replay && (
        <Button variant="ghost" icon={<GhostIcon />} onClick={() => trainer.setGhostFile({ ...result, id: `${result.id}-race` })}>
          {t("typing.results.raceThis")}
        </Button>
      )}
      {ghost && result.replay && (
        <Button variant="ghost" icon={<Download />} onClick={exportGhost}>
          {t("typing.results.exportGhost")}
        </Button>
      )}
      <Button variant="ghost" icon={<ImageIcon />} onClick={() => void share()}>
        {t("typing.results.share")}
      </Button>
    </div>
  );
}

function TextResults({ trainer, kb }: { trainer: Trainer; kb: TypingKeyboard }) {
  const t = useT();
  const o = trainer.outcome;
  if (o?.kind !== "text") return null;
  const { report } = o;
  const r = report.result;
  const b = report.breakdown;
  const pBest = o.previousBest;

  return (
    <div className="typing-results">
      <div className="typing-results__hero">
        <div className="typing-results__main">
          <div className="typing-results__mode">
            {describeConfig(t, r.mode, r.config, r.language)}
            {o.demo && <Badge>{t("typing.results.demo")}</Badge>}
          </div>
          <div className="typing-results__wpm">
            <span className="tabular">{Math.round(r.wpm)}</span>
            <span className="typing-results__unit">{t("typing.results.wpm")}</span>
          </div>
          <div className="typing-results__badges">
            {o.best ? (
              <Badge tone="success">
                <Trophy size={11} /> {t("typing.results.newBest")}
              </Badge>
            ) : (
              pBest !== undefined && <span className="subtle">{t("typing.results.prevBest", { wpm: Math.round(pBest) })}</span>
            )}
          </div>
        </div>
        <div className="typing-results__stats">
          <Metric label={t("typing.results.accuracy")} value={(r.accuracy * 100).toFixed(1)} unit="%" />
          <Metric label={t("typing.results.consistency")} value={Math.round(r.consistency * 100)} unit="%" />
          <Metric label={t("typing.results.raw")} value={Math.round(r.rawWpm)} unit={t("typing.results.wpm")} />
          <Metric label={t("typing.results.time")} value={(r.durationMs / 1000).toFixed(r.durationMs < 10_000 ? 1 : 0)} unit="s" />
          <Metric
            label={t("typing.results.chars")}
            value={
              <span className="typing-results__chars">
                <span>{b.correct + b.corrected}</span>/<span className="is-err">{b.wrong}</span>/<span className="is-fix">{b.corrected}</span>/<span className="is-err">{r.errors}</span>
              </span>
            }
            hint={t("typing.results.charsHint")}
          />
        </div>
      </div>

      <Actions trainer={trainer} result={r} kb={kb} ghost />

      <div className="typing-results__grid">
        <Card title={t("typing.results.speed")} actions={<Legend />}>
          <SpeedChart report={report} />
        </Card>
        <Card title={t("typing.results.bigrams")}>
          <Bigrams bigrams={report.bigrams} />
        </Card>
      </div>

      <HeatmapCard trainer={trainer} kb={kb} keys={r.keys} />
    </div>
  );
}

function Metric({ label, value, unit, hint }: { label: string; value: React.ReactNode; unit?: string; hint?: string }) {
  return (
    <div className="typing-metric" title={hint}>
      <div className="typing-metric__label">{label}</div>
      <div className="typing-metric__value">
        {value}
        {unit && <span className="typing-metric__unit">{unit}</span>}
      </div>
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <div className="typing-legend">
      <span>
        <i style={{ background: "var(--chart-1)" }} /> {t("typing.results.netWpm")}
      </span>
      <span>
        <i style={{ background: "var(--chart-2)" }} /> {t("typing.results.rawWpm")}
      </span>
      <span>
        <i className="is-dot" style={{ background: "var(--danger)" }} /> {t("typing.results.errorsPerSecond")}
      </span>
    </div>
  );
}

function SpeedChart({ report }: { report: Extract<NonNullable<Trainer["outcome"]>, { kind: "text" }>["report"] }) {
  const tl = report.timeline;
  // Smooth raw speed over 3 s so the line reads as rhythm, not noise.
  const raw = tl.map((_, i) => {
    const w = tl.slice(Math.max(0, i - 1), i + 2);
    return w.reduce((a, p) => a + p.raw, 0) / w.length;
  });
  const hi = Math.max(10, ...raw, ...tl.map((p) => p.wpm));
  const yMax = Math.ceil((hi * 1.1) / 10) * 10;
  return (
    <div className="typing-speed">
      <LineChart
        height={190}
        yMin={0}
        yMax={yMax}
        labels={tl.map((p) => `${p.s}s`)}
        series={[
          { name: "raw", data: raw, color: "var(--chart-2)" },
          { name: "wpm", data: tl.map((p) => p.wpm), color: "var(--chart-1)" },
        ]}
      />
      <div className="typing-speed__errors" aria-hidden>
        {tl.map((p) => (
          <span key={p.s} style={{ opacity: p.errors ? 1 : 0 }} title={`${p.s}s · ${p.errors}`}>
            {p.errors > 1 && <b>{p.errors}</b>}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bigrams({ bigrams }: { bigrams: { pair: string; avgMs: number; count: number }[] }) {
  const t = useT();
  const list = bigrams.filter((b) => b.count >= 2).slice(0, 8);
  const shown = list.length >= 3 ? list : bigrams.slice(0, 8);
  if (!shown.length) return <div className="subtle" style={{ fontSize: "var(--text-sm)" }}>{t("typing.results.bigramsEmpty")}</div>;
  const max = Math.max(...shown.map((b) => b.avgMs));
  const min = Math.min(...shown.map((b) => b.avgMs));
  // Spread the bars between the fastest and slowest pair shown, so differences are visible.
  const width = (ms: number) => (max === min ? 100 : 30 + ((ms - min) / (max - min)) * 70);
  return (
    <div className="typing-bigrams">
      {shown.map((b) => (
        <div key={b.pair} className="typing-bigram">
          <span className="typing-bigram__pair">{b.pair.replace(/ /g, "␣")}</span>
          <span className="typing-bigram__bar">
            <i style={{ width: `${width(b.avgMs)}%` }} />
          </span>
          <span className="typing-bigram__ms tabular">
            {b.avgMs}
            <small>ms</small>
          </span>
        </div>
      ))}
    </div>
  );
}

export function HeatmapCard({ trainer, kb, keys, title }: { trainer?: Trainer; kb: TypingKeyboard; keys: TypingResult["keys"]; title?: string }) {
  const t = useT();
  const colors = useMemo(() => {
    const heat = keyHeat(keys, 1);
    const c: Record<string, RGB> = {};
    for (const [code, v] of Object.entries(heat)) c[code] = heatColor(v);
    return c;
  }, [keys]);
  const badges = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [code, k] of Object.entries(keys)) if (k.misses > 0 && code !== "Space") out[code] = String(k.misses);
    return out;
  }, [keys]);
  const [, setTick] = useState(0);
  return (
    <Card
      title={title ?? t("typing.results.heatmap")}
      subtitle={t("typing.results.heatmapHint")}
      actions={
        <>
          <div className="typing-heat-legend">
            <span>{t("typing.results.fast")}</span>
            <i style={{ background: HEAT_GRADIENT }} />
            <span>{t("typing.results.slow")}</span>
          </div>
          {trainer && (
            <Button
              size="sm"
              icon={<KeyboardIcon />}
              disabled={trainer.heatShowing}
              onClick={() => {
                trainer.showHeatOnKeyboard(keys);
                setTick((x) => x + 1);
              }}
            >
              {trainer.heatShowing ? t("typing.results.showingOnKeyboard") : t("typing.results.showOnKeyboard")}
            </Button>
          )}
        </>
      }
    >
      <KeyboardView keys={kb.keys} size={kb.size} colors={colors} badges={badges} maxWidth={900} glow={0.9} />
    </Card>
  );
}

function DrillResults({ trainer }: { trainer: Trainer }) {
  const t = useT();
  const o = trainer.outcome;
  if (o?.kind !== "drill") return null;
  const r = o.report;
  return (
    <div className="typing-results">
      <div className="typing-results__hero">
        <div className="typing-results__main">
          <div className="typing-results__mode">{describeConfig(t, r.mode, r.config, r.language)}</div>
          <div className="typing-results__wpm">
            <span className="tabular">{Math.round(r.wpm)}</span>
            <span className="typing-results__unit">{t("typing.results.chordsPerMin")}</span>
          </div>
          <div className="typing-results__badges">
            {o.best && (
              <Badge tone="success">
                <Trophy size={11} /> {t("typing.results.newBest")}
              </Badge>
            )}
          </div>
        </div>
        <div className="typing-results__stats">
          <Metric label={t("typing.results.accuracy")} value={(r.accuracy * 100).toFixed(1)} unit="%" />
          <Metric label={t("typing.results.avgReaction")} value={r.avgMs} unit="ms" />
          <Metric label={t("typing.results.consistency")} value={Math.round(r.consistency * 100)} unit="%" />
          <Metric label={t("typing.results.errors")} value={r.errors} />
          <Metric label={t("typing.results.time")} value={(r.durationMs / 1000).toFixed(1)} unit="s" />
        </div>
      </div>
      <div className="typing-results__actions">
        <Button variant="primary" icon={<ArrowRight />} onClick={trainer.next}>
          {t("typing.results.next")} <Kbd>Enter</Kbd>
        </Button>
        <Button icon={<RotateCcw />} onClick={trainer.restart}>
          {t("typing.results.retry")} <Kbd>Esc</Kbd>
        </Button>
      </div>
      <Card title={t("typing.results.slowestChords")}>
        <div className="typing-bigrams">
          {r.slowest.map(({ item, ms }) => (
            <div key={item.id + ms} className="typing-bigram typing-bigram--wide">
              <span className="typing-bigram__label">{item.prompt}</span>
              <span className="row" style={{ gap: 4 }}>
                {chordLabel(item.chord).map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
              <span className="typing-bigram__ms tabular">
                {ms}
                <small>ms</small>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
