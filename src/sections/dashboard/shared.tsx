import { useEffect, useState } from "react";
import { Battery, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, Keyboard, Mouse, Monitor } from "lucide-react";
import type { ConnectedDevice, DeviceDefinition, DeviceType, Profile } from "@/core/types";
import { renderProfilePreview } from "@/core/lighting";
import { getTemplate } from "@/core/devices";

/**
 * Small helpers shared by the dashboard, devices page and sidebar footer.
 */

const nf = (lang: string, digits = 0) => new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** "842 m", "1.24 km", "13.9 km", "1,204 km". */
export function formatDistance(meters: number, lang: string): { value: string; unit: string } {
  if (!Number.isFinite(meters) || meters < 0) meters = 0;
  if (meters < 1000) return { value: nf(lang, meters < 10 ? 1 : 0).format(meters), unit: "m" };
  const km = meters / 1000;
  return { value: nf(lang, km < 10 ? 2 : km < 100 ? 1 : 0).format(km), unit: "km" };
}

/** 1 843 220 → "1.84M", 14 210 → "14.2k" (only above 100k). */
export function formatCount(n: number, lang: string): string {
  if (n >= 1_000_000) return `${nf(lang, 2).format(n / 1_000_000)}M`;
  if (n >= 100_000) return `${nf(lang, 0).format(n / 1000)}k`;
  return nf(lang).format(Math.round(n));
}

export function DeviceIcon({ type, size = 16 }: { type: DeviceType; size?: number }) {
  const Icon = type === "keyboard" ? Keyboard : type === "mouse" ? Mouse : Monitor;
  return <Icon width={size} height={size} />;
}

export function BatteryIcon({ percent, charging, size = 14 }: { percent: number; charging?: boolean; size?: number }) {
  const Icon = charging ? BatteryCharging : percent < 15 ? BatteryLow : percent < 50 ? BatteryMedium : percent < 90 ? Battery : BatteryFull;
  return <Icon width={size} height={size} />;
}

/** Tone for a battery level: green, amber, red. */
export function batteryTone(percent: number, charging?: boolean): "success" | "warning" | "danger" | undefined {
  if (charging) return "success";
  if (percent <= 15) return "danger";
  if (percent <= 30) return "warning";
  return undefined;
}

// ---------------------------------------------------------------------------
// Profile previews (PNG data URLs, cached per profile + device)
// ---------------------------------------------------------------------------

const previewCache = new Map<string, Promise<string>>();

function previewDefinition(device: ConnectedDevice | undefined): { def: DeviceDefinition; layoutId?: string } {
  if (device?.definition.layouts) return { def: device.definition, layoutId: device.layoutId };
  const tpl = getTemplate("ansi-60");
  return {
    def: {
      id: "preview-60",
      name: "Preview",
      vendor: "KeyHalo",
      type: "keyboard",
      match: [],
      driver: "razer",
      capabilities: { perKeyRgb: true },
      layouts: { [tpl.layout.id]: tpl.layout },
      defaultLayout: tpl.layout.id,
      size: tpl.size,
      status: "verified",
    },
  };
}

export function useProfilePreview(profile: Profile, keyboard: ConnectedDevice | undefined, unit = 14): string | undefined {
  const { def, layoutId } = previewDefinition(keyboard);
  // Lighting edits change the scene object, so include a cheap fingerprint of it.
  const key = `${profile.id}|${def.id}|${layoutId ?? ""}|${unit}|${JSON.stringify(profile.lighting).length}|${profile.lighting.layers.map((l) => l.effect).join(",")}`;
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let p = previewCache.get(key);
    if (!p) {
      p = renderProfilePreview(profile, def, layoutId, { unit, background: "transparent" }).catch(() => "");
      previewCache.set(key, p);
    }
    p.then((u) => alive && setUrl(u || undefined));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}
