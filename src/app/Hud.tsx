import { useEffect, useRef, useState } from "react";
import { Gauge, Mic, Battery, Layers, Info, Keyboard, User } from "lucide-react";
import { backend, isTauri, type HudPayload } from "@/core/backend";
import { listen } from "@tauri-apps/api/event";
import "./hud.css";

const ICONS = { dpi: Gauge, profile: User, battery: Battery, mic: Mic, layer: Layers, info: Info, keyboard: Keyboard };

/**
 * On-screen HUD toast (DPI changes, profile switches…).
 * In the desktop app it renders inside a transparent, click-through overlay window (route #/hud);
 * in the browser demo it renders on top of the app.
 */
export function HudView({ overlay = false }: { overlay?: boolean }) {
  const [payload, setPayload] = useState<HudPayload | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const show = (p: HudPayload) => {
      setPayload(p);
      setVisible(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), p.durationMs ?? 1400);
    };
    if (overlay && isTauri) {
      const un = listen<HudPayload>("hud-show", (e) => show(e.payload));
      return () => {
        un.then((f) => f());
      };
    }
    const onEvt = (e: Event) => show((e as CustomEvent<HudPayload>).detail);
    window.addEventListener("keyhalo-hud", onEvt);
    return () => window.removeEventListener("keyhalo-hud", onEvt);
  }, [overlay]);

  if (!payload) return null;
  const Icon = ICONS[payload.icon ?? "info"];
  return (
    <div className={`kh-hud ${overlay ? "kh-hud--overlay" : ""} ${visible ? "is-visible" : ""}`} aria-live="polite">
      <div className="kh-hud__card">
        <Icon className="kh-hud__icon" />
        <div className="kh-hud__text">
          <div className="kh-hud__title">{payload.title}</div>
          {payload.value && <div className="kh-hud__value">{payload.value}</div>}
        </div>
        {payload.progress !== undefined && (
          <div className="kh-hud__bar">
            <div style={{ width: `${Math.round(payload.progress * 100)}%`, background: payload.color ?? "#fff" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Root component for the overlay window. */
export function HudWindow() {
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    backend.appVersion().catch(() => undefined);
  }, []);
  return <HudView overlay />;
}
