import type { KeyAction, KeymapPack } from "@/core/types";
import { backend, type BackendEvents } from "@/core/backend";
import { bus } from "@/core/util/bus";
import { useSettings } from "@/core/state/settings";
import { useSignals } from "@/core/lighting/signals";
import { acquireInputListening } from "@/core/stats/input";
import { t } from "@/i18n";
import { compileRemapConfig } from "./compile";
import { startCheatsheet } from "./cheatsheet";
import { useKeymaps } from "./store";

let started = false;

/** Called once at startup (see src/core/init.ts). */
export async function init(): Promise<void> {
  if (started) return;
  started = true;
  const store = useKeymaps;
  await store.getState().hydrate();

  // --- Compile + push the remap config whenever anything relevant changes -----------------
  let lastJson = "";
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const push = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const s = store.getState();
      const st = useSettings.getState().settings;
      const config = compileRemapConfig(s.packs, s.enabledIds, { remapEnabled: st.remapEnabled, paused: s.paused, pauseApps: st.remapPauseApps });
      const json = JSON.stringify(config);
      if (json === lastJson) return;
      lastJson = json;
      backend
        .remapConfigure(config)
        .then(() => store.setState({ lastConfig: config, lastError: null }))
        .catch((e) => {
          lastJson = "";
          console.warn("[keymaps] remap_configure failed", e);
          store.setState({ lastError: String((e as Error)?.message ?? e) });
        });
    }, 30);
  };
  store.subscribe((s, p) => (s.packs !== p.packs || s.enabledIds !== p.enabledIds || s.paused !== p.paused) && push());
  useSettings.subscribe((s, p) => (s.settings.remapEnabled !== p.settings.remapEnabled || s.settings.remapPauseApps !== p.settings.remapPauseApps) && push());
  push();

  // --- Foreground app → active pack ---------------------------------------------------------
  backend
    .foregroundApp()
    .then((fg) => fg && store.getState().setForeground(fg.process))
    .catch(() => {});
  await backend.on("foreground-changed", (fg) => store.getState().setForeground(fg.process));

  // --- Pause --------------------------------------------------------------------------------
  const setPaused = (paused: boolean, hud = true) => {
    if (store.getState().paused === paused) return;
    store.getState().setPaused(paused);
    if (hud)
      bus.emit("hud", { title: t(paused ? "keymaps.hud.paused" : "keymaps.hud.resumed"), icon: "keyboard", color: paused ? "#ffb454" : "#7ee0a1" });
  };
  bus.on("keymaps:pause", ({ paused }) => setPaused(paused));
  bus.on("keymaps:setEnabled", ({ ids }) => store.getState().setEnabled(ids));
  await backend.on("tray-action", ({ action, value }) => {
    if (action !== "pauseRemap") return;
    setPaused(value === undefined ? !store.getState().paused : value === "true" || value === "1");
  });

  // --- Community gallery ----------------------------------------------------------------------
  bus.on("community:installed", ({ kind, data }) => {
    if (kind !== "keymap") return;
    store
      .getState()
      .addInstalled(data as KeymapPack)
      .catch((e) => console.warn("[keymaps] installed pack rejected", e));
  });
  bus.on("community:removed", ({ kind, id }) => {
    if (kind === "keymap") store.getState().removeInstalled(id).catch(() => {});
  });

  // --- remap-fired: actions Rust cannot perform itself --------------------------------------
  let sniperKey: string | null = null;
  let layerHoldKey: string | null = null;
  let releaseInput: (() => void) | null = null;
  const needInput = () => {
    if (sniperKey || layerHoldKey) releaseInput ??= acquireInputListening();
    else {
      releaseInput?.();
      releaseInput = null;
    }
  };
  const setLayer = (layer: string | null, packId: string) => {
    if (store.getState().layer === layer) return;
    store.getState().setLayer(layer);
    useSignals.getState().set({ layer });
    const pack = store.getState().get(packId);
    const name = layer ? (pack?.layers?.find((l) => l.id === layer)?.name ?? layer) : t("keymaps.hud.baseLayer");
    bus.emit("hud", { title: t("keymaps.hud.layer"), value: name, icon: "layer" });
  };

  const handleAction = (ev: BackendEvents["remap-fired"], action: KeyAction) => {
    switch (action.type) {
      case "dpi":
        if (action.mode === "set" && action.value) bus.emit("dpi:set", { value: action.value });
        else if (action.mode === "cycle") bus.emit("dpi:cycle", { direction: (action.value ?? 1) < 0 ? -1 : 1 });
        else if (action.mode === "sniper") {
          if (sniperKey) return; // already active (key repeat)
          sniperKey = ev.key;
          needInput();
          bus.emit("dpi:sniper", { active: true, value: action.value });
        }
        break;
      case "profile":
        bus.emit("profile:apply", { id: action.profileId, reason: "hotkey" });
        break;
      case "layer":
        if (action.mode === "hold") {
          layerHoldKey = ev.key;
          needInput();
          setLayer(action.layer, ev.packId);
        } else setLayer(store.getState().layer === action.layer ? null : action.layer, ev.packId);
        break;
      case "macro":
      case "launch":
      case "text":
        if (ev.label) bus.emit("hud", { title: ev.label, icon: "keyboard" });
        break;
    }
  };

  await backend.on("remap-fired", (ev) => {
    if (!ev.action) return;
    bus.emit("keymaps:action", { packId: ev.packId, key: ev.key, action: ev.action });
    // tapHold should arrive resolved (tap or hold action); nothing safe to do with an unresolved one.
    if (ev.action.type !== "tapHold") handleAction(ev, ev.action);
  });

  // Release semantics for sniper DPI and hold layers: Rust reports presses only, so we watch
  // the physical key-up of the trigger key.
  await backend.on("input-key", (e) => {
    if (e.down || e.synthetic) return;
    if (sniperKey && e.code === sniperKey) {
      sniperKey = null;
      bus.emit("dpi:sniper", { active: false });
      needInput();
    }
    if (layerHoldKey && e.code === layerHoldKey) {
      const pack = store.getState().activePackId ?? "";
      layerHoldKey = null;
      setLayer(null, pack);
      needInput();
    }
  });

  // --- Cheat-sheet overlay --------------------------------------------------------------------
  startCheatsheet();
}
