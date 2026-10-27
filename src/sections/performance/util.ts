import { t } from "@/i18n";
import { toast } from "@/ui";

/** Human message for a device write error (safe mode, unsupported, driver message). */
export function errorText(e: unknown): string {
  const name = (e as Error | undefined)?.name;
  if (name === "SafeModeError") return t("devices.errors.safeMode");
  if (name === "NotSupportedError") return t("devices.errors.notSupported");
  const msg = (e as Error | undefined)?.message ?? String(e);
  if (/not initialised|not connected/i.test(msg)) return t("devices.errors.notConnected");
  return msg;
}

/** Run a hardware write and show a toast if it fails. Resolves to true on success. */
export async function write(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    toast(errorText(e), "danger");
    return false;
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Snap to `step` within [min, max]. */
export const snap = (v: number, min: number, max: number, step: number) => clamp(Math.round(v / step) * step, min, max);

/** Per-viewer convenience storage (never required for correctness). */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`keyhalo:ui:${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(`keyhalo:ui:${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
