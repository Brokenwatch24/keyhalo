import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RGB, TypingResult } from "@/core/types";
import { useSignals } from "@/core/lighting/signals";
import { t as tr } from "@/i18n";
import { toast } from "@/ui";
import { useTyping } from "@/core/typing/store";
import { useTypingPacks } from "@/core/typing/packs";
import { buildLesson, type Lesson } from "@/core/typing/lesson";
import { Ghost, TypingSession, type SessionReport } from "@/core/typing/session";
import { DrillSession, chordFromEvent } from "@/core/typing/drills";
import { configKey, heatColor, keyHeat } from "@/core/typing/progress";
import { guidanceFor, overlayColors, OVERLAY_ERROR, OVERLAY_NEXT, OVERLAY_MOD } from "@/core/typing/guidance";
import type { KeyLocale } from "@/core/typing/charmap";
import type { TypingKeyboard } from "./useKeyboard";

export type TextLesson = Extract<Lesson, { kind: "text" }>;
export type DrillLesson = Extract<Lesson, { kind: "drill" }>;

export type Run =
  | { kind: "text"; id: number; lesson: TextLesson; session: TypingSession; ghost?: Ghost; ghostName?: string; config?: string }
  | { kind: "drill"; id: number; lesson: DrillLesson; session: DrillSession; config?: string };

export type DrillReport = ReturnType<DrillSession["report"]>;

export type Outcome =
  | { kind: "text"; report: SessionReport; best: boolean; previousBest?: number; demo?: boolean }
  | { kind: "drill"; report: DrillReport; best: boolean; previousBest?: number };

const FLASH_MS = 150;
const HEAT_SHOW_MS = 10_000;

let runCounter = 0;

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

/**
 * Owns the active run: builds lessons from the current options, routes page-level key
 * presses into the session, records results, drives the physical-keyboard overlay.
 */
