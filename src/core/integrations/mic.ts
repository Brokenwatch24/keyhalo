import { backend, isTauri } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { bus } from "@/core/util/bus";
import { t } from "@/i18n";
import type { MicConfig } from "./config";
import { hud } from "./feedback";
import { registerHotkey } from "./hotkeys";
import { registerTest, useIntegrations, watchConfig } from "./store";

/** Microphone mute state (default capture device) + a global toggle hotkey. */
let cfg: MicConfig | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let unregister: (() => void) | null = null;
let hotkeyGen = 0;

function publish(muted: boolean, fromToggle = false) {
  const prev = useSignals.getState().micMuted;
  if (prev === muted) return;
  useSignals.getState().set({ micMuted: muted });
  // Show the HUD for every change after the first reading (external changes too, e.g. headset button).
  if ((prev !== undefined || fromToggle) && cfg?.hud) hud({ title: t(muted ? "integrations.mic.muted" : "integrations.mic.live"), icon: "mic", color: muted ? "#ff6b6b" : "#7ee0a1" });
}

async function poll() {
  try {
    publish(await backend.micMuted());
    useIntegrations.getState().setStatus("mic", "connected");
  } catch (e) {
    useIntegrations.getState().setStatus("mic", "error", String((e as Error)?.message ?? e));
  }
}

/** Toggle (or set) the microphone mute. */
export async function toggleMic(muted?: boolean) {
  const next = muted ?? !(await backend.micMuted().catch(() => Boolean(useSignals.getState().micMuted)));
  await backend.setMicMuted(next);
  publish(next, true);
}

export function startMic() {
  registerTest("mic", async () => {
    const m = await backend.micMuted();
    return { ok: true, message: m ? "Microphone muted" : "Microphone live" };
  });
  // Keymap packs can bind { type: "media", command: "micMute" }.
  bus.on("keymaps:action", ({ action }) => {
    if (action.type === "media" && action.command === "micMute") toggleMic().catch(() => {});
  });
  watchConfig("mic", (next) => {
    const prevHotkey = cfg?.enabled ? cfg.hotkey : "";
    cfg = next;
    clearInterval(timer);
    timer = undefined;
    if (next.enabled) {
      poll();
      timer = setInterval(poll, 1000);
    } else {
      useSignals.getState().set({ micMuted: undefined });
      useIntegrations.getState().setStatus("mic", "idle");
    }
    const wantHotkey = next.enabled && isTauri ? next.hotkey : "";
    if (wantHotkey === prevHotkey && unregister) return;
    unregister?.();
    unregister = null;
    if (!wantHotkey) return;
    const gen = ++hotkeyGen;
    registerHotkey(wantHotkey, () => void toggleMic().catch(() => {}))
      .then((un) => (gen === hotkeyGen ? (unregister = un) : un()))
      .catch((e) => useIntegrations.getState().setStatus("mic", "error", `Hotkey ${wantHotkey}: ${String((e as Error)?.message ?? e)}`));
  });
}
