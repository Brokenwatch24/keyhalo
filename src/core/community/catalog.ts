/**
 * Community catalog: download community/index.json from GitHub, fall back to the copy bundled
 * with the app (or an index built at runtime from the bundled content), and search/filter it.
 */
import type { CatalogEntry, CatalogIndex, CatalogKind } from "../types";
import { INDEX_URL, RAW_BASE, REPO, CATALOG_KINDS, KIND_INFO } from "./constants";
import { effectMetaLite } from "./content";
import { errorFromResponse, http } from "./github";
import { CommunityError } from "./errors";

// ---------------------------------------------------------------------------
// Bundled content (offline fallback)
// ---------------------------------------------------------------------------

const bundledIndexModule = import.meta.glob<CatalogIndex>("/community/index.json", { eager: true, import: "default" });
const bundledJson = import.meta.glob<unknown>(
  ["/community/devices/**/*.json", "/community/profiles/**/*.json", "/community/keymaps/**/*.json", "/community/typing/**/*.json"],
  { import: "default" },
);
const bundledEffects = import.meta.glob<string>("/community/effects/**/*.js", { query: "?raw", import: "default" });

/** "/community/profiles/x.json" → "community/profiles/x.json" */
const norm = (p: string) => p.replace(/^\/+/, "");

/** Read a bundled community file by repository path (null if not bundled). */
export async function readBundled(path: string): Promise<unknown | null> {
  const key = `/${norm(path)}`;
  if (bundledEffects[key]) return bundledEffects[key]();
  if (bundledJson[key]) return structuredClone(await bundledJson[key]());
  return null;
}

/** The index bundled with the app, if community/index.json existed at build time. */
export function bundledIndex(): CatalogIndex | null {
  const idx = Object.values(bundledIndexModule)[0];
  return idx && Array.isArray(idx.entries) && idx.entries.length ? idx : null;
}

const kindOfPath = (path: string): CatalogKind | null => {
  for (const kind of CATALOG_KINDS) if (path.startsWith(`community/${KIND_INFO[kind].folder}/`)) return kind;
  return null;
};

/** Build a CatalogIndex at runtime from the bundled community files. */
export async function runtimeIndex(): Promise<CatalogIndex> {
  const entries: CatalogEntry[] = [];
  const add = (e: CatalogEntry | null) => e && entries.push(e);
  for (const [p, load] of Object.entries(bundledJson)) {
    const path = norm(p);
    const kind = kindOfPath(path);
    if (!kind) continue;
    try {
      add(entryFromData(kind, await load(), path));
    } catch {
      /* skip unreadable */
    }
  }
  for (const [p, load] of Object.entries(bundledEffects)) {
    try {
      const meta = effectMetaLite(await load());
      const id = meta.id ?? norm(p).split("/").pop()!.replace(/\.js$/, "");
      add({ kind: "effect", id, name: meta.name ?? id, description: meta.description, author: meta.author, path: norm(p) });
    } catch {
      /* skip */
    }
  }
  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { generated: new Date(0).toISOString(), repo: REPO, entries };
}

/** CatalogEntry from parsed JSON (mirrors scripts/build-index.mjs, minus git dates). */
export function entryFromData(kind: CatalogKind, data: unknown, path: string): CatalogEntry | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "string" || typeof d.name !== "string") return null;
  const e: CatalogEntry = { kind, id: d.id, name: d.name, path };
  const tags = new Set(Array.isArray(d.tags) ? (d.tags as unknown[]).filter((t): t is string => typeof t === "string") : []);
  if (typeof d.description === "string") e.description = d.description;
  if (typeof d.author === "string") e.author = d.author;
  if (kind === "device") {
    e.description = `${String(d.vendor ?? "")} ${String(d.type ?? "")}`.trim();
    e.devices = [d.id];
    e.status = d.status as CatalogEntry["status"];
    [String(d.vendor ?? "").toLowerCase(), d.type, d.driver].forEach((t) => typeof t === "string" && t && tags.add(t));
  }
  if (kind === "typing") [d.language, d.kind].forEach((t) => typeof t === "string" && tags.add(t));
  if (Array.isArray(d.devices) && kind === "profile") e.devices = d.devices as string[];
  if (Array.isArray(d.apps) && (d.apps as unknown[]).length) e.apps = d.apps as string[];
  if (tags.size) e.tags = [...tags];
  return e;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export function isCatalogIndex(v: unknown): v is CatalogIndex {
  return !!v && typeof v === "object" && Array.isArray((v as CatalogIndex).entries) && typeof (v as CatalogIndex).generated === "string";
}

