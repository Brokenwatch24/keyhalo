import { backend } from "@/core/backend";
import { bus } from "@/core/util/bus";
import { startApi } from "./api";
import { DEMO_PRINTER, startBambu } from "./bambu";
import { startClaude } from "./claude";
import { notifyUser } from "./feedback";
import { startGames } from "./games";
import { startMic } from "./mic";
import { startMqtt } from "./mqtt";
import { startNotifications } from "./notifications";
import { wireProfileDirectory } from "./profiles";
import { useIntegrations } from "./store";
import { startSystemMonitor } from "./system";

let started = false;

/** Called once at startup (see src/core/init.ts). Never waits on the network. */
export async function init(): Promise<void> {
  if (started) return;
  started = true;
  await useIntegrations.getState().hydrate();

  // Browser demo: point the Bambu integration at the simulated printer.
  if (backend.kind === "mock" && !useIntegrations.getState().config.bambu.host) {
    useIntegrations.getState().update("bambu", { enabled: true, ...DEMO_PRINTER });
  }

  wireProfileDirectory();
  // Integrations own the generic "notify" bus message: flash + HUD.
  bus.on("notify", ({ text, color, keys }) => notifyUser(text, color, keys));

  for (const [name, start] of [
    ["system", startSystemMonitor],
    ["claude", startClaude],
    ["mic", startMic],
    ["notifications", startNotifications],
    ["games", startGames],
    ["bambu", startBambu],
    ["mqtt", startMqtt],
    ["api", startApi],
  ] as const) {
    try {
      await start();
    } catch (e) {
      console.error(`[integrations] ${name} failed to start`, e);
      useIntegrations.getState().setStatus(name === "mqtt" ? "homeAssistant" : name, "error", String((e as Error)?.message ?? e));
    }
  }
}