export function useTrainer(kb: TypingKeyboard, locale: KeyLocale, active: boolean, initialOutcome?: Outcome | null, demoTyping = false) {
  const prefs = useTyping((s) => s.prefs);
  const packs = useTypingPacks((s) => s.packs);
  const keymaps = useTypingPacks((s) => s.keymaps);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [run, setRun] = useState<Run | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(initialOutcome ?? null);
  const [ghostFile, setGhostFile] = useState<TypingResult | null>(null);
  const [flashes, setFlashes] = useState<string[]>([]);
  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [dead, setDead] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const [heatShowing, setHeatShowing] = useState(false);
  const [drillMissAt, setDrillMissAt] = useState(0);

  const runRef = useRef(run);
  runRef.current = run;
  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** A demo/initial outcome stays on screen until the user moves on. */
  const keepOutcome = useRef(!!initialOutcome);

  // ---------------------------------------------------------------- runs
  const newRun = useCallback(
    (reuse?: Lesson) => {
      const s = useTyping.getState();
      const p = s.prefs;
      const { packs: allPacks, keymaps: allKeymaps } = useTypingPacks.getState();
      let lesson: Lesson;
      let config: string | undefined;
      if (reuse) lesson = reuse;
      else if (ghostFile?.text) {
        const timed = ghostFile.mode === "test" && /:\d+s:/.test(ghostFile.config ?? "");
        lesson = {
          kind: "text",
          text: ghostFile.text,
          limit: timed ? { kind: "time", ms: Math.round(ghostFile.durationMs / 1000) * 1000 } : { kind: "text" },
          autoIndent: ghostFile.text.includes("\n"),
        };
      } else {
        lesson = buildLesson({
          mode: p.mode,
          language: p.language,
          test: p.test,
          targetWpm: p.targetWpm,
          codeLang: p.codeLang,
          shortcutSource: p.shortcutSource,
          customText: p.customText,
          packs: allPacks,
          keymaps: allKeymaps,
          adaptive: s.adaptiveFor(p.language),
          layout: kb.layout,
          rng: Math.random,
        });
      }
      if (!ghostFile && p.mode !== "custom") {
        const extra = p.mode === "code" ? p.codeLang : p.mode === "shortcuts" ? p.shortcutSource || "default" : p.mode === "fn" ? kb.layout.id : undefined;
        config = configKey(p.mode, p.language, p.test, extra);
      }
      const id = ++runCounter;
      if (lesson.kind === "drill" && p.mode === "fn") config = `fnkeys:${kb.layout.id}`;
      if (lesson.kind === "drill") {
        setRun({ kind: "drill", id, lesson, session: new DrillSession(lesson.items), config });
      } else {
        const session = new TypingSession({ text: lesson.text, stopOnError: p.stopOnError, locale, autoIndent: lesson.autoIndent, limit: lesson.limit });
        let ghost: Ghost | undefined;
        let ghostName: string | undefined;
        if (ghostFile?.replay) {
          ghost = new Ghost(ghostFile.replay);
          ghostName = `${Math.round(ghostFile.wpm)} wpm`;
        } else if (p.ghost && config) {
          const best = s.bests[config];
          if (best?.replay) {
            ghost = new Ghost(best.replay);
            ghostName = `${Math.round(best.wpm)} wpm`;
          }
        }
        setRun({ kind: "text", id, lesson, session, ghost, ghostName, config });
      }
      if (!keepOutcome.current) setOutcome(null);
      setDead(false);
      setFlashes([]);
      setDrillMissAt(0);
    },
    [kb.layout, locale, ghostFile],
  );

  // Rebuild the lesson whenever an option that shapes it changes.
  const lessonKey = JSON.stringify([
    prefs.mode, prefs.language, prefs.test, prefs.codeLang, prefs.shortcutSource, prefs.customText, prefs.stopOnError,
    prefs.ghost, packs.length, keymaps.length, locale, kb.layout.id, ghostFile?.id,
  ]);
  useEffect(() => {
    newRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonKey]);

  const restart = useCallback(() => {
    keepOutcome.current = false;
    const r = runRef.current;
    if (!r) return newRun();
    // Restarting an untouched run gives fresh text; otherwise retry the same text.
    const started = r.kind === "text" ? r.session.started : r.session.startedAt !== null;
    if (started || outcomeRef.current) newRun(r.lesson);
    else newRun();
  }, [newRun]);

  const next = useCallback(() => {
    keepOutcome.current = false;
    newRun();
  }, [newRun]);

  // Dev-only (`?demoTyping=1`): pre-type part of the first text so screenshots show a live run.
  const userTyped = useRef(false);
  useEffect(() => {
    // Lessons may be rebuilt while devices/prefs settle, so feed every fresh run until the user types.
    if (!demoTyping || userTyped.current || run?.kind !== "text" || run.session.started) return;
    const s = run.session;
    const n = Math.floor(s.chars.length * 0.4);
    let ts = performance.now() - n * 215;
    for (let i = 0; i < n && s.expected !== undefined; i++) {
      const ch = s.expected;
      const typo = (i === Math.floor(n * 0.45) || i === n - 3) && ch !== " ";
      s.input(typo ? (ch === "e" ? "r" : "e") : ch, ts);
      if (typo && i !== n - 3) {
        s.backspace();
        s.input(ch, ts + 90);
      }
      ts += 175 + ((i * 37) % 80);
    }
    force();
  }, [demoTyping, run]);

  // ---------------------------------------------------------------- results
  const finalize = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    const st = useTyping.getState();
    const p = st.prefs;
    if (r.kind === "text") {
      const report = r.session.report({ mode: p.mode, language: p.language, keepText: true });
      report.result.config = r.config;
      if (r.session.strokes.length < 5) {
        setOutcome({ kind: "text", report, best: false });
        return;
      }
      const rec = st.record(report.result, { configKey: r.config, strokes: report.strokes });
      setOutcome({ kind: "text", report, best: rec.best && rec.previousBest !== undefined, previousBest: rec.previousBest });
      if (rec.unlocked) toast(tr("typing.adaptive.unlocked", { letter: rec.unlocked.toUpperCase() }));
    } else {
      const report = r.session.report({ mode: p.mode, language: p.language });
      report.config = r.config;
      const { avgMs: _a, slowest: _s, ...result } = report;
      const rec = st.record(result, { configKey: r.config });
      setOutcome({ kind: "drill", report, best: rec.best && rec.previousBest !== undefined, previousBest: rec.previousBest });
    }
  }, []);

  // ---------------------------------------------------------------- clock
  const textRun = run?.kind === "text" ? run : null;
  const ticking = !!textRun && textRun.session.started && !textRun.session.finished && !outcome;
  useEffect(() => {
    if (!ticking) return;
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      const r = runRef.current;
      if (r?.kind === "text") {
        if (r.session.tick(performance.now())) {
          finalize();
          return;
        }
      }
      // ~20 fps is plenty for the ghost caret and the countdown.
      if (ts - last > 50) {
        last = ts;
        setNow(performance.now());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ticking, finalize]);

  // Drill prompts start their reaction timer when shown.
  useEffect(() => {
    if (run?.kind === "drill" && !outcome) run.session.show(performance.now());
  });

  // ---------------------------------------------------------------- keys
  const flash = useCallback((code: string) => {
    setFlashes((f) => [...f, code]);
    setTimeout(() => setFlashes((f) => f.filter((c, i) => !(c === code && i === f.indexOf(code)))), FLASH_MS);
  }, []);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!activeRef.current || e.defaultPrevented) return;
      if (isEditable(e.target) || document.querySelector(".kh-modal")) return;
      const r = runRef.current;
      if (!r) return;
      userTyped.current = true;
      setPressed((p) => (p.has(e.code) ? p : new Set(p).add(e.code)));
      if (e.target instanceof HTMLButtonElement && (e.key.length === 1 || e.key === "Enter" || e.key === "Tab")) e.target.blur();

      // Results screen: Enter → next, Tab/Esc → retry.
      if (outcomeRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          next();
        } else if (e.key === "Tab" || e.key === "Escape") {
          e.preventDefault();
          restart();
        }
        return;
      }

      if (r.kind === "drill") {
        if (e.key === "Escape") {
          e.preventDefault();
          restart();
          return;
        }
        const chord = chordFromEvent(e);
        if (!chord) return;
        e.preventDefault();
        e.stopPropagation();
        const res = r.session.press(chord, performance.now());
        if (!res.correct) {
          flash(e.code);
          setDrillMissAt(performance.now());
        } else setDrillMissAt(0);
        if (res.finished) finalize();
        force();
        return;
      }

      const s = r.session;
      if (e.key === "Escape") {
        e.preventDefault();
        restart();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (r.lesson.autoIndent && s.started && s.expected === " ") {
          s.tab(e.timeStamp || performance.now());
          force();
        } else restart();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        s.backspace(e.ctrlKey || e.altKey);
        setDead(false);
        force();
        return;
      }
      if (e.key === "Dead") {
        setDead(true);
        return;
      }
      let ch: string | null = null;
      if (e.key === "Enter") ch = s.text.includes("\n") ? "\n" : null;
      else if ([...e.key.normalize("NFC")].length >= 1 && e.key.length <= 2 && e.key !== "Unidentified") ch = e.key.normalize("NFC");
      // Let real shortcuts (Ctrl+R, Ctrl+Shift+I…) through; AltGr reports Ctrl+Alt on Windows.
      if (!ch || (e.ctrlKey && !e.altKey) || e.metaKey) return;
      e.preventDefault();
      const ts = performance.now();
      let wrong = false;
      for (const c of ch) {
        const o = s.input(c, ts);
        if (!o.correct && o.expected) wrong = true;
        if (s.finished) break;
      }
      if (wrong) flash(e.code);
      setDead(false);
      if (s.finished) finalize();
      force();
    };
    const onUp = (e: KeyboardEvent) =>
      setPressed((p) => {
        if (!p.has(e.code)) return p;
        const n = new Set(p);
        n.delete(e.code);
        return n;
      });
    const onBlur = () => setPressed(new Set());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [next, restart, finalize, flash]);

  // ---------------------------------------------------------------- guidance
  const version = run?.session.version ?? 0;
  const drillHint = run?.kind === "drill" && !!drillMissAt;
  const guidance = useMemo(() => {
    if (!run || outcome) return null;
    if (run.kind === "text") return guidanceFor(run.session.expected, locale, kb.keys, dead);
    const cur = run.session.current;
    // Fn drills always show the reach; shortcut drills only after a miss.
    if (!cur) return null;
    const show = run.lesson.items[0]?.id.startsWith("fn:") || drillHint;
    return show ? { primary: cur.hintKeys.filter((k) => !/^(Control|Shift|Alt|Meta)/.test(k)), modifiers: cur.hintKeys.filter((k) => /^(Control|Shift|Alt|Meta)/.test(k)), then: [] } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, version, outcome, locale, kb.keys, dead, drillHint]);

  // Physical keyboard overlay.
  useEffect(() => {
    if (heatShowing) return;
    const setOverlay = useSignals.getState().setOverlay;
    if (!prefs.lightKeyboard || !run || outcome || !active) {
      setOverlay("typing", null);
      return;
    }
    const colors = overlayColors(guidance ?? { primary: [], modifiers: [], then: [] }, { keys: kb.keys, fingerGuide: prefs.fingerGuide, errors: flashes });
    setOverlay("typing", { priority: 100, colors, exclusive: false });
  }, [guidance, flashes, prefs.lightKeyboard, prefs.fingerGuide, run, outcome, kb.keys, heatShowing, active]);

  useEffect(() => () => useSignals.getState().setOverlay("typing", null), []);

  const heatTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showHeatOnKeyboard = useCallback((keys: TypingResult["keys"]) => {
    const heat = keyHeat(keys, 1);
    const colors: Record<string, RGB> = {};
    for (const [code, v] of Object.entries(heat)) colors[code] = heatColor(v);
    useSignals.getState().setOverlay("typing", { priority: 100, colors, exclusive: true });
    setHeatShowing(true);
    clearTimeout(heatTimer.current);
    heatTimer.current = setTimeout(() => {
      setHeatShowing(false);
      useSignals.getState().setOverlay("typing", null);
    }, HEAT_SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(heatTimer.current), []);

  /** On-screen keyboard colours mirror the physical overlay. */
  const screenColors = useMemo(() => {
    const colors: Record<string, RGB> = {};
    if (!guidance) return colors;
    for (const c of guidance.then) colors[c] = [80, 80, 90];
    for (const c of guidance.modifiers) colors[c] = OVERLAY_MOD;
    for (const c of guidance.primary) colors[c] = OVERLAY_NEXT;
    for (const c of flashes) colors[c] = OVERLAY_ERROR;
    return colors;
  }, [guidance, flashes]);

  return {
    prefs,
    run,
    outcome,
    setOutcome,
    now,
    pressed,
    flashes,
    guidance,
    screenColors,
    drillMissAt,
    heatShowing,
    ghostFile,
    setGhostFile,
    newRun,
    restart,
    next,
    showHeatOnKeyboard,
    skipDrill: () => {
      if (run?.kind !== "drill") return;
      run.session.skip(performance.now());
      setDrillMissAt(0);
      if (run.session.finished) finalize();
      force();
    },
  };
}

export type Trainer = ReturnType<typeof useTrainer>;
