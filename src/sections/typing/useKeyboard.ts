import { useMemo } from "react";
import { useDevices, primaryKeyboard, layoutOf } from "@/core/devices/store";
import { getTemplate } from "@/core/devices/templates";
import { localeLabels, type KeyLocale } from "@/core/typing/charmap";
import type { KeyDef, Layout } from "@/core/types";

const RELABEL = /^(Key[A-Z]|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Comma|Period|Slash|Backquote|IntlBackslash)$/;

export interface TypingKeyboard {
  keys: KeyDef[];
  size: { w: number; h: number };
  layout: Layout;
  deviceName?: string;
  /** True when a real keyboard is connected (its LEDs can show guidance). */
  connected: boolean;
}

/**
 * The keyboard drawn under the text: the connected keyboard's active layout, or a generic
 * 60 % template (ISO for Spanish layouts so Ñ/<> keys exist). Legends are relabelled for the
 * chosen locale so Spanish users see Ñ, ´ and ¿ where they really are.
 */
export function useTypingKeyboard(locale: KeyLocale): TypingKeyboard {
  const devices = useDevices((s) => s.devices);
  return useMemo(() => {
    const dev = primaryKeyboard(devices);
    const devLayout = dev ? layoutOf(dev) : undefined;
    const tpl = getTemplate(locale === "us" ? "ansi-60" : "iso-60");
    const layout = devLayout ?? tpl.layout;
    const size = devLayout && dev ? dev.definition.size : tpl.size;
    let keys = layout.keys;
    if (locale !== "us") {
      const labels = localeLabels(locale);
      keys = keys.map((k) => (RELABEL.test(k.code) && labels[k.code] ? { ...k, label: labels[k.code] } : k));
    }
    return { keys, size, layout, deviceName: dev?.definition.name, connected: !!dev };
  }, [devices, locale]);
}
