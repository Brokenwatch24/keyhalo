import { useEffect, useMemo, useState } from "react";
import { Keyboard, LineChart as ChartIcon } from "lucide-react";
import { Page, Tabs } from "@/ui";
import { useT } from "@/i18n";
import { useRoute } from "@/app/router";
import { useSettings } from "@/core/state/settings";
import { useTyping, resolveLocale } from "@/core/typing/store";
import { useTypingPacks } from "@/core/typing/packs";
import { languageWords } from "@/core/typing/lesson";
import { demoProgress, simulateRun } from "@/core/typing/demo";
import { configKey } from "@/core/typing/progress";
import { useTypingKeyboard } from "./useKeyboard";
import { useTrainer, type Outcome } from "./useTrainer";
import { Practice } from "./Practice";
import { Progress } from "./Progress";
import "./typing.css";

type Tab = "practice" | "progress";

/**
 * Dev/screenshot switches (kept on purpose, used for README screenshots):
 *  - `?demoResult=1#/typing` or `#/typing/demo` renders a simulated result.
 *  - `?theme=light` / `?theme=dark` forces a theme while the page is open.
 *  - `?lang=en` / `?lang=es` switches the UI language for this visit (not saved).
 *  - `?demoTyping=1` pre-types part of the first text to show a run in progress.
 *  - `?demoProgress=1` fills the Progress tab with sample data (in memory only).
 *  - `#/typing/progress` opens the Progress tab.
 */
function queryFlag(name: string): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get(name);
  if (fromSearch !== null) return fromSearch;
  const q = window.location.hash.split("?")[1];
  return q ? new URLSearchParams(q).get(name) : null;
}

export default function TypingSection() {
  const loaded = useTyping((s) => s.loaded);
  useEffect(() => {
    void useTyping
      .getState()
      .load()
      .then(() => {
        if (queryFlag("demoResult") === "1" || window.location.hash.startsWith("#/typing/demo")) {
          useTyping.setState((s) => ({ prefs: { ...s.prefs, mode: "test", test: { ...s.prefs.test, kind: "time", time: 30, punctuation: false, numbers: false } } }));
        }
        if (queryFlag("demoProgress") === "1") {
          useTyping.setState(demoProgress(languageWords(useTypingPacks.getState().packs, "en")));
        }
        const lang = queryFlag("lang");
        if (lang !== "en" && lang !== "es") return;
        // Screenshot switch: UI + practice language for this visit only (nothing is saved).
        useSettings.setState((s) => ({ settings: { ...s.settings, language: lang } }));
        useTyping.setState((s) => ({ prefs: { ...s.prefs, language: lang } }));
      });
  }, []);
  useEffect(() => {
    const theme = queryFlag("theme");
    if (theme !== "light" && theme !== "dark") return;
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (prev) root.setAttribute("data-theme", prev);
      else root.removeAttribute("data-theme");
    };
  }, []);
  if (!loaded) return <div className="kh-loading" />;
  return <TypingPage />;
}

function TypingPage() {
  const t = useT();
  const route = useRoute();
  const sub = route[1];
  const [tab, setTab] = useState<Tab>(sub === "progress" ? "progress" : "practice");
  const prefs = useTyping((s) => s.prefs);
  const locale = resolveLocale(prefs);
  const kb = useTypingKeyboard(locale);
  const packs = useTypingPacks((s) => s.packs);

  const demo = queryFlag("demoResult") === "1" || sub === "demo";
  const initialOutcome = useMemo<Outcome | null>(() => {
    if (!demo) return null;
    const report = simulateRun(languageWords(packs, "en"), { seconds: 30, wpm: 92, seed: 11 });
    report.result.config = configKey("test", "en", { kind: "time", time: 30, words: 25, punctuation: false, numbers: false });
    return { kind: "text", report, best: true, previousBest: 84, demo: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const trainer = useTrainer(kb, locale, tab === "practice", initialOutcome, queryFlag("demoTyping") === "1");

  return (
    <Page title={t("typing.title")} description={t("typing.description")}>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "practice", label: t("typing.tabs.practice"), icon: <Keyboard size={15} /> },
          { value: "progress", label: t("typing.tabs.progress"), icon: <ChartIcon size={15} /> },
        ]}
      />
      {tab === "practice" ? <Practice trainer={trainer} kb={kb} /> : <Progress kb={kb} trainer={trainer} onRace={() => setTab("practice")} />}
    </Page>
  );
}
