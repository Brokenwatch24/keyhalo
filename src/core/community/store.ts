import { useMemo } from "react";
import { create } from "zustand";
import { loadJson, saveJson } from "@/core/state/persist";
import { useSettings } from "@/core/state/settings";
import { useDevices } from "@/core/devices/store";
import type { CatalogEntry, CatalogIndex, CatalogKind } from "../types";
import { CATALOG_MAX_AGE_MS, STORAGE } from "./constants";
import { bundledIndex, DEFAULT_FILTERS, fetchIndex, filterCatalog, isCatalogIndex, rawUrl, readBundled, runtimeIndex, type CatalogFilters } from "./catalog";
import { makePreview, type InstallPreview } from "./content";
import { parseDeepLink } from "./deeplinks";
import { CommunityError } from "./errors";
import { GitHubClient, http, errorFromResponse, pollDeviceFlow, startDeviceFlow, type DeviceCodeInfo } from "./github";
import { deleteInstalled, isUpdateAvailable, itemKey, readInstalled, saveRegistry, writeInstalled, type InstalledItem, type InstalledRegistry } from "./install";
import { publishPullRequest, resolveImport, shareGist, type GistShareResult, type PublishRequest, type PublishResult } from "./publish";

export type CatalogSource = "network" | "cache" | "bundled" | "runtime";

export type AuthState =
  | { status: "signedOut"; error?: CommunityError }
  | { status: "pending"; code: DeviceCodeInfo }
  | { status: "signedIn"; login: string };

interface IndexCache {
  index: CatalogIndex;
  fetchedAt: string;
}

export interface CommunityState {
  // Catalog ------------------------------------------------------------------
  index: CatalogIndex | null;
  /** Where the current index came from. */
  source: CatalogSource | null;
  /** When the index was last downloaded (ISO). */
  fetchedAt?: string;
  loading: boolean;
  /** Last catalog error (show with communityErrorMessage). The index may still be usable (offline fallback). */
  error: CommunityError | null;
  filters: CatalogFilters;

  // Installed ----------------------------------------------------------------
  installed: InstalledRegistry;
  /** Keys ("kind:id") currently being installed/removed. */
  busy: Record<string, boolean>;

  // Auth ---------------------------------------------------------------------
  auth: AuthState;

  // Imports (deep links, ?import=) ------------------------------------------
  /** An item waiting for the user to review and confirm (opened from a link). */
  pendingImport: InstallPreview | null;
  pendingImportError: CommunityError | null;

  // Actions ------------------------------------------------------------------
  /** Load the catalog: cache → network (unless fresh) → bundled → runtime-built fallback. */
  refresh(opts?: { force?: boolean }): Promise<void>;
  setFilters(patch: Partial<CatalogFilters>): void;
  resetFilters(): void;
  findEntry(kind: CatalogKind, id: string): CatalogEntry | undefined;
  isInstalled(kind: CatalogKind, id: string): boolean;
  hasUpdate(kind: CatalogKind, id: string): boolean;
  /** Installed catalog items with a newer version in the catalog. */
  updates(): CatalogEntry[];

  /** Download + check an entry. Shows nothing; returns the preview the UI must present. */
  prepareInstall(entry: CatalogEntry): Promise<InstallPreview>;
  /** Install a preview. Throws CommunityError("needsConfirmation") when risky and not confirmed. */
  install(preview: InstallPreview, opts?: { confirmRisky?: boolean }): Promise<InstalledItem>;
  /** prepareInstall + install in one go (same confirmation rule). */
  installEntry(entry: CatalogEntry, opts?: { confirmRisky?: boolean }): Promise<InstalledItem>;
  uninstall(kind: CatalogKind, id: string): Promise<void>;
  /** Read an installed item (parsed JSON, or source for effects). */
  readInstalled(kind: CatalogKind, id: string): Promise<unknown | null>;

  /** Gist id/URL, raw URL, keyhalo:// link or pasted JSON/JS → preview (not installed yet). */
  importFrom(input: string): Promise<InstallPreview>;
  /** Handle a keyhalo:// link: resolves it into `pendingImport` for the UI to confirm. */
  handleDeepLink(link: string): Promise<void>;
  clearPendingImport(): void;

  /** Share as a public gist (needs sign-in). */
  shareGist(kind: CatalogKind, data: unknown, opts?: { public?: boolean }): Promise<GistShareResult>;
  /** Open a pull request with the item (needs sign-in). */
  publish(req: PublishRequest): Promise<PublishResult>;

