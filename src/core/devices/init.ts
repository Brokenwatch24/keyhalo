import { backend } from "@/core/backend";
import { startDeviceManager } from "./manager";

/** Called once at startup (see src/core/init.ts). */
export async function init(): Promise<void> {
  if (backend.kind === "mock") {
    // Browser demo: simulate the user's real desk (Huntsman Mini + DeathAdder V2 Pro).
    const { registerRazerSimulators } = await import("./sim/razer");
    await registerRazerSimulators();
  }
  // Never block startup on hardware: the first scan runs, later ones are timers/events.
  await startDeviceManager().catch((e) => console.error("[devices] manager failed to start", e));
}
