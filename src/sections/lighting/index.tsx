import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Page } from "@/ui";
import { effectRegistry, useLighting, useProfiles } from "@/core/lighting";
import { useSettings } from "@/core/state/settings";
import { useT } from "@/i18n";
import { EffectPicker } from "./EffectPicker";
import { Inspector } from "./Inspector";
import { LayersPanel, deleteLayer, duplicateLayer } from "./LayersPanel";
import { ProfileBar, requestSave } from "./ProfileBar";
import { Stage, useDemoTyping } from "./Stage";
import { queryFlag, useFx, useStudio } from "./util";
import "./lighting.css";

/**
 * Lighting studio: profile toolbar, live desk preview with key selection, layer stack and
 * inspector. Dev/screenshot switches (kept on purpose for README shots):
 *  - `?theme=dark|light`, `?lang=en|es` (this visit only)
 *  - `?profile=<id>` applies a profile for this visit (not saved as the active one)
 *  - `?layer=<index>` selects a layer (0 = bottom), `?picker=1` opens the effect picker
 *  - `?demoKeys=1` simulates typing so reactive layers show their ripples
 */
function useDevFlags() {
  useEffect(() => {
    const theme = queryFlag("theme");
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
    const lang = queryFlag("lang");
    if (lang === "en" || lang === "es") useSettings.setState((s) => ({ settings: { ...s.settings, language: lang } }));
    const profile = queryFlag("profile");
    const layer = Number(queryFlag("layer") ?? NaN);
    const selectLayer = () => {
      const layers = useLighting.getState().scene.layers;
      if (Number.isInteger(layer) && layers[layer]) useStudio.getState().selectLayer(layers[layer].id);
    };
    // Wait until startup applied the saved profile, otherwise it would override ours.
    let unsub: (() => void) | undefined;
    let done = false;
    const applyFlag = () => {
      const s = useProfiles.getState();
      if (done || !s.activeId) return done;
      done = true;
      if (profile && s.profiles.some((p) => p.id === profile)) void s.apply(profile, "app", { silent: true }).then(selectLayer);
      else selectLayer();
      return true;
    };
    if (!applyFlag()) unsub = useProfiles.subscribe(() => applyFlag() && unsub?.());
    if (queryFlag("picker") === "1") useStudio.getState().openPicker({ mode: "add" });
    return () => {
      unsub?.();
      if (theme === "light" || theme === "dark") {
        if (prev) root.setAttribute("data-theme", prev);
        else root.removeAttribute("data-theme");
      }
    };
  }, []);
  useDemoTyping(queryFlag("demoKeys") === "1");
}

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
};

function useShortcuts() {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector(".kh-modal")) return;
      const mod = e.ctrlKey || e.metaKey;
      const { selectedLayer, setKeys } = useStudio.getState();
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        requestSave(t);
      } else if (mod && e.key.toLowerCase() === "d" && selectedLayer) {
        e.preventDefault();
        duplicateLayer(selectedLayer);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedLayer && !mod) {
        e.preventDefault();
        deleteLayer(selectedLayer);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && selectedLayer) {
        e.preventDefault();
        const layers = useLighting.getState().scene.layers;
        const i = layers.findIndex((l) => l.id === selectedLayer);
        useLighting.getState().moveLayer(selectedLayer, i + (e.key === "ArrowUp" ? 1 : -1));
      } else if (e.key === "Escape") setKeys([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);
}

/** Layers the engine disabled (e.g. a community effect that kept timing out). */
function ErrorBar() {
  const fx = useFx();
  const errors = useLighting((s) => s.errors);
  const layers = useLighting((s) => s.scene.layers);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const items = Object.entries(errors).filter(([id, msg]) => dismissed[id] !== msg && layers.some((l) => l.id === id));
  if (!items.length) return null;
  return (
    <div className="lighting-errors">
      {items.map(([id, msg]) => {
        const layer = layers.find((l) => l.id === id)!;
        return (
          <div key={id} className="lighting-callout lighting-callout--danger" role="alert">
            <AlertTriangle />
            <button type="button" className="lighting-errors__name" onClick={() => useStudio.getState().selectLayer(id)}>
              {fx.name(effectRegistry.get(layer.effect)?.meta, layer.effect)}
            </button>
            <span className="grow">{fx.t("lighting.errors.layerDisabled", { reason: msg })}</span>
            <button type="button" className="lighting-iconbtn" title={fx.t("common.close")} onClick={() => setDismissed((d) => ({ ...d, [id]: msg }))}>
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function LightingSection() {
  const t = useT();
  useDevFlags();
  useShortcuts();
  const layers = useLighting((s) => s.scene.layers);
  const selected = useStudio((s) => s.selectedLayer);

  // Keep a layer selected so the inspector is never empty (the base layer by default).
  useEffect(() => {
    if (!layers.length) return;
    if (!selected || !layers.some((l) => l.id === selected)) useStudio.getState().selectLayer(layers[0].id);
  }, [layers, selected]);

  return (
    <Page title={t("nav.lighting")} description={t("lighting.page.description")} actions={<ProfileBar />}>
      <div className="lighting-studio">
        <Stage />
        <ErrorBar />
        <div className="lighting-work">
          <LayersPanel />
          <Inspector />
        </div>
      </div>
      <EffectPicker />
    </Page>
  );
}
