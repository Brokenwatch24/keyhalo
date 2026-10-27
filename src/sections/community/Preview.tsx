import { useEffect, useMemo, useState } from "react";
import { KeyboardView, MouseView } from "@/ui";
import { useT } from "@/i18n";
import { rawUrl } from "@/core/community";
import { useDevices } from "@/core/devices/store";
import { useProfiles, bundledProfiles, renderProfilePreview, useEffects, effectRegistry } from "@/core/lighting";
import { BUNDLED_PACKS, useKeymaps } from "@/core/keymaps";
import { useTypingPacks } from "@/core/typing/packs";
import type { CatalogEntry, DeviceDefinition, KeymapPack, Profile, RGB } from "@/core/types";
import { hueOf, KindIcon } from "./shared";

/**
 * Gallery thumbnails. Real preview images win (`entry.preview`); otherwise a cheap, tasteful
 * placeholder is generated from the item itself:
 *  - profiles / effects: the scene rendered on a keyboard (renderProfilePreview, cached, queued)
 *  - keymaps: app monogram + category colour chips
 *  - devices: the device drawing (unlit keyboard / mouse silhouette)
 *  - typing: language + kind + a line of sample text
 */

// ---------------------------------------------------------------------------
// Render queue (one preview at a time, cached for the session)
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

function queued(key: string, job: () => Promise<string>): Promise<string | null> {
  let p = cache.get(key);
  if (!p) {
    p = queue.then(
      () =>
        new Promise<string | null>((resolve) => {
          setTimeout(() => job().then(resolve, () => resolve(null)), 0);
        }),
    );
    queue = p;
    cache.set(key, p);
  }
  return p;
}

/** The keyboard used to stage previews: the connected one, else a bundled 60 %. */
export function previewKeyboard(definitions: DeviceDefinition[], connected: DeviceDefinition[]): DeviceDefinition | undefined {
  const usable = (d: DeviceDefinition) => d.type === "keyboard" && !!d.layouts && Object.keys(d.layouts).length > 0;
  return connected.find(usable) ?? definitions.find((d) => usable(d) && /mini/.test(d.id)) ?? definitions.find(usable);
}

function usePreviewKeyboard() {
  const definitions = useDevices((s) => s.definitions);
  const devices = useDevices((s) => s.devices);
  return useMemo(
    () => previewKeyboard(definitions, devices.map((d) => d.definition)),
    [definitions, devices],
  );
}

