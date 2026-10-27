/**
 * keyhalo:// deep links:
 *   keyhalo://install?kind=profile&id=neon-focus   → install from the catalog
 *   keyhalo://import?gist=<id>                     → import a shared gist
 *   keyhalo://import?url=<encoded https url>       → import a raw JSON/JS file
 * In the browser demo the same links can be passed as `?import=<link or gist url>`.
 */
import type { CatalogKind } from "../types";
import { CATALOG_KINDS } from "./constants";
import { ID_PATTERN } from "./content";

export type DeepLink =
  | { action: "install"; kind: CatalogKind; id: string }
  | { action: "import"; gist: string }
  | { action: "import"; url: string };

/** Parse a keyhalo:// link (null if it isn't one we understand). */
export function parseDeepLink(link: string): DeepLink | null {
  const m = /^keyhalo:\/{0,3}([a-z-]+)\/?(?:\?(.*))?$/i.exec(link.trim());
  if (!m) return null;
  const action = m[1].toLowerCase();
  const params = new URLSearchParams(m[2] ?? "");
  if (action === "install") {
    const kind = params.get("kind") as CatalogKind | null;
    const id = params.get("id");
    if (!kind || !CATALOG_KINDS.includes(kind) || !id || !ID_PATTERN.test(id)) return null;
    return { action: "install", kind, id };
  }
  if (action === "import") {
    const gist = params.get("gist");
    if (gist && /^[0-9a-f]{20,40}$/i.test(gist)) return { action: "import", gist: gist.toLowerCase() };
    const url = params.get("url");
    if (url && /^https:\/\//i.test(url)) return { action: "import", url };
  }
  return null;
}

/** Build a deep link for a catalog item (for "Copy link" buttons). */
export function installDeepLink(kind: CatalogKind, id: string): string {
  return `keyhalo://install?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
}

/**
 * Read `?import=` from the page URL (browser demo). Accepts a keyhalo:// link, a gist URL/id
 * or an https URL. Returns the raw value or null.
 */
export function importParamFromLocation(loc: Pick<Location, "search" | "hash"> | undefined = typeof window !== "undefined" ? window.location : undefined): string | null {
  if (!loc) return null;
  const fromSearch = new URLSearchParams(loc.search).get("import");
  if (fromSearch) return fromSearch;
  const q = loc.hash.indexOf("?");
  return q >= 0 ? new URLSearchParams(loc.hash.slice(q + 1)).get("import") : null;
}
