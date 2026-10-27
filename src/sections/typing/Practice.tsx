import { useMemo, useRef, useState, type ReactNode } from "react";
import { AtSign, Hash, Ghost as GhostIcon, Settings2, Shuffle, Upload, X, Lock, Pencil, Info } from "lucide-react";
import { Button, KeyboardView, Kbd, Modal, Segmented, Select, Toggle, Field, TextArea, toast } from "@/ui";
import { useT } from "@/i18n";
import { useTyping, resolveLocale } from "@/core/typing/store";
import { useTypingPacks } from "@/core/typing/packs";
import { codeLanguages } from "@/core/typing/lesson";
import { shortcutSources, chordLabel } from "@/core/typing/drills";
import { LETTER_ORDER, letterScore, unlockedLetters, focusLetter } from "@/core/typing/adaptive";
import { TEST_TIMES, TEST_WORDS, asGhost, FINGER_COLORS, scaleRgb, type TypingMode } from "@/core/typing/progress";
import { clock, wpm as wpmOf } from "@/core/typing/metrics";
import type { KeyLocale } from "@/core/typing/charmap";
import type { RGB } from "@/core/types";
import { TextView } from "./TextView";
import { Results } from "./Results";
import type { Trainer } from "./useTrainer";
import type { TypingKeyboard } from "./useKeyboard";

const MODES: TypingMode[] = ["adaptive", "test", "quotes", "code", "shortcuts", "fn", "custom"];

