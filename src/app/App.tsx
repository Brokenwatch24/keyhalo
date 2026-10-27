import { Suspense, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { SECTIONS } from "@/sections/registry";
import { useRoute, navigate } from "./router";
import { Logo } from "./Logo";
import { HudView } from "./Hud";
import { SidebarFooter } from "./SidebarFooter";
import { Toaster } from "@/ui";
import { useT } from "@/i18n";
import { isTauri } from "@/core/backend";
import { initApp } from "@/core/init";
import "./shell.css";

const GROUPS = ["overview", "customize", "practice", "connect", "system"] as const;

export function App() {
  const t = useT();
  const [route] = useRoute();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initApp().finally(() => setReady(true));
  }, []);

  const section = SECTIONS.find((s) => s.id === route) ?? SECTIONS[0];
  const Page = section.component;

  return (
    <div className="kh-shell">
      <aside className="kh-sidebar">
        <div className="kh-brand">
          <Logo />
          <span>KeyHalo</span>
        </div>
        <nav className="kh-nav">
          {GROUPS.map((g) => (
            <div key={g} className="kh-nav__group">
              {g !== "system" && <div className="kh-nav__heading">{t(`nav.groups.${g}`)}</div>}
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <a
                  key={s.id}
                  href={`#/${s.id}`}
                  className="kh-nav__item"
                  aria-current={s.id === section.id ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(s.id);
                  }}
                >
                  <s.icon />
                  <span>{t(s.labelKey)}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="kh-sidebar__foot">
          <SidebarFooter />
          {!isTauri && (
            <div className="kh-demo" title={t("nav.demoHint")}>
              <FlaskConical />
              <span>{t("nav.demo")}</span>
            </div>
          )}
        </div>
      </aside>
      <main className="kh-main">
        {ready ? (
          <Suspense fallback={<div className="kh-loading" />}>
            <Page key={section.id} />
          </Suspense>
        ) : (
          <div className="kh-loading" />
        )}
      </main>
      <HudView />
      <Toaster />
    </div>
  );
}
