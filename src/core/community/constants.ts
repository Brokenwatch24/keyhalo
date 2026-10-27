import type { CatalogKind } from "../types";

export const REPO_OWNER = "Brokenwatch24";
export const REPO_NAME = "keyhalo";
export const REPO = `${REPO_OWNER}/${REPO_NAME}`;
export const REPO_URL = `https://github.com/${REPO}`;
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
export const INDEX_URL = `${RAW_BASE}/community/index.json`;
export const API_BASE = "https://api.github.com";
export const SITE_URL = `https://${REPO_OWNER.toLowerCase()}.github.io/${REPO_NAME}/`;

/** Storage names (app data folder; localStorage in the browser demo). */
export const STORAGE = {
  indexCache: "community/index-cache.json",
  installed: "community/installed.json",
  dir: (kind: CatalogKind) => `installed/${kind}`,
  file: (kind: CatalogKind, id: string) => `installed/${kind}/${id}${KIND_INFO[kind].ext}`,
} as const;

export interface KindInfo {
  /** Folder under community/ in the repository. */
  folder: string;
  ext: ".json" | ".js";
  schema: string;
}

export const KIND_INFO: Record<CatalogKind, KindInfo> = {
  device: { folder: "devices", ext: ".json", schema: "device.schema.json" },
  profile: { folder: "profiles", ext: ".json", schema: "profile.schema.json" },
  keymap: { folder: "keymaps", ext: ".json", schema: "keymap.schema.json" },
  effect: { folder: "effects", ext: ".js", schema: "effect-meta.schema.json" },
  typing: { folder: "typing", ext: ".json", schema: "typing.schema.json" },
};

export const CATALOG_KINDS: CatalogKind[] = ["profile", "keymap", "effect", "device", "typing"];

/** The catalog is refreshed in the background when the cache is older than this. */
export const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Largest file the app accepts from the community (bytes of text). */
export const MAX_CONTENT_SIZE = 2 * 1024 * 1024;

/** OAuth scopes requested by the device flow. */
export const GITHUB_SCOPES = "public_repo gist";

/** Issue form templates in .github/ISSUE_TEMPLATE (field ids are a contract). */
export const ISSUE_TEMPLATES = {
  worksOnMyDevice: "works_on_my_device.yml",
  deviceRequest: "device_request.yml",
} as const;
