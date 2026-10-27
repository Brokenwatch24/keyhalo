import type { RGB } from "@/core/types";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Human message for a device error (safe mode / not supported get their own strings). */
export function errorText(e: unknown, t: TFn): string {
  const err = e as { name?: string; message?: string } | undefined;
  if (err?.name === "SafeModeError") return t("devices.errors.safeMode");
  if (err?.name === "NotSupportedError") return t("devices.errors.notSupported");
  const msg = err?.message ?? String(e);
  if (/busy/i.test(msg)) return t("devices.errors.busy");
  if (/timeout|no answer|did not answer/i.test(msg)) return t("devices.errors.asleep");
  return msg;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

export function rgbToHex(c: RGB): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** "0x1532" for 5426. */
export const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