/** Download the published index from GitHub. */
export async function fetchIndex(url = INDEX_URL): Promise<CatalogIndex> {
  const res = await http("GET", `${url}?t=${Math.floor(Date.now() / 60_000)}`, { headers: { Accept: "application/json" } });
  if (res.status !== 200) throw errorFromResponse(res);
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch (e) {
    throw new CommunityError("invalidContent", { cause: e, details: ["index.json is not valid JSON"] });
  }
  if (!isCatalogIndex(parsed)) throw new CommunityError("invalidContent", { details: ["index.json has an unexpected shape"] });
  parsed.entries = parsed.entries.filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && typeof e.path === "string" && CATALOG_KINDS.includes(e.kind));
  return parsed;
}

/** Raw URL of a repository file, e.g. a catalog entry's path or preview. */
export const rawUrl = (path: string) => (/^(https?:|data:)/.test(path) ? path : `${RAW_BASE}/${norm(path)}`);

// ---------------------------------------------------------------------------
// Search & filters
// ---------------------------------------------------------------------------

export interface CatalogFilters {
  /** Free-text search over name, description, author, tags, apps and id. */
  query: string;
  /** Kinds to show (empty = all). */
  kinds: CatalogKind[];
  /** Entries must have all of these tags. */
  tags: string[];
  /** Only content made for (or compatible with) devices connected right now. */
  compatibleOnly: boolean;
  /** Only content for this process name (e.g. "Resolve.exe"). */
  app?: string;
  /** Only items that are (not) installed. */
  installed?: "only" | "hide";
  sort: "relevance" | "updated" | "name";
}

export const DEFAULT_FILTERS: CatalogFilters = { query: "", kinds: [], tags: [], compatibleOnly: false, sort: "relevance" };

const normText = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Relevance score of an entry for a query (0 = no match). */
export function scoreEntry(e: CatalogEntry, query: string): number {
  const terms = normText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const name = normText(e.name);
  const fields = normText([e.id, e.description, e.author, ...(e.tags ?? []), ...(e.apps ?? []), ...(e.devices ?? []), e.kind].filter(Boolean).join(" "));
  let score = 0;
  for (const t of terms) {
    if (name.startsWith(t)) score += 6;
    else if (name.includes(t)) score += 4;
    else if (fields.includes(t)) score += 1;
    else return 0;
  }
  return score;
}

/** Is an entry usable with the given connected device definition ids? */
export function isCompatible(e: CatalogEntry, connectedDefinitionIds: string[]): boolean {
  if (e.kind === "device") return connectedDefinitionIds.includes(e.id);
  if (!e.devices?.length) return true; // made for any device
  return e.devices.some((d) => connectedDefinitionIds.includes(d));
}

export function filterCatalog(
  entries: CatalogEntry[],
  filters: CatalogFilters,
  ctx: { connectedDefinitionIds?: string[]; installedKeys?: Set<string> } = {},
): CatalogEntry[] {
  const app = filters.app?.toLowerCase();
  const scored: [CatalogEntry, number][] = [];
  for (const e of entries) {
    if (filters.kinds.length && !filters.kinds.includes(e.kind)) continue;
    if (filters.tags.length && !filters.tags.every((t) => e.tags?.includes(t))) continue;
    if (filters.compatibleOnly && !isCompatible(e, ctx.connectedDefinitionIds ?? [])) continue;
    if (app && !(e.apps ?? []).some((a) => a.toLowerCase() === app)) continue;
    if (filters.installed && ctx.installedKeys) {
      const inst = ctx.installedKeys.has(`${e.kind}:${e.id}`);
      if (filters.installed === "only" ? !inst : inst) continue;
    }
    const s = scoreEntry(e, filters.query);
    if (s > 0) scored.push([e, s]);
  }
  const byUpdated = (a: CatalogEntry, b: CatalogEntry) => (b.updated ?? "").localeCompare(a.updated ?? "");
  const byName = (a: CatalogEntry, b: CatalogEntry) => a.name.localeCompare(b.name);
  scored.sort(([a, sa], [b, sb]) =>
    filters.sort === "name" ? byName(a, b) : filters.sort === "updated" ? byUpdated(a, b) || byName(a, b) : sb - sa || byUpdated(a, b) || byName(a, b),
  );
  return scored.map(([e]) => e);
}

/** Tags with counts, most used first (for filter chips). */
export function catalogTags(entries: CatalogEntry[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) for (const t of e.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Apps (process names) referenced by the catalog, for the app filter. */
export function catalogApps(entries: CatalogEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => e.apps ?? []))].sort((a, b) => a.localeCompare(b));
}

/** Count of entries per kind. */
export function countByKind(entries: CatalogEntry[]): Record<CatalogKind, number> {
  const out = { device: 0, profile: 0, keymap: 0, effect: 0, typing: 0 } as Record<CatalogKind, number>;
  for (const e of entries) out[e.kind]++;
  return out;
}
