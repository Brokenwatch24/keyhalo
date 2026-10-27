import { useMemo, useState } from "react";
import { Flame, Gauge as GaugeIcon, History, Timer, Trophy, Unlock, RotateCcw, Trash2, Lock, Ghost as GhostIcon } from "lucide-react";
import { BarChart, Button, Card, EmptyState, LineChart, Modal, Stat } from "@/ui";
import { useT } from "@/i18n";
import { useSettings } from "@/core/state/settings";
import { useTyping } from "@/core/typing/store";
import { LETTER_ORDER, letterScore, letterWpm, unlockedLetters, initialAdaptive } from "@/core/typing/adaptive";
import { aggToKeys, dayKey, streak } from "@/core/typing/progress";
import type { Lang } from "@/core/typing/generate";
import { HeatmapCard } from "./Results";
import { formatDate, pct, resultLabel } from "./labels";
import type { TypingKeyboard } from "./useKeyboard";
import type { Trainer } from "./useTrainer";

export function isDrill(config: string | undefined, mode: string) {
  return mode === "shortcuts" || !!config?.startsWith("fnkeys");
}

function minutes(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function Progress({ kb, trainer, onRace }: { kb: TypingKeyboard; trainer: Trainer; onRace: () => void }) {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const history = useTyping((s) => s.history);
  const bests = useTyping((s) => s.bests);
  const daily = useTyping((s) => s.daily);
  const keyAgg = useTyping((s) => s.keys);
  const prefs = useTyping((s) => s.prefs);
  const clearHistory = useTyping((s) => s.clearHistory);
  const [confirmClear, setConfirmClear] = useState(false);

  // Chord drills store chords/min in `wpm`; keep them out of the speed charts.
  const text = useMemo(() => history.filter((r) => !isDrill(r.config, r.mode)), [history]);
  const last30 = text.slice(-30);
  const last10 = text.slice(-10);
  const best = text.reduce((m, r) => Math.max(m, r.wpm), 0);
  const avg = last10.length ? last10.reduce((a, r) => a + r.wpm, 0) / last10.length : 0;
  const total = Object.values(daily).reduce((a, b) => a + b, 0);
  const today = daily[dayKey(new Date())] ?? 0;
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return { label: d.toLocaleDateString(lang, { weekday: "narrow" }), value: Math.round((daily[dayKey(d)] ?? 0) / 60000) };
  });
  const bestList = Object.entries(bests).sort((a, b) => b[1].wpm - a[1].wpm);

  return (
    <div className="typing-progress">
      <div className="typing-progress__stats">
        <Card>
          <Stat icon={<History />} label={t("typing.progress.sessions")} value={history.length} />
        </Card>
        <Card>
          <Stat icon={<Trophy />} label={t("typing.progress.bestWpm")} value={Math.round(best)} unit="wpm" />
        </Card>
        <Card>
          <Stat icon={<GaugeIcon />} label={t("typing.progress.avgWpm")} value={Math.round(avg)} unit="wpm" />
        </Card>
        <Card>
          <Stat icon={<Flame />} label={t("typing.progress.streak")} value={streak(daily)} unit={t("typing.progress.days")} />
        </Card>
        <Card>
          <Stat icon={<Timer />} label={t("typing.progress.today")} value={minutes(today)} hint={`${t("typing.progress.total")} ${minutes(total)}`} />
        </Card>
      </div>

      {history.length === 0 ? (
        <Card>
          <EmptyState icon={<History />} title={t("typing.progress.empty")}>
            {t("typing.progress.emptyHint")}
          </EmptyState>
        </Card>
      ) : (
        <div className="typing-progress__grid">
          <Card title={t("typing.progress.history")} actions={<HistoryLegend />}>
            <LineChart
              height={200}
              yMin={0}
              labels={last30.map((r) => formatDate(r.date, lang, true).replace(/,.*/, ""))}
              series={[
                { name: "raw", data: last30.map((r) => r.rawWpm), color: "var(--chart-2)" },
                { name: "wpm", data: last30.map((r) => r.wpm), color: "var(--chart-1)" },
              ]}
            />
          </Card>
          <Card title={t("typing.progress.daily")}>
            <BarChart data={days} height={200} />
          </Card>
        </div>
      )}

      <AdaptiveLetters language={prefs.language} />

      <Card title={t("typing.progress.bests")} flush>
        {bestList.length === 0 ? (
          <div className="typing-progress__empty">{t("typing.progress.noBests")}</div>
        ) : (
          <table className="typing-table">
            <thead>
              <tr>
                <th>{t("typing.progress.config")}</th>
                <th className="num">wpm</th>
                <th className="num">{t("typing.results.accuracy")}</th>
                <th className="num">{t("typing.results.consistency")}</th>
                <th>{t("typing.progress.date")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bestList.map(([key, r]) => (
                <tr key={key}>
                  <td>{resultLabel(t, r)}</td>
                  <td className="num strong">{Math.round(r.wpm)}</td>
                  <td className="num">{pct(r.accuracy, 1)}</td>
                  <td className="num">{pct(r.consistency)}</td>
                  <td className="subtle">{formatDate(r.date, lang)}</td>
                  <td className="actions">
                    {r.replay && r.text && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<GhostIcon />}
                        onClick={() => {
                          trainer.setGhostFile({ ...r, id: `${r.id}-race-${Date.now()}` });
                          onRace();
                        }}
                      >
                        {t("typing.progress.race")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {keyAgg[prefs.language] && Object.keys(keyAgg[prefs.language]).length > 0 && <HeatmapCard kb={kb} keys={aggToKeys(keyAgg[prefs.language])} title={`${t("typing.progress.keys")} · ${prefs.language.toUpperCase()}`} />}

      {history.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="danger" size="sm" icon={<Trash2 />} onClick={() => setConfirmClear(true)}>
            {t("typing.progress.clear")}
          </Button>
        </div>
      )}
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t("typing.progress.clear")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearHistory();
                setConfirmClear(false);
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="muted">{t("typing.progress.clearConfirm")}</p>
      </Modal>
    </div>
  );
}

function HistoryLegend() {
  const t = useT();
  return (
    <div className="typing-legend">
      <span>
        <i style={{ background: "var(--chart-1)" }} /> {t("typing.results.netWpm")}
      </span>
      <span>
        <i style={{ background: "var(--chart-2)" }} /> {t("typing.results.rawWpm")}
      </span>
    </div>
  );
}

function Ring({ value, size = 44 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="typing-ring" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth="3" fill="none" />
      {value > 0.01 && <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={value >= 1 ? "var(--success)" : "var(--text)"}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, value)} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />}
    </svg>
  );
}

function AdaptiveLetters({ language }: { language: Lang }) {
  const t = useT();
  const state = useTyping((s) => s.adaptive[language]) ?? initialAdaptive();
  const target = useTyping((s) => s.prefs.targetWpm);
  const unlockNext = useTyping((s) => s.unlockNext);
  const reset = useTyping((s) => s.resetAdaptive);
  const [confirm, setConfirm] = useState(false);
  const unlocked = new Set(unlockedLetters(state, language));
  const order = LETTER_ORDER[language];
  return (
    <Card
      title={`${t("typing.progress.letters")} · ${t(`typing.lang.${language}`)}`}
      subtitle={t("typing.progress.lettersHint")}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={<Unlock />} disabled={state.unlocked >= order.length} onClick={() => unlockNext(language)}>
            {t("typing.adaptive.unlockNext")}
          </Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setConfirm(true)}>
            {t("typing.adaptive.reset")}
          </Button>
        </>
      }
    >
      <div className="typing-letter-grid">
        {order.map((l) => {
          const p = state.letters[l];
          const open = unlocked.has(l);
          const score = letterScore(p, target);
          return (
            <div key={l} className={`typing-letter-card${open ? "" : " is-locked"}`} title={open ? `${Math.round(letterWpm(p))} wpm · ${pct(p?.acc ?? 0)}` : t("typing.progress.locked")}>
              <div className="typing-letter-card__ring">
                <Ring value={open ? score : 0} />
                <span>{l}</span>
              </div>
              <div className="typing-letter-card__meta tabular">{open ? (p?.samples ? `${Math.round(letterWpm(p))}` : "—") : <Lock size={11} />}</div>
            </div>
          );
        })}
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("typing.adaptive.reset")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset(language);
                setConfirm(false);
              }}
            >
              {t("common.reset")}
            </Button>
          </>
        }
      >
        <p className="muted">{t("typing.adaptive.resetConfirm", { lang: t(`typing.lang.${language}`) })}</p>
      </Modal>
    </Card>
  );
}
