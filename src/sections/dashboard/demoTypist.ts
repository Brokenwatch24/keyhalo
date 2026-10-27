import { useEffect } from "react";
import { backend } from "@/core/backend";
import { emitMock } from "@/core/backend/mock";

/**
 * Browser demo only: a "ghost typist" that feeds simulated keystrokes into the same input
 * pipeline the desktop app uses (stats → live WPM/APM, reactive lighting), so the overview
 * looks alive without hardware. Never runs in the desktop app.
 */
const TEXT =
  "the quick brown fox jumps over the lazy dog. keyhalo lights every key you press, counts what matters and never stores what you type. ship it, then tweak the profile, ";

const CODE: Record<string, string> = { " ": "Space", ".": "Period", ",": "Comma" };
const codeOf = (ch: string) => CODE[ch] ?? (/[a-z]/.test(ch) ? `Key${ch.toUpperCase()}` : null);

const STORAGE_KEY = "keyhalo:dashboard:demoTypist";

export function demoTypistEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setDemoTypistEnabled(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export const isDemo = backend.kind === "mock";

export function useDemoTypist(active: boolean) {
  useEffect(() => {
    if (!isDemo || !active) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      const ch = TEXT[i % TEXT.length];
      i++;
      const code = codeOf(ch);
      if (code) {
        emitMock("input-key", { code, down: true, t: performance.now() });
        setTimeout(() => emitMock("input-key", { code, down: false, t: performance.now() }), 55 + Math.random() * 40);
      }
      // ~70–90 WPM with short thinking pauses after sentences.
      const pause = ch === "." ? 900 + Math.random() * 600 : ch === " " && Math.random() < 0.08 ? 380 : 0;
      timer = setTimeout(step, 115 + Math.random() * 70 + pause);
    };
    timer = setTimeout(step, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
}