  /** True when an OAuth client id is configured (device flow available). */
  canUseDeviceFlow(): boolean;
  /** Start the GitHub device flow; returns the code to show. Polling continues in the background. */
  signIn(): Promise<DeviceCodeInfo>;
  cancelSignIn(): void;
  /** Fallback: sign in with a personal access token. */
  signInWithToken(token: string): Promise<void>;
  signOut(): void;
}

let pollAbort: AbortController | null = null;

const clientId = () => useSettings.getState().settings.github.clientId?.trim() || (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined)?.trim() || "";
const token = () => useSettings.getState().settings.github.token || undefined;
const asCommunityError = (e: unknown) => (e instanceof CommunityError ? e : new CommunityError("github", { vars: { status: 0, message: e instanceof Error ? e.message : String(e) }, cause: e }));

function setGithub(patch: { token?: string; user?: string }) {
  const s = useSettings.getState();
  s.update({ github: { ...s.settings.github, ...patch } });
}

async function downloadEntry(entry: CatalogEntry): Promise<unknown> {
  const isEffect = entry.kind === "effect";
  try {
    const res = await http("GET", rawUrl(entry.path), { headers: { Accept: isEffect ? "text/plain" : "application/json" } });
    if (res.status !== 200) throw errorFromResponse(res);
    if (isEffect) return res.body;
    try {
      return JSON.parse(res.body);
    } catch (e) {
      throw new CommunityError("invalidContent", { cause: e, vars: { problems: "not valid JSON" }, details: ["not valid JSON"] });
    }
  } catch (e) {
    // Offline, rate-limited or not on GitHub yet: use the copy bundled with the app when there is one.
    if (e instanceof CommunityError && (e.code === "network" || e.code === "offline" || e.code === "notFound" || e.code === "rateLimited")) {
      const bundled = await readBundled(entry.path);
      if (bundled != null) return bundled;
    }
    throw e;
  }
}