export function Practice({ trainer, kb }: { trainer: Trainer; kb: TypingKeyboard }) {
  const t = useT();
  const { prefs, run, outcome } = trainer;
  const setPrefs = useTyping((s) => s.setPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <div className="typing-practice">
      <div className="typing-toolbar">
        <Segmented<TypingMode>
          value={prefs.mode}
          onChange={(mode) => {
            trainer.setGhostFile(null);
            setPrefs({ mode });
            if (mode === "custom" && !prefs.customText) setCustomOpen(true);
          }}
          options={MODES.map((m) => ({ value: m, label: t(`typing.modes.${m}`) }))}
        />
        <div className="grow" />
        {prefs.mode !== "code" && prefs.mode !== "shortcuts" && (
          <Segmented
            value={prefs.language}
            onChange={(language) => setPrefs({ language })}
            options={[
              { value: "en", label: "EN" },
              { value: "es", label: "ES" },
            ]}
          />
        )}
        <Button variant="ghost" iconOnly icon={<Settings2 />} title={t("typing.options.settings")} onClick={() => setSettingsOpen(true)} />
      </div>

      <ModeOptions trainer={trainer} onEditCustom={() => setCustomOpen(true)} />

      {outcome ? (
        <Results trainer={trainer} kb={kb} />
      ) : (
        <>
          {run?.kind === "text" && <TextStage trainer={trainer} />}
          {run?.kind === "drill" && <DrillStage trainer={trainer} />}
          {prefs.showKeyboard && <GuideKeyboard trainer={trainer} kb={kb} />}
          <div className="typing-keys-hint">
            <span>
              <Kbd>Tab</Kbd> <Kbd>Esc</Kbd> {t("typing.hints.restart")}
            </span>
            <span>
              <Kbd>Enter</Kbd> {t("typing.hints.next")}
            </span>
          </div>
        </>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CustomTextModal open={customOpen} onClose={() => setCustomOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options row
// ---------------------------------------------------------------------------

function Chip({ active, onClick, icon, children, title }: { active?: boolean; onClick: () => void; icon?: ReactNode; children?: ReactNode; title?: string }) {
  return (
    <button type="button" className="typing-chip" aria-pressed={active} onClick={onClick} title={title}>
      {icon}
      {children}
    </button>
  );
}

function ModeOptions({ trainer, onEditCustom }: { trainer: Trainer; onEditCustom: () => void }) {
  const t = useT();
  const prefs = useTyping((s) => s.prefs);
  const setPrefs = useTyping((s) => s.setPrefs);
  const setTest = useTyping((s) => s.setTest);
  const packs = useTypingPacks((s) => s.packs);
  const keymaps = useTypingPacks((s) => s.keymaps);
  const fileRef = useRef<HTMLInputElement>(null);
  const langs = useMemo(() => codeLanguages(packs), [packs]);
  const sources = useMemo(() => shortcutSources(keymaps), [keymaps]);
  const textMode = prefs.mode !== "shortcuts" && !(trainer.run?.kind === "drill");

  const loadGhost = async (file: File) => {
    try {
      const g = asGhost(JSON.parse(await file.text()));
      if (!g) throw new Error("invalid");
      trainer.setGhostFile(g);
    } catch {
      toast(t("typing.ghost.invalid"), "danger");
    }
  };

  let left: ReactNode = null;
  switch (prefs.mode) {
    case "adaptive":
      left = (
        <label className="typing-inline-select">
          <span>{t("typing.options.target")}</span>
          <Select
            value={String(prefs.targetWpm)}
            onChange={(v) => setPrefs({ targetWpm: Number(v) })}
            options={[20, 25, 30, 35, 40, 50, 60, 70, 80, 100].map((n) => ({ value: String(n), label: `${n} wpm` }))}
          />
        </label>
      );
      break;
    case "test":
      left = (
        <>
          <Chip active={prefs.test.punctuation} onClick={() => setTest({ punctuation: !prefs.test.punctuation })} icon={<AtSign />}>
            {t("typing.options.punctuation")}
          </Chip>
          <Chip active={prefs.test.numbers} onClick={() => setTest({ numbers: !prefs.test.numbers })} icon={<Hash />}>
            {t("typing.options.numbers")}
          </Chip>
          <span className="typing-sep" />
          <Chip active={prefs.test.kind === "time"} onClick={() => setTest({ kind: "time" })}>
            {t("typing.options.time")}
          </Chip>
          <Chip active={prefs.test.kind === "words"} onClick={() => setTest({ kind: "words" })}>
            {t("typing.options.words")}
          </Chip>
          <span className="typing-sep" />
          {(prefs.test.kind === "time" ? TEST_TIMES : TEST_WORDS).map((n) => (
            <Chip key={n} active={(prefs.test.kind === "time" ? prefs.test.time : prefs.test.words) === n} onClick={() => setTest(prefs.test.kind === "time" ? { time: n } : { words: n })}>
              <span className="tabular">{n}</span>
            </Chip>
          ))}
        </>
      );
      break;
    case "code":
      left = (
        <label className="typing-inline-select">
          <span>{t("typing.options.language")}</span>
          <Select value={prefs.codeLang} onChange={(codeLang) => setPrefs({ codeLang })} options={[{ value: "all", label: t("typing.options.allLanguages") }, ...langs.map((l) => ({ value: l, label: l }))]} />
        </label>
      );
      break;
    case "shortcuts":
      left = (
        <label className="typing-inline-select">
          <span>{t("typing.options.source")}</span>
          <Select
            value={sources.some((s) => s.id === prefs.shortcutSource) ? prefs.shortcutSource : sources[0]?.id ?? ""}
            onChange={(shortcutSource) => setPrefs({ shortcutSource })}
            options={sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.items.length}` }))}
          />
        </label>
      );
      break;
    case "fn":
      left =
        trainer.run?.kind === "drill" ? (
          <span className="typing-note">{t("typing.drill.fnFrom", { name: trainer.run.lesson.sourceName })}</span>
        ) : (
          <span className="typing-note">
            <Info /> {t("typing.drill.noFn")}
          </span>
        );
      break;
    case "custom":
      left = (
        <Chip onClick={onEditCustom} icon={<Pencil />}>
          {t("typing.options.editText")}
        </Chip>
      );
      break;
    default:
      left = <span className="typing-note">{t(`typing.modeHints.${prefs.mode}`)}</span>;
  }

  return (
    <div className="typing-options">
      <div className="typing-options__group">{left}</div>
      <div className="typing-options__group">
        {textMode && prefs.mode !== "custom" && !trainer.ghostFile && (
          <Chip active={prefs.ghost} onClick={() => setPrefs({ ghost: !prefs.ghost })} icon={<GhostIcon />} title={t("typing.ghost.raceHint")}>
            {t("typing.ghost.race")}
          </Chip>
        )}
        {textMode && trainer.ghostFile && (
          <Chip active onClick={() => trainer.setGhostFile(null)} icon={<X />} title={t("typing.ghost.clear")}>
            {t("typing.ghost.loaded", { name: `${Math.round(trainer.ghostFile.wpm)} wpm` })}
          </Chip>
        )}
        {textMode && (
          <Chip onClick={() => fileRef.current?.click()} icon={<Upload />}>
            {t("typing.ghost.load")}
          </Chip>
        )}
        <Chip onClick={() => trainer.next()} icon={<Shuffle />} title={t("typing.options.newText")} />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadGhost(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text stage
// ---------------------------------------------------------------------------

function TextStage({ trainer }: { trainer: Trainer }) {
  const t = useT();
  const run = trainer.run;
  const prefs = trainer.prefs;
  if (run?.kind !== "text") return null;
  const s = run.session;
  const now = trainer.now;
  const ms = s.elapsed(now);
  const sec = Math.floor(ms / 1000);
  const remaining = s.remaining(now);
  const started = s.started;
  const ghostIndex = run.ghost && started ? Math.min(s.chars.length, run.ghost.indexAt(ms)) : run.ghost ? 0 : undefined;
  const lead = ghostIndex !== undefined ? s.cursor - ghostIndex : 0;
  const isWords = prefs.mode === "test" && prefs.test.kind === "words";
  const totalWords = isWords ? s.text.split(" ").length : 0;
  const correctStrokes = s.strokes.reduce((n, k) => n + (k.correct ? 1 : 0), 0);
  const acc = s.strokes.length ? correctStrokes / s.strokes.length : 1;

  return (
    <div className="typing-stage">
      {prefs.mode === "adaptive" && run.lesson.letters && <LetterBar letters={run.lesson.letters} focus={run.lesson.focus} pseudo={run.lesson.pseudo} />}
      <div className="typing-strip">
        <LiveWpm chars={s.correctChars()} ms={ms} sec={sec} started={started} label={t("typing.live.wpm")} />
        <div className="typing-strip__item">
          <span className={`typing-strip__value${started ? "" : " is-empty"}`}>{`${Math.floor(acc * 100)}%`}</span>
          <span className="typing-strip__label">{t("typing.live.acc")}</span>
        </div>
        <div className="typing-strip__item">
          <span className="typing-strip__value">{remaining !== null ? clock(started ? remaining : (run.lesson.limit as { ms: number }).ms) : isWords ? `${s.wordsDone()}/${totalWords}` : clock(ms)}</span>
          <span className="typing-strip__label">{remaining !== null ? t("typing.live.left") : isWords ? t("typing.live.words") : t("typing.live.time")}</span>
        </div>
        <div className="grow" />
        {run.ghost && (
          <div className="typing-strip__ghost">
            <GhostIcon />
            <span className="tabular">{run.ghostName}</span>
            {started && <span className={`typing-strip__lead${lead > 0 ? " is-ahead" : lead < 0 ? " is-behind" : ""}`}>{lead === 0 ? t("typing.ghost.even") : t(lead > 0 ? "typing.ghost.ahead" : "typing.ghost.behind", { n: Math.abs(lead) })}</span>}
          </div>
        )}
        {run.lesson.source && <div className="typing-strip__source">{run.lesson.source}</div>}
      </div>
      <TextView session={s} version={s.version} ghostIndex={ghostIndex} code={!!run.lesson.autoIndent} focus={prefs.mode === "adaptive" ? run.lesson.focus : undefined} idle={!started} />
      <div className={`typing-start-hint${started ? " is-hidden" : ""}`}>{t("typing.hints.start")}</div>
    </div>
  );
}

/** WPM that only updates once per second so the number stays calm. */
function LiveWpm({ chars, ms, sec, started, label }: { chars: number; ms: number; sec: number; started: boolean; label: string }) {
  const value = useMemo(() => (started && ms > 1000 ? Math.round(wpmOf(chars, ms)) : null), [sec, started]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="typing-strip__item typing-strip__item--main">
      <span className={`typing-strip__value${value === null ? " is-empty" : ""}`}>{value ?? 0}</span>
      <span className="typing-strip__label">{label}</span>
    </div>
  );
}

function LetterBar({ letters, focus, pseudo }: { letters: string[]; focus?: string; pseudo?: boolean }) {
  const t = useT();
  const prefs = useTyping((s) => s.prefs);
  const state = useTyping((s) => s.adaptive[prefs.language]);
  const all = LETTER_ORDER[prefs.language];
  const next = all[letters.length];
  return (
    <div className="typing-letters" title={pseudo ? t("typing.adaptive.pseudo") : undefined}>
      {letters.map((l) => {
        const score = letterScore(state?.letters[l], prefs.targetWpm);
        return (
          <div key={l} className={`typing-letter${l === focus ? " is-focus" : ""}${score >= 1 ? " is-met" : ""}`} title={`${l.toUpperCase()} · ${Math.round(score * 100)}%`}>
            <span>{l}</span>
            <i style={{ ["--p" as string]: `${Math.round(score * 100)}%` }} />
          </div>
        );
      })}
      {next ? (
        <div className="typing-letter is-locked" title={t("typing.adaptive.next")}>
          <span>{next}</span>
          <Lock />
        </div>
      ) : (
        <span className="typing-note">{t("typing.adaptive.allUnlocked")}</span>
      )}
      {focus && (
        <span className="typing-letters__focus">
          {t("typing.adaptive.focus")} <b>{focus}</b>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill stage (shortcuts, Fn layer)
// ---------------------------------------------------------------------------

function DrillStage({ trainer }: { trainer: Trainer }) {
  const t = useT();
  const run = trainer.run;
  if (run?.kind !== "drill") return null;
  const s = run.session;
  const item = s.current;
  const isFn = run.lesson.items[0]?.id.startsWith("fn:");
  const showHint = isFn || s.currentMisses > 0;
  return (
    <div className="typing-stage typing-drill">
      <div className="typing-drill__count tabular">{t("typing.drill.of", { n: Math.min(s.index + 1, s.items.length), total: s.items.length })}</div>
      <div className="typing-drill__progress">
        <div style={{ width: `${(s.index / s.items.length) * 100}%` }} />
      </div>
      {item && (
        <>
          <div className="typing-drill__context">{isFn ? t("typing.drill.press") : item.context}</div>
          <div key={s.index} className={`typing-drill__prompt${s.currentMisses ? " is-wrong" : ""}`}>
            {item.prompt}
          </div>
          <div className={`typing-drill__chord${showHint ? "" : " is-hidden"}`}>
            {isFn ? (
              <>
                <Kbd>Fn</Kbd>+<Kbd>{item.hintKeys[1]?.replace(/^Key|^Digit/, "")}</Kbd>
              </>
            ) : (
              chordLabel(item.chord).map((k, i) => (
                <span key={i} className="row" style={{ gap: 6 }}>
                  {i > 0 && "+"}
                  <Kbd>{k}</Kbd>
                </span>
              ))
            )}
          </div>
          <div className="typing-drill__feedback">{s.currentMisses > 0 ? t("typing.drill.wrong") : " "}</div>
          <Button size="sm" variant="ghost" onClick={trainer.skipDrill}>
            {t("typing.drill.skip")}
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On-screen keyboard
// ---------------------------------------------------------------------------

function GuideKeyboard({ trainer, kb }: { trainer: Trainer; kb: TypingKeyboard }) {
  const prefs = trainer.prefs;
  const adaptive = useTyping((s) => s.adaptive[prefs.language]);
  const colors = useMemo(() => {
    const c: Record<string, RGB> = {};
    if (prefs.fingerGuide) for (const k of kb.keys) if (k.finger !== undefined && k.code !== "Space") c[k.code] = scaleRgb(FINGER_COLORS[k.finger], 0.55);
    return { ...c, ...trainer.screenColors };
  }, [prefs.fingerGuide, kb.keys, trainer.screenColors]);
  const { dim, selected } = useMemo(() => {
    const dim = new Set<string>();
    const selected = new Set<string>();
    if (prefs.mode === "adaptive" && trainer.run?.kind === "text") {
      const unlocked = new Set(unlockedLetters(adaptive ?? { unlocked: 6, letters: {} }, prefs.language));
      for (const k of kb.keys) if (/^Key[A-Z]$/.test(k.code) && !unlocked.has(k.code.slice(3).toLowerCase())) dim.add(k.code);
      const focus = trainer.run.lesson.focus ?? focusLetter(adaptive ?? { unlocked: 6, letters: {} }, prefs.language, prefs.targetWpm);
      if (/^[a-z]$/.test(focus)) selected.add(`Key${focus.toUpperCase()}`);
      else if (focus === "ñ") selected.add("Semicolon");
    }
    return { dim, selected };
  }, [prefs.mode, prefs.language, prefs.targetWpm, adaptive, kb.keys, trainer.run]);
  return (
    <div className="typing-kb">
      <KeyboardView keys={kb.keys} size={kb.size} colors={colors} pressed={trainer.pressed} dim={dim} selected={selected} maxWidth={780} glow={0.7} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const prefs = useTyping((s) => s.prefs);
  const setPrefs = useTyping((s) => s.setPrefs);
  const row = (label: string, hint: string, control: ReactNode) => (
    <div className="typing-setting">
      <div className="grow">
        <div className="typing-setting__label">{label}</div>
        <div className="typing-setting__hint">{hint}</div>
      </div>
      {control}
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title={t("typing.options.settings")}>
      <div className="col" style={{ gap: 0 }}>
        {row(t("typing.options.lightKeyboard"), t("typing.options.lightKeyboardHint"), <Toggle checked={prefs.lightKeyboard} onChange={(lightKeyboard) => setPrefs({ lightKeyboard })} />)}
        {row(t("typing.options.stopOnError"), t("typing.options.stopOnErrorHint"), <Toggle checked={prefs.stopOnError} onChange={(stopOnError) => setPrefs({ stopOnError })} />)}
        {row(t("typing.options.fingerGuide"), t("typing.options.fingerGuideHint"), <Toggle checked={prefs.fingerGuide} onChange={(fingerGuide) => setPrefs({ fingerGuide })} />)}
        {row(t("typing.options.showKeyboard"), "", <Toggle checked={prefs.showKeyboard} onChange={(showKeyboard) => setPrefs({ showKeyboard })} />)}
        <div className="typing-setting typing-setting--stack">
          <Field label={t("typing.options.layout")} hint={t("typing.options.layoutHint")}>
            <Select<KeyLocale | "auto">
              value={prefs.locale}
              onChange={(locale) => setPrefs({ locale })}
              options={[
                { value: "auto", label: `${t("typing.options.layoutAuto")} (${layoutName(t, resolveLocale({ ...prefs, locale: "auto" }))})` },
                { value: "us", label: t("typing.options.layoutUs") },
                { value: "es-ES", label: t("typing.options.layoutEsES") },
                { value: "es-LA", label: t("typing.options.layoutEsLA") },
              ]}
            />
          </Field>
        </div>
        <div className="typing-setting typing-setting--stack">
          <Field label={`${t("typing.options.targetWpm")} · ${prefs.targetWpm} wpm`} hint={t("typing.options.targetWpmHint")}>
            <input
              type="range"
              className="kh-range"
              min={15}
              max={120}
              step={5}
              value={prefs.targetWpm}
              style={{ ["--pct" as string]: `${((prefs.targetWpm - 15) / 105) * 100}%` }}
              onChange={(e) => setPrefs({ targetWpm: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function layoutName(t: (k: string) => string, l: KeyLocale) {
  return l === "us" ? t("typing.options.layoutUs") : l === "es-ES" ? t("typing.options.layoutEsES") : t("typing.options.layoutEsLA");
}

function CustomTextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const prefs = useTyping((s) => s.prefs);
  const setPrefs = useTyping((s) => s.setPrefs);
  const [text, setText] = useState(prefs.customText);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("typing.custom.title")}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              setPrefs({ customText: text, mode: "custom" });
              onClose();
            }}
          >
            {t("typing.custom.use")}
          </Button>
        </>
      }
    >
      <Field hint={t("typing.custom.hint")}>
        <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder={t("typing.custom.placeholder")} rows={10} autoFocus />
      </Field>
    </Modal>
  );
}

