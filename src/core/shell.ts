import { backend } from "./backend";
import { bus } from "./util/bus";
import { useSettings } from "./state/settings";
import { useProfiles } from "./lighting/profiles";
import { registerProfiles } from "./integrations/profiles";

/**
 * App-shell wiring that spans features: the on-screen HUD, the tray profile menu,
 * the profile list shared with integrations, and close-to-tray behaviour.
 */
export async function initShell() {
  bus.on("hud", (payload) => {
    const { hud } = useSettings.getState().settings;
    if (!hud.enabled) return;
    void backend
      .hudShow({ ...payload, durationMs: payload.durationMs ?? hud.durationMs, position: payload.position ?? hud.position })
      .catch((e) => console.warn("[hud] could not show", e));
  });

  const syncProfiles = () => {
    const { profiles, activeId } = useProfiles.getState();
    registerProfiles(profiles.map((p) => ({ id: p.id, name: p.name })));
    void backend.traySetProfiles(profiles.map((p) => ({ id: p.id, name: p.name, active: p.id === activeId }))).catch(() => {});
  };
  syncProfiles();
  useProfiles.subscribe((s, prev) => (s.profiles !== prev.profiles || s.activeId !== prev.activeId) && syncProfiles());

  await backend.on("tray-action", ({ action, value }) => {
    if (action === "profile" && value) bus.emit("profile:apply", { id: value, reason: "tray" });
  });

  const syncTray = () => void backend.appSetCloseToTray(useSettings.getState().settings.minimizeToTray).catch(() => {});
  syncTray();
  useSettings.subscribe((s, prev) => s.settings.minimizeToTray !== prev.settings.minimizeToTray && syncTray());
}
