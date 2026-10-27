import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "./backend";
import { useSettings } from "./state/settings";
import { handBackToHardware } from "./devices/manager";

/**
 * In-app updates through the Tauri updater: GitHub Releases publish a signed `latest.json`;
 * the app checks it at start and every few hours (when "Check for updates" is on), downloads
 * the new installer in the background and asks for one click to restart into it.
 */

export type UpdateStatus = "idle" | "checking" | "latest" | "downloading" | "ready" | "installing" | "error" | "unsupported";

export interface UpdatesState {
  status: UpdateStatus;
  /** Version on offer (when downloading / ready). */
  version?: string;
  notes?: string;
  /** Download progress 0..1 (when the size is known). */
  progress?: number;
  error?: string;
  checkedAt?: number;
}

export const useUpdates = create<UpdatesState>(() => ({ status: isTauri ? "idle" : "unsupported" }));

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let pending: Update | null = null;
let running = false;

/** Check GitHub for a newer release and download it in the background. */
export async function checkForUpdates(): Promise<void> {
  if (!isTauri || running) return;
  const cur = useUpdates.getState().status;
  if (cur === "ready" || cur === "installing") return;
  running = true;
  useUpdates.setState({ status: "checking", error: undefined });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      useUpdates.setState({ status: "latest", checkedAt: Date.now() });
      return;
    }
    useUpdates.setState({ status: "downloading", version: update.version, notes: update.body, progress: 0, checkedAt: Date.now() });
    let total = 0;
    let got = 0;
    await update.download((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        got += e.data.chunkLength;
        if (total) useUpdates.setState({ progress: Math.min(1, got / total) });
      }
    });
    await pending?.close().catch(() => {});
    pending = update;
    useUpdates.setState({ status: "ready", progress: 1 });
  } catch (e) {
    useUpdates.setState({ status: "error", error: String((e as Error)?.message ?? e) });
  } finally {
    running = false;
  }
}

/** Hand the lighting back to the devices, then run the downloaded installer (the app restarts). */
export async function installUpdate(): Promise<void> {
  if (!pending) return;
  useUpdates.setState({ status: "installing" });
  try {
    await handBackToHardware().catch(() => {});
    await pending.install();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdates.setState({ status: "error", error: String((e as Error)?.message ?? e) });
  }
}

export function initUpdates() {
  if (!isTauri) return;
  let timer: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  const apply = (on: boolean) => {
    clearTimeout(first);
    clearInterval(timer);
    if (!on) return;
    first = setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
    timer = setInterval(() => void checkForUpdates(), EVERY_MS);
  };
  apply(useSettings.getState().settings.checkUpdates);
  useSettings.subscribe((s, prev) => s.settings.checkUpdates !== prev.settings.checkUpdates && apply(s.settings.checkUpdates));
}
