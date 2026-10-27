import { useEffect, useState } from "react";
import { Accessibility, Database, Info, Keyboard, Network, Plug, Settings2, ShieldCheck, type LucideIcon } from "lucide-react";
import { Page } from "@/ui";
import { useT } from "@/i18n";
import { useRoute } from "@/app/router";
import { backend } from "@/core/backend";
import { GitHubMark, useLangParam } from "../community/shared";
import { GeneralSection, InputSection, LightingSection } from "./General";
import { AboutSection, ApiSection, DataSection, GitHubSection, OpenRgbSection, SafetySection } from "./System";
import "../community/community.css";
import "./settings.css";

const NAV: { id: string; icon: LucideIcon | null }[] = [
  { id: "general", icon: Settings2 },
  { id: "lighting", icon: Accessibility },
  { id: "input", icon: Keyboard },
  { id: "safety", icon: ShieldCheck },
  { id: "openrgb", icon: Network },
  { id: "api", icon: Plug },
  { id: "github", icon: null },
  { id: "data", icon: Database },
  { id: "about", icon: Info },
];

const scroller = () => document.querySelector<HTMLElement>(".kh-main");

function goTo(id: string) {
  const el = document.getElementById(`settings-${id}`);
  const main = scroller();
  if (!el || !main) return;
  main.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
}

export default function SettingsPage() {
  const t = useT();
  const route = useRoute();
  const [active, setActive] = useState(NAV[0].id);
  const [version, setVersion] = useState("");
  useLangParam();

  useEffect(() => {
    backend.appVersion().then(setVersion, () => setVersion("dev"));
  }, []);

  // `#/settings/<section>` deep-links into a section.
  useEffect(() => {
    if (route[1] && NAV.some((n) => n.id === route[1])) requestAnimationFrame(() => goTo(route[1]));
  }, [route[1]]);

  // Scroll spy: highlight the section nearest the top.
  useEffect(() => {
    const main = scroller();
    if (!main) return;
    const onScroll = () => {
      const top = main.getBoundingClientRect().top + 120;
      let current = NAV[0].id;
      for (const n of NAV) {
        const el = document.getElementById(`settings-${n.id}`);
        if (el && el.getBoundingClientRect().top <= top) current = n.id;
      }
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) current = NAV[NAV.length - 1].id;
      setActive(current);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Page title={t("settings.title")} description={t("settings.subtitle")}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.title")}>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className="settings-nav__item"
              aria-current={active === n.id ? "true" : undefined}
              onClick={() => {
                setActive(n.id);
                goTo(n.id);
              }}
            >
              {n.icon ? <n.icon /> : <GitHubMark size={15} />}
              {t(`settings.nav.${n.id}`)}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <GeneralSection version={version} />
          <LightingSection />
          <InputSection />
          <SafetySection />
          <OpenRgbSection />
          <ApiSection />
          <GitHubSection />
          <DataSection version={version} />
          <AboutSection version={version} />
        </div>
      </div>
    </Page>
  );
}