export const useCommunity = create<CommunityState>((set, get) => ({
  index: null,
  source: null,
  loading: false,
  error: null,
  filters: DEFAULT_FILTERS,
  installed: {},
  busy: {},
  auth: { status: "signedOut" },
  pendingImport: null,
  pendingImportError: null,

  async refresh(opts = {}) {
    if (get().loading) return;
    set({ loading: true });
    try {
      // 1. Cached copy (fast, offline).
      if (!get().index) {
        const cache = await loadJson<IndexCache>(STORAGE.indexCache);
        if (cache && isCatalogIndex(cache.index)) set({ index: cache.index, source: "cache", fetchedAt: cache.fetchedAt });
      }
      const { fetchedAt, source } = get();
      const fresh = source === "cache" && fetchedAt && Date.now() - Date.parse(fetchedAt) < CATALOG_MAX_AGE_MS;
      if (fresh && !opts.force) return;
      // 2. Network.
      try {
        const index = await fetchIndex();
        const now = new Date().toISOString();
        set({ index, source: "network", fetchedAt: now, error: null });
        await saveJson(STORAGE.indexCache, { index, fetchedAt: now } satisfies IndexCache);
      } catch (e) {
        const error = asCommunityError(e);
        // 3. Offline fallback: bundled index, else an index built from bundled files.
        if (!get().index) {
          const bundled = bundledIndex();
          if (bundled) set({ index: bundled, source: "bundled" });
          else set({ index: await runtimeIndex(), source: "runtime" });
        }
        set({ error });
      }
    } finally {
      set({ loading: false });
    }
  },

  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),
  findEntry: (kind, id) => get().index?.entries.find((e) => e.kind === kind && e.id === id),
  isInstalled: (kind, id) => itemKey(kind, id) in get().installed,
  hasUpdate: (kind, id) => isUpdateAvailable(get().installed[itemKey(kind, id)], get().findEntry(kind, id)),
  updates: () => (get().index?.entries ?? []).filter((e) => get().hasUpdate(e.kind, e.id)),

  async prepareInstall(entry) {
    const data = await downloadEntry(entry);
    const { preview, problems } = makePreview(entry.kind, data, { type: "catalog", ref: entry.path }, entry);
    if (!preview) throw new CommunityError("invalidContent", { details: problems, vars: { problems: problems.slice(0, 3).join("; ") } });
    return preview;
  },

  async install(preview, opts = {}) {
    if (preview.requiresConfirmation && !opts.confirmRisky) throw new CommunityError("needsConfirmation", { vars: { count: preview.risky.length } });
    const key = itemKey(preview.kind, preview.id);
    set({ busy: { ...get().busy, [key]: true } });
    try {
      const item = await writeInstalled(preview, !!opts.confirmRisky);
      const installed = { ...get().installed, [key]: item };
      set({ installed });
      await saveRegistry(installed);
      if (get().pendingImport?.kind === preview.kind && get().pendingImport?.id === preview.id) set({ pendingImport: null });
      return item;
    } finally {
      const { [key]: _done, ...busy } = get().busy;
      set({ busy });
    }
  },

  async installEntry(entry, opts) {
    return get().install(await get().prepareInstall(entry), opts);
  },

  async uninstall(kind, id) {
    const key = itemKey(kind, id);
    set({ busy: { ...get().busy, [key]: true } });
    try {
      await deleteInstalled(kind, id);
      const { [key]: _removed, ...installed } = get().installed;
      set({ installed });
      await saveRegistry(installed);
    } finally {
      const { [key]: _done, ...busy } = get().busy;
      set({ busy });
    }
  },

  readInstalled: (kind, id) => readInstalled(kind, id),

  importFrom: (input) => resolveImport(input, token()),

  async handleDeepLink(link) {
    set({ pendingImportError: null });
    try {
      const parsed = parseDeepLink(link);
      let preview: InstallPreview;
      if (!parsed) preview = await resolveImport(link, token()); // gist URL / id / https URL
      else if (parsed.action === "install") {
        if (!get().index) await get().refresh();
        let entry = get().findEntry(parsed.kind, parsed.id);
        if (!entry) {
          await get().refresh({ force: true });
          entry = get().findEntry(parsed.kind, parsed.id);
        }
        if (!entry) throw new CommunityError("notFound");
        preview = await get().prepareInstall(entry);
      } else preview = await resolveImport("gist" in parsed ? parsed.gist : parsed.url, token());
      set({ pendingImport: { ...preview, origin: { ...preview.origin, type: parsed?.action === "install" ? "catalog" : preview.origin.type } } });
    } catch (e) {
      set({ pendingImportError: asCommunityError(e) });
    }
    if (typeof window !== "undefined" && !window.location.hash.startsWith("#/community")) window.location.hash = "#/community";
  },

  clearPendingImport: () => set({ pendingImport: null, pendingImportError: null }),

  shareGist: (kind, data, opts) => shareGist(token(), kind, data, opts),

  async publish(req) {
    try {
      return await publishPullRequest(token(), req);
    } catch (e) {
      if (e instanceof CommunityError && e.code === "unauthorized") get().signOut();
      throw e;
    }
  },

  canUseDeviceFlow: () => !!clientId(),

  async signIn() {
    const id = clientId();
    if (!id) throw new CommunityError("noClientId");
    get().cancelSignIn();
    const code = await startDeviceFlow(id);
    set({ auth: { status: "pending", code } });
    const abort = (pollAbort = new AbortController());
    pollDeviceFlow(id, code, abort.signal)
      .then(async (accessToken) => {
        const user = await new GitHubClient(accessToken).user();
        setGithub({ token: accessToken, user: user.login });
        set({ auth: { status: "signedIn", login: user.login } });
      })
      .catch((e) => {
        if (abort.signal.aborted) return;
        set({ auth: { status: "signedOut", error: asCommunityError(e) } });
      })
      .finally(() => {
        if (pollAbort === abort) pollAbort = null;
      });
    return code;
  },

  cancelSignIn() {
    pollAbort?.abort();
    pollAbort = null;
    if (get().auth.status === "pending") set({ auth: { status: "signedOut" } });
  },

  async signInWithToken(raw) {
    const tok = raw.trim();
    if (!tok) throw new CommunityError("invalidInput");
    const user = await new GitHubClient(tok).user();
    setGithub({ token: tok, user: user.login });
    set({ auth: { status: "signedIn", login: user.login } });
  },

  signOut() {
    get().cancelSignIn();
    setGithub({ token: undefined, user: undefined });
    set({ auth: { status: "signedOut" } });
  },
}));

/** Filtered catalog for the current filters, reactive to connected devices and installs. */
export function useCatalogResults(): CatalogEntry[] {
  const index = useCommunity((s) => s.index);
  const filters = useCommunity((s) => s.filters);
  const installed = useCommunity((s) => s.installed);
  const devices = useDevices((s) => s.devices);
  return useMemo(
    () =>
      filterCatalog(index?.entries ?? [], filters, {
        connectedDefinitionIds: devices.map((d) => d.definition.id),
        installedKeys: new Set(Object.keys(installed)),
      }),
    [index, filters, installed, devices],
  );
}