function useRendered(key: string | null, job: (() => Promise<string>) | null) {
  const [url, setUrl] = useState<string | null | undefined>(() => undefined);
  useEffect(() => {
    if (!key || !job) {
      setUrl(null);
      return;
    }
    let live = true;
    setUrl(undefined);
    queued(key, job).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

/** Render any profile on the preview keyboard (also used by the publish form). */
export function renderProfileThumb(profile: Profile, kb: DeviceDefinition, t = 1): Promise<string> {
  return renderProfilePreview(profile, kb, undefined, { unit: 30, background: "rgba(0,0,0,0)", t });
}

// ---------------------------------------------------------------------------
// Fallback: colours derived from the profile's layer params
// ---------------------------------------------------------------------------

const HEX = /^#([0-9a-f]{6})$/i;
const toRgb = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function profilePalette(profile: Pick<Profile, "lighting">): string[] {
  const out: string[] = [];
  for (const layer of profile.lighting?.layers ?? []) {
    if (!layer.enabled || layer.effect.startsWith("widget:")) continue;
    for (const v of Object.values(layer.params ?? {})) {
      const list = Array.isArray(v) ? v : [v];
      for (const c of list) if (typeof c === "string" && HEX.test(c) && c.toLowerCase() !== "#000000") out.push(c);
    }
  }
  return out.length ? [...new Set(out)].slice(0, 5) : ["#7c7cff", "#4dd0e1"];
}

function gradientColors(palette: string[], keys: { code: string; x: number }[], width: number): Record<string, RGB> {
  const stops = palette.map(toRgb);
  const out: Record<string, RGB> = {};
  for (const k of keys) {
    const p = Math.max(0, Math.min(0.9999, k.x / Math.max(1, width))) * (stops.length - 1);
    const i = Math.floor(p);
    const f = p - i;
    const a = stops[i];
    const b = stops[Math.min(stops.length - 1, i + 1)];
    out[k.code] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  return out;
}

function FallbackKeyboard({ kb, palette }: { kb: DeviceDefinition; palette: string[] }) {
  const layout = kb.layouts?.[kb.defaultLayout ?? ""] ?? Object.values(kb.layouts ?? {})[0];
  if (!layout) return null;
  return <KeyboardView keys={layout.keys} size={kb.size} colors={gradientColors(palette, layout.keys, kb.size.w)} showLabels={false} maxWidth={300} glow={0.7} />;
}

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

function findProfile(id: string): Profile | undefined {
  return useProfiles.getState().profiles.find((p) => p.id === id) ?? bundledProfiles().find((p) => p.id === id);
}

function SceneThumb({ cacheKey, profile, kb, time }: { cacheKey: string; profile: Profile | undefined; kb: DeviceDefinition | undefined; time?: number }) {
  const url = useRendered(
    profile && kb ? `${cacheKey}@${kb.id}` : null,
    profile && kb
      ? async () => {
          // Sparse effects (sparks, scanners) can be almost dark on a still frame: fall back to their palette.
          const out = await renderProfileThumb(profile, kb, time);
          if (time !== undefined && (await litness(out)) < 0.08) throw new Error("dark");
          return out;
        }
      : null,
  );
  if (url) return <img className="community-thumb__img" src={url} alt="" draggable={false} />;
  if (url === undefined) return <div className="community-thumb__shimmer" />;
  if (profile && kb) return <FallbackKeyboard kb={kb} palette={profilePalette(profile)} />;
  return <GlyphThumb label={cacheKey} />;
}

function ProfileThumb({ entry }: { entry: CatalogEntry }) {
  const kb = usePreviewKeyboard();
  const loaded = useProfiles((s) => s.loaded);
  const profile = useMemo(() => findProfile(entry.id), [entry.id, loaded]);
  return <SceneThumb cacheKey={`profile:${entry.id}`} profile={profile} kb={kb} />;
}

function EffectThumb({ entry }: { entry: CatalogEntry }) {
  const kb = usePreviewKeyboard();
  const effects = useEffects();
  const ready = effects.some((e) => e.id === entry.id);
  const profile = useMemo<Profile | undefined>(
    () =>
      ready
        ? {
            id: `effect-${entry.id}`,
            name: entry.name,
            lighting: { layers: [{ id: "fx", effect: entry.id, params: defaultParams(entry.id), blend: "normal", opacity: 1, enabled: true }], brightness: 1, fps: 30 },
          }
        : undefined,
    [ready, entry.id, entry.name],
  );
  if (!ready) return <EffectPlaceholder entry={entry} />;
  return <SceneThumb cacheKey={`effect:${entry.id}`} profile={profile} kb={kb} time={2.4} />;
}

function defaultParams(id: string): Record<string, unknown> {
  const meta = effectRegistry.get(id)?.meta;
  return Object.fromEntries(Object.entries(meta?.params ?? {}).map(([k, d]) => [k, d.default]));
}

/** 0..1: how bright the brightest lit pixels of a rendered preview are. */
async function litness(url: string): Promise<number> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = 96;
    const h = Math.max(1, Math.round((img.height / img.width) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const vals: number[] = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) vals.push(Math.max(d[i], d[i + 1], d[i + 2]) / 255);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    return mean - 0.14; // unlit plate + keycaps
  } catch {
    return 1;
  }
}

function EffectPlaceholder({ entry }: { entry: CatalogEntry }) {
  const h = hueOf(entry.id);
  return (
    <div
      className="community-thumb__fx"
      style={{ background: `radial-gradient(120% 140% at 15% 20%, hsl(${h} 90% 55% / 0.85), transparent 55%), radial-gradient(120% 140% at 85% 80%, hsl(${(h + 70) % 360} 90% 55% / 0.75), transparent 60%), #0c0c0e` }}
    />
  );
}

function findPack(id: string, packs: KeymapPack[]): KeymapPack | undefined {
  return packs.find((p) => p.id === id) ?? BUNDLED_PACKS.find((p) => p.id === id);
}

function KeymapThumb({ entry }: { entry: CatalogEntry }) {
  const packs = useKeymaps((s) => s.packs);
  const pack = findPack(entry.id, packs);
  const app = (entry.apps?.[0] ?? pack?.apps?.[0] ?? entry.name).replace(/\.exe$/i, "");
  const cats = Object.entries(pack?.categories ?? {});
  const accent = cats[0]?.[1] ?? `hsl(${hueOf(entry.id)} 70% 60%)`;
  const shortcuts = pack ? pack.legends.length + pack.bindings.length : 0;
  return (
    <div className="community-thumb__keymap">
      <div className="community-monogram" style={{ ["--accent" as string]: accent }}>
        {app.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1).toUpperCase() || "?"}
      </div>
      <div className="community-thumb__keymap-body">
        {cats.length > 0 && (
          <div className="community-chips">
            {cats.slice(0, 5).map(([name, color]) => (
              <span key={name} className="community-chip">
                <span className="community-chip__dot" style={{ background: color }} />
                {name}
              </span>
            ))}
            {cats.length > 5 && <span className="community-chip community-chip--more">+{cats.length - 5}</span>}
          </div>
        )}
        <div className="community-thumb__count">
          <span className="mono">{entry.apps?.[0] ?? pack?.apps[0] ?? "global"}</span>
          {shortcuts > 0 && <ShortcutCount n={shortcuts} />}
        </div>
      </div>
    </div>
  );
}

function ShortcutCount({ n }: { n: number }) {
  const t = useT();
  return <span> · {t("community.page.shortcuts", { count: n })}</span>;
}

function DeviceThumb({ entry }: { entry: CatalogEntry }) {
  const definitions = useDevices((s) => s.definitions);
  const def = definitions.find((d) => d.id === entry.id);
  if (def?.type === "keyboard") {
    const layout = def.layouts?.[def.defaultLayout ?? ""] ?? Object.values(def.layouts ?? {})[0];
    if (layout) return <KeyboardView keys={layout.keys} size={def.size} showLabels={false} maxWidth={def.size.w > 18 ? 300 : 250} />;
  }
  if (def?.type === "mouse") {
    const colors = Object.fromEntries((def.leds ?? []).map((l) => [l.id, "#d4d4d8"]));
    return <MouseView leds={def.leds} colors={colors} height={112} />;
  }
  return <GlyphThumb label={entry.name} entry={entry} />;
}

function GlyphThumb({ label, entry }: { label: string; entry?: CatalogEntry }) {
  return (
    <div className="community-thumb__glyph" title={label}>
      {entry ? <KindIcon kind={entry.kind} entry={entry} /> : null}
    </div>
  );
}

const LANG_LABEL: Record<string, string> = { any: "{ }" };

function TypingThumb({ entry }: { entry: CatalogEntry }) {
  const t = useT();
  const packs = useTypingPacks((s) => s.packs);
  const pack = packs.find((p) => p.id === entry.id);
  const language = pack?.language ?? entry.tags?.find((x) => /^[a-z]{2,3}$/.test(x)) ?? "any";
  const kind = pack?.kind ?? (entry.tags?.find((x) => ["words", "quotes", "code", "lessons"].includes(x)) as string | undefined);
  const sample = pack?.words?.slice(0, 14).join(" ") ?? pack?.texts?.[0]?.text ?? entry.description ?? "";
  const code = kind === "code" ? "{ }" : (LANG_LABEL[language] ?? language.toUpperCase());
  return (
    <div className="community-thumb__typing">
      <div className="community-thumb__lang mono">{code}</div>
      <div className="community-thumb__kind">{kind ? t(`community.page.typingKinds.${kind}`) : ""}</div>
      <div className="community-thumb__sample mono">
        {sample.slice(0, 90)}
        <span className="community-caret" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ItemPreview({ entry }: { entry: CatalogEntry }) {
  const [imgFailed, setImgFailed] = useState(false);
  let body;
  if (entry.preview && !imgFailed) body = <img className="community-thumb__img" src={rawUrl(entry.preview)} alt="" onError={() => setImgFailed(true)} draggable={false} />;
  else if (entry.kind === "profile") body = <ProfileThumb entry={entry} />;
  else if (entry.kind === "effect") body = <EffectThumb entry={entry} />;
  else if (entry.kind === "keymap") body = <KeymapThumb entry={entry} />;
  else if (entry.kind === "device") body = <DeviceThumb entry={entry} />;
  else body = <TypingThumb entry={entry} />;
  return <div className={`community-thumb community-thumb--${entry.kind}`}>{body}</div>;
}
