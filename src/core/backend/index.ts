import type { Backend } from "./api";
import { TauriBackend } from "./tauri";
import { MockBackend } from "./mock";

export * from "./api";

/** True when running inside the desktop app (vs. the browser demo). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The single backend instance used across the app. */
export const backend: Backend = isTauri ? new TauriBackend() : new MockBackend();
