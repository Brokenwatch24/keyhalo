import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpRequest, HttpResponse } from "@/core/backend/api";
import type { CatalogEntry, ConnectedDevice, KeymapPack } from "../types";

// ---------------------------------------------------------------------------
// In-memory backend: storage + scripted HTTP routes.
// ---------------------------------------------------------------------------
const mem = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  routes: [] as { method: string; url: RegExp; reply: (req: HttpRequest) => HttpResponse | Promise<HttpResponse> }[],
  calls: [] as HttpRequest[],
}));

vi.mock("@/core/backend", () => {
  const backend = {
    kind: "tauri",
    async httpRequest(req: HttpRequest) {
      mem.calls.push(req);
      const r = mem.routes.find((x) => x.method === req.method && x.url.test(req.url));
      if (!r) throw new Error(`no route for ${req.method} ${req.url}`);
      return r.reply(req);
    },
    async storageRead(name: string) {
      return mem.storage.get(name) ?? null;
    },
    async storageWrite(name: string, contents: string) {
      mem.storage.set(name, contents);
    },
    async storageList(dir: string) {
      const prefix = `${dir.replace(/\/$/, "")}/`;
      return [...mem.storage.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
    async storageDelete(name: string) {
      mem.storage.delete(name);
    },
    async appVersion() {
      return "1.2.3";
    },
    async on() {
      return () => {};
    },
  };
  return { backend, isTauri: true };
});

const { useCommunity } = await import("./store");
const { bus } = await import("@/core/util/bus");
const { useSettings } = await import("@/core/state/settings");
const { checkContent, detectKind, riskyActions, effectMetaLite, makePreview, repoPathFor, slug } = await import("./content");
const { filterCatalog, scoreEntry, isCompatible, catalogTags, DEFAULT_FILTERS } = await import("./catalog");
const { parseDeepLink, installDeepLink, importParamFromLocation } = await import("./deeplinks");
const { deviceReportUrl, deviceRequestUrl } = await import("./reports");
const { parseImportInput, branchName, prBody } = await import("./publish");
const { errorFromResponse, toBase64, fromBase64 } = await import("./github");
const { CommunityError, communityErrorMessage } = await import("./errors");
const { reemitInstalled } = await import("./install");

const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status, headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const route = (method: string, url: RegExp, reply: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) => mem.routes.push({ method, url, reply });

const keymap = (over: Partial<KeymapPack> = {}): KeymapPack => ({
  id: "davinci-resolve",
  name: "DaVinci Resolve",
  apps: ["Resolve.exe"],
  categories: { Edit: "#ff4d6d" },
  legends: [{ keys: ["KeyB"], label: "Blade", category: "Edit" }],
  bindings: [{ key: "F13", action: { type: "key", keys: ["ControlLeft", "KeyB"] } }],
  ...over,
});

const profile = { id: "neon-focus", name: "Neon Focus", lighting: { layers: [{ id: "a", effect: "static", params: {}, blend: "normal", opacity: 1, enabled: true }], brightness: 1, fps: 30 } };

const entries: CatalogEntry[] = [
  { kind: "profile", id: "neon-focus", name: "Neon Focus", path: "community/profiles/neon-focus.json", tags: ["calm"], devices: ["huntsman-mini"], updated: "2026-10-01T00:00:00Z" },
  { kind: "profile", id: "rainbow", name: "Rainbow Wave", path: "community/profiles/rainbow.json", tags: ["calm", "rgb"], updated: "2026-10-20T00:00:00Z" },
  { kind: "keymap", id: "davinci-resolve", name: "DaVinci Resolve", description: "Editing shortcuts", path: "community/keymaps/davinci-resolve.json", apps: ["Resolve.exe"], updated: "2026-09-01T00:00:00Z" },
  { kind: "device", id: "deathadder-v2-pro", name: "Razer DeathAdder V2 Pro", path: "community/devices/razer/deathadder-v2-pro.json", devices: ["deathadder-v2-pro"], status: "verified" },
];

beforeEach(() => {
  mem.storage.clear();
  mem.routes.length = 0;
  mem.calls.length = 0;
  useCommunity.setState({ index: { generated: "", repo: "Brokenwatch24/keyhalo", entries }, installed: {}, busy: {}, pendingImport: null, pendingImportError: null, auth: { status: "signedOut" }, loading: false, source: "network" });
  useSettings.setState({ settings: { ...useSettings.getState().settings, language: "en", github: {} } });
});

// ---------------------------------------------------------------------------

describe("content checks", () => {
  it("accepts valid items and reports problems", () => {
    expect(checkContent("keymap", keymap())).toEqual([]);
    expect(checkContent("profile", profile)).toEqual([]);
    expect(checkContent("keymap", { ...keymap(), categories: { Edit: "red" } })).toContain("categories.Edit must be a #rrggbb colour");
    expect(checkContent("profile", { id: "../evil", name: "x", lighting: {} }).join()).toMatch(/id is missing or invalid/);
    expect(checkContent("device", { id: "x", name: "X", vendor: "R", type: "keyboard", driver: "razer", match: [{ vendorId: "1532", productId: "0x0257" }], capabilities: {}, size: { w: 1, h: 1 }, status: "community" })).toEqual([
      'match[0] needs hex vendorId/productId like "0x1532"',
    ]);
  });

  it("rejects effects with network or eval", () => {
    const ok = "const meta = { id: 'rain', name: 'Rain', params: {} };\nexport default { meta, create() { return { frame() {} }; } };";
    expect(checkContent("effect", ok)).toEqual([]);
    expect(checkContent("effect", ok.replace("frame() {}", "frame() { fetch('x') }"))).toContain("forbidden token `fetch`");
    expect(checkContent("effect", ok.replace("frame() {}", "frame() { new Function('x') }"))).toContain("forbidden token `Function(`");
    expect(effectMetaLite(ok)).toMatchObject({ id: "rain", name: "Rain" });
  });

  it("detects kinds", () => {
    expect(detectKind(keymap())).toBe("keymap");
    expect(detectKind(profile)).toBe("profile");
    expect(detectKind({ id: "x", name: "x", language: "en", kind: "words" })).toBe("typing");
    expect(detectKind({ match: [], driver: "razer" })).toBe("device");
    expect(detectKind("export default {}")).toBe("effect");
    expect(detectKind({}, "keyhalo-profile-x.json")).toBe("profile");
    expect(detectKind({ nothing: 1 })).toBeNull();
  });

  it("finds risky keymap actions, including nested tap-hold and layers", () => {
    const risky = riskyActions(
      keymap({
        bindings: [
          { key: "F13", action: { type: "launch", path: "calc.exe", args: ["/x"] } },
          { key: "F14", action: { type: "macro", steps: [{ op: "tap", key: "KeyA" }] } },
          { key: "F15", action: { type: "tapHold", tap: { type: "key", keys: ["Escape"] }, hold: { type: "text", text: "hello" } } },
        ],
        layers: [{ id: "fn", name: "Fn", bindings: [{ key: "KeyQ", action: { type: "macro", steps: [{ op: "text", text: "gg" }] } }] }],
      }),
    );
    expect(risky.map((r) => [r.type, r.where])).toEqual([
      ["launch", "bindings[0] F13"],
      ["text", "bindings[2] F15 (hold)"],
      ["macro", "layers[0].bindings[0] KeyQ"],
    ]);
    expect(risky[0].detail).toBe("calc.exe /x");
  });

  it("builds previews: keymaps with risky actions need confirmation, effects are sandboxed", () => {
    const k = makePreview("keymap", keymap({ bindings: [{ key: "F1", action: { type: "launch", path: "x.exe" } }] }), { type: "paste" }).preview!;
    expect(k.requiresConfirmation).toBe(true);
    const e = makePreview("effect", "const meta={id:'rain',name:'Rain'};export default { meta, create(){} }", { type: "paste" }).preview!;
    expect(e).toMatchObject({ id: "rain", sandboxed: true, requiresConfirmation: false });
  });

  it("computes repository paths", () => {
    expect(repoPathFor("device", "huntsman-mini", { vendor: "Razer" })).toBe("community/devices/razer/huntsman-mini.json");
    expect(repoPathFor("effect", "rain")).toBe("community/effects/rain.js");
    expect(slug("Ñandú Gaming, Inc.")).toBe("nandu-gaming-inc");
  });
});

describe("catalog search & filters", () => {
  it("scores names above other fields and requires every term", () => {
    expect(scoreEntry(entries[0], "neon")).toBeGreaterThan(scoreEntry(entries[2], "editing"));
    expect(scoreEntry(entries[0], "neon zzz")).toBe(0);
    expect(scoreEntry(entries[2], "resolve.exe")).toBeGreaterThan(0);
  });

  it("filters by kind, tags, app, compatibility and installed state", () => {
    const ids = (f: Partial<typeof DEFAULT_FILTERS>, ctx = {}) => filterCatalog(entries, { ...DEFAULT_FILTERS, ...f }, ctx).map((e) => e.id);
    expect(ids({ kinds: ["profile"] })).toEqual(["rainbow", "neon-focus"]);
    expect(ids({ tags: ["calm", "rgb"] })).toEqual(["rainbow"]);
    expect(ids({ app: "resolve.exe" })).toEqual(["davinci-resolve"]);
    expect(ids({ compatibleOnly: true }, { connectedDefinitionIds: ["deathadder-v2-pro"] })).toEqual(["rainbow", "davinci-resolve", "deathadder-v2-pro"]);
    expect(ids({ installed: "only" }, { installedKeys: new Set(["keymap:davinci-resolve"]) })).toEqual(["davinci-resolve"]);
    expect(ids({ sort: "name" })).toEqual(["davinci-resolve", "neon-focus", "rainbow", "deathadder-v2-pro"]);
  });

  it("knows device compatibility", () => {
    expect(isCompatible(entries[0], ["huntsman-mini"])).toBe(true);
    expect(isCompatible(entries[0], [])).toBe(false);
    expect(isCompatible(entries[1], [])).toBe(true);
  });

  it("counts tags", () => {
    expect(catalogTags(entries)[0]).toEqual({ tag: "calm", count: 2 });
  });
});

describe("deep links", () => {
  it("parses install and import links", () => {
    expect(parseDeepLink("keyhalo://install?kind=profile&id=neon-focus")).toEqual({ action: "install", kind: "profile", id: "neon-focus" });
    expect(parseDeepLink("keyhalo://import?gist=AABBCCDDEEFF00112233")).toEqual({ action: "import", gist: "aabbccddeeff00112233" });
    expect(parseDeepLink("keyhalo://import/?url=https%3A%2F%2Fexample.com%2Fa.json")).toEqual({ action: "import", url: "https://example.com/a.json" });
    expect(parseDeepLink("keyhalo://install?kind=virus&id=x")).toBeNull();
    expect(parseDeepLink("keyhalo://import?url=file:///c:/x")).toBeNull();
    expect(installDeepLink("keymap", "davinci-resolve")).toBe("keyhalo://install?kind=keymap&id=davinci-resolve");
  });

  it("reads ?import= from the page URL (search or hash)", () => {
    expect(importParamFromLocation({ search: "?import=keyhalo%3A%2F%2Fimport%3Fgist%3Dabc", hash: "" })).toBe("keyhalo://import?gist=abc");
    expect(importParamFromLocation({ search: "", hash: "#/community?import=abc" })).toBe("abc");
    expect(importParamFromLocation({ search: "", hash: "#/community" })).toBeNull();
  });

  it("classifies import inputs", () => {
    expect(parseImportInput("https://gist.github.com/someone/0123456789abcdef0123")).toEqual({ type: "gist", id: "0123456789abcdef0123" });
    expect(parseImportInput("0123456789abcdef0123")).toEqual({ type: "gist", id: "0123456789abcdef0123" });
    expect(parseImportInput("https://raw.githubusercontent.com/a/b/main/x.json")).toEqual({ type: "url", url: "https://raw.githubusercontent.com/a/b/main/x.json" });
    expect(parseImportInput('{"id":"x"}').type).toBe("paste");
    expect(parseImportInput("keyhalo://import?gist=0123456789abcdef0123")).toEqual({ type: "gist", id: "0123456789abcdef0123" });
    expect(() => parseImportInput("hello")).toThrow(CommunityError);
  });
});

describe("issue links", () => {
  const device: ConnectedDevice = {
    uid: "huntsman-mini:1",
    firmware: "1.12",
    layoutId: "ansi",
    desk: { x: 0, y: 0 },
    online: true,
    definition: {
      id: "huntsman-mini",
      name: "Razer Huntsman Mini",
      vendor: "Razer",
      type: "keyboard",
      match: [{ vendorId: "0x1532", productId: "0x0257" }],
      driver: "razer",
      capabilities: {},
      layouts: { ansi: { id: "ansi", name: "US ANSI", standard: "ansi", keys: [] } },
      size: { w: 15, h: 5 },
      status: "community",
    },
  };

  it("prefills the works-on-my-device form", () => {
    const url = new URL(deviceReportUrl(device, "1.0.0"));
    expect(url.pathname).toBe("/Brokenwatch24/keyhalo/issues/new");
    expect(url.searchParams.get("template")).toBe("works_on_my_device.yml");
    expect(url.searchParams.get("definition")).toBe("huntsman-mini");
    expect(url.searchParams.get("firmware")).toBe("1.12");
    expect(url.searchParams.get("layout")).toBe("ansi — US ANSI");
    expect(url.searchParams.get("app-version")).toBe("1.0.0");
    expect(url.searchParams.get("title")).toBe("[Works] Razer Huntsman Mini (fw 1.12)");
  });

  it("prefills the device request form", () => {
    const url = new URL(deviceRequestUrl([{ path: "p", vendorId: 0x1532, productId: 0x99, interfaceNumber: 2, usagePage: 0xff00, usage: 1, product: "Mystery", manufacturer: "Razer" }], "1.0.0"));
    expect(url.searchParams.get("template")).toBe("device_request.yml");
    expect(url.searchParams.get("vid-pid")).toBe("1532:0099");
    expect(url.searchParams.get("model")).toBe("Razer Mystery");
    expect(url.searchParams.get("interfaces")).toMatch(/interface 2 · usagePage 0xff00/);
  });
});

describe("GitHub helpers", () => {
  it("maps rate limits and auth errors to friendly messages", () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const e = errorFromResponse(json(403, { message: "API rate limit exceeded" }, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) }));
    expect(e.code).toBe("rateLimited");
    expect(communityErrorMessage(e)).toMatch(/Try again in about 10 min/);
    expect(errorFromResponse(json(401, { message: "Bad credentials" })).code).toBe("unauthorized");
    expect(errorFromResponse(json(422, { message: "Reference already exists" })).code).toBe("conflict");
  });

  it("base64-encodes UTF-8", () => {
    expect(fromBase64(toBase64("Ñandú ⌨️"))).toBe("Ñandú ⌨️");
  });

  it("names branches and writes PR bodies", () => {
    expect(branchName("profile", "neon-focus", new Date("2026-10-26T23:53:01.123Z"))).toBe("community/profile-neon-focus-20261026T235301");
    const preview = makePreview("keymap", keymap({ bindings: [{ key: "F1", action: { type: "launch", path: "x.exe" } }] }), { type: "paste" }).preview!;
    const body = prBody({ kind: "keymap", testedOn: ["Huntsman Mini"] }, preview, "community/keymaps/davinci-resolve.json");
    expect(body).toMatch(/## Devices tested\n\n- Huntsman Mini/);
    expect(body).toMatch(/`launch` at bindings\[0\] F1/);
    expect(body).toMatch(/- \[x\] I agree to license this contribution under the MIT License/);
  });
});

describe("useCommunity install flow", () => {
  it("installs from the catalog, emits on the bus and uninstalls", async () => {
    route("GET", /neon-focus\.json$/, () => json(200, profile));
    const installed = vi.fn();
    const removed = vi.fn();
    const off1 = bus.on("community:installed", installed);
    const off2 = bus.on("community:removed", removed);
    const item = await useCommunity.getState().installEntry(entries[0]);
    expect(item).toMatchObject({ kind: "profile", id: "neon-focus", updated: "2026-10-01T00:00:00Z" });
    expect(JSON.parse(mem.storage.get("installed/profile/neon-focus.json")!)).toMatchObject({ id: "neon-focus" });
    expect(installed).toHaveBeenCalledWith({ kind: "profile", id: "neon-focus", data: profile });
    expect(useCommunity.getState().isInstalled("profile", "neon-focus")).toBe(true);
    expect(JSON.parse(mem.storage.get("community/installed.json")!)["profile:neon-focus"]).toBeTruthy();

    // A newer catalog entry → update available.
    useCommunity.setState({ index: { generated: "", repo: "", entries: [{ ...entries[0], updated: "2026-10-25T00:00:00Z" }] } });
    expect(useCommunity.getState().hasUpdate("profile", "neon-focus")).toBe(true);
    expect(useCommunity.getState().updates().map((e) => e.id)).toEqual(["neon-focus"]);

    await useCommunity.getState().uninstall("profile", "neon-focus");
    expect(mem.storage.has("installed/profile/neon-focus.json")).toBe(false);
    expect(removed).toHaveBeenCalledWith({ kind: "profile", id: "neon-focus" });
    off1();
    off2();
  });

  it("requires explicit confirmation for risky keymaps", async () => {
    route("GET", /davinci-resolve\.json$/, () => json(200, keymap({ bindings: [{ key: "F13", action: { type: "launch", path: "calc.exe" } }] })));
    const preview = await useCommunity.getState().prepareInstall(entries[2]);
    expect(preview.risky).toHaveLength(1);
    await expect(useCommunity.getState().install(preview)).rejects.toMatchObject({ code: "needsConfirmation" });
    expect(mem.storage.has("installed/keymap/davinci-resolve.json")).toBe(false);
    const item = await useCommunity.getState().install(preview, { confirmRisky: true });
    expect(item.confirmedRisky).toBe(true);
  });

  it("rejects invalid downloads with details", async () => {
    route("GET", /neon-focus\.json$/, () => json(200, { id: "neon-focus", name: "x" }));
    await expect(useCommunity.getState().prepareInstall(entries[0])).rejects.toMatchObject({ code: "invalidContent" });
  });

  it("re-emits installed items on startup and adopts unknown files", async () => {
    mem.storage.set("installed/profile/neon-focus.json", JSON.stringify(profile));
    mem.storage.set("installed/effect/rain.js", "const meta={id:'rain',name:'Rain'};export default { meta, create(){} }");
    mem.storage.set("installed/keymap/broken.json", "{");
    const seen: string[] = [];
    const off = bus.on("community:installed", (e) => seen.push(`${e.kind}:${e.id}`));
    const reg = await reemitInstalled({});
    off();
    expect(seen.sort()).toEqual(["effect:rain", "profile:neon-focus"]);
    expect(reg["effect:rain"].name).toBe("Rain");
  });

  it("falls back to the runtime/bundled index when offline", async () => {
    useCommunity.setState({ index: null, source: null });
    route("GET", /index\.json/, () => {
      throw new Error("offline");
    });
    await useCommunity.getState().refresh({ force: true });
    const s = useCommunity.getState();
    expect(s.error?.code).toMatch(/network|offline/);
    expect(s.source === "bundled" || s.source === "runtime").toBe(true);
    expect(Array.isArray(s.index?.entries)).toBe(true);
  });

  it("downloads and caches the index", async () => {
    useCommunity.setState({ index: null, source: null });
    route("GET", /community\/index\.json/, () => json(200, { generated: "2026-10-26T00:00:00Z", repo: "Brokenwatch24/keyhalo", entries: [...entries, { kind: "nope", id: "x", name: "x", path: "x" }] }));
    await useCommunity.getState().refresh({ force: true });
    expect(useCommunity.getState().source).toBe("network");
    expect(useCommunity.getState().index?.entries).toHaveLength(4);
    expect(mem.storage.has("community/index-cache.json")).toBe(true);
  });

  it("imports from a gist via a deep link into pendingImport", async () => {
    route("GET", /api\.github\.com\/gists\/0123456789abcdef0123$/, () => json(200, { files: { "keyhalo-profile-neon-focus.json": { filename: "keyhalo-profile-neon-focus.json", content: JSON.stringify(profile) } } }));
    await useCommunity.getState().handleDeepLink("keyhalo://import?gist=0123456789abcdef0123");
    expect(useCommunity.getState().pendingImportError).toBeNull();
    expect(useCommunity.getState().pendingImport).toMatchObject({ kind: "profile", id: "neon-focus", origin: { type: "gist" } });
  });
});

describe("GitHub auth & publishing", () => {
  it("signs in with a token and signs out", async () => {
    route("GET", /api\.github\.com\/user$/, (req) => (req.headers?.Authorization === "Bearer good" ? json(200, { login: "octo" }) : json(401, { message: "Bad credentials" })));
    await expect(useCommunity.getState().signInWithToken("bad")).rejects.toMatchObject({ code: "unauthorized" });
    await useCommunity.getState().signInWithToken(" good ");
    expect(useCommunity.getState().auth).toEqual({ status: "signedIn", login: "octo" });
    expect(useSettings.getState().settings.github).toMatchObject({ token: "good", user: "octo" });
    useCommunity.getState().signOut();
    expect(useSettings.getState().settings.github.token).toBeUndefined();
  });

  it("runs the OAuth device flow", async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, github: { clientId: "Iv1.test" } } });
    route("POST", /login\/device\/code$/, (req) => {
      expect(req.body).toBe("client_id=Iv1.test&scope=public_repo%20gist");
      return json(200, { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 });
    });
    let polls = 0;
    route("POST", /login\/oauth\/access_token$/, () => json(200, ++polls < 2 ? { error: "authorization_pending" } : { access_token: "tok" }));
    route("GET", /api\.github\.com\/user$/, () => json(200, { login: "octo" }));
    const code = await useCommunity.getState().signIn();
    expect(code.userCode).toBe("ABCD-1234");
    expect(useCommunity.getState().auth.status).toBe("pending");
    await vi.waitFor(() => expect(useCommunity.getState().auth).toEqual({ status: "signedIn", login: "octo" }));
    expect(useSettings.getState().settings.github.token).toBe("tok");
  });

  it("refuses device flow without a client id", async () => {
    await expect(useCommunity.getState().signIn()).rejects.toMatchObject({ code: "noClientId" });
  });

  it("publishes via fork + branch + commit + PR", async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, github: { token: "tok", user: "octo" } } });
    const api = "https://api.github.com";
    route("GET", new RegExp(`${api}/user$`), () => json(200, { login: "octo" }));
    route("GET", new RegExp(`${api}/repos/Brokenwatch24/keyhalo$`), () => json(200, { full_name: "Brokenwatch24/keyhalo", default_branch: "main", owner: { login: "Brokenwatch24" } }));
    route("POST", /\/repos\/Brokenwatch24\/keyhalo\/forks$/, () => json(202, { full_name: "octo/keyhalo", default_branch: "main", owner: { login: "octo" } }));
    route("GET", /\/repos\/octo\/keyhalo\/branches\/main$/, () => json(200, { name: "main" }));
    route("GET", /\/repos\/Brokenwatch24\/keyhalo\/git\/ref\/heads\/main$/, () => json(200, { object: { sha: "abc123" } }));
    route("POST", /\/repos\/octo\/keyhalo\/git\/refs$/, (req) => {
      expect(JSON.parse(req.body!)).toMatchObject({ sha: "abc123", ref: expect.stringMatching(/^refs\/heads\/community\/profile-neon-focus-\d{8}T\d{6}$/) });
      return json(201, {});
    });
    route("GET", /\/contents\//, () => json(404, { message: "Not Found" }));
    const puts: { url: string; body: { content: string; branch: string; message: string } }[] = [];
    route("PUT", /\/repos\/octo\/keyhalo\/contents\//, (req) => {
      puts.push({ url: req.url, body: JSON.parse(req.body!) });
      return json(201, {});
    });
    route("POST", /\/repos\/Brokenwatch24\/keyhalo\/pulls$/, (req) => {
      const b = JSON.parse(req.body!);
      expect(b.head).toMatch(/^octo:community\/profile-neon-focus-/);
      expect(b.base).toBe("main");
      expect(b.title).toBe("community(profile): add Neon Focus");
      return json(201, { html_url: "https://github.com/Brokenwatch24/keyhalo/pull/7", number: 7 });
    });
    const steps: string[] = [];
    const res = await useCommunity.getState().publish({ kind: "profile", data: profile, previewDataUrl: "data:image/png;base64,iVBORw0KGgo=", testedOn: ["Huntsman Mini"], onProgress: (s) => steps.push(s) });
    expect(res.prUrl).toBe("https://github.com/Brokenwatch24/keyhalo/pull/7");
    expect(steps).toEqual(["fork", "branch", "commit", "pr"]);
    expect(puts.map((p) => p.url.split("/contents/")[1])).toEqual(["community/profiles/neon-focus.json", "community/profiles/neon-focus.png"]);
    expect(JSON.parse(fromBase64(puts[0].body.content))).toMatchObject({ $schema: "../schemas/profile.schema.json", id: "neon-focus" });
  });

  it("shares a gist and returns a deep link", async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, github: { token: "tok" } } });
    route("POST", /api\.github\.com\/gists$/, (req) => {
      expect(Object.keys(JSON.parse(req.body!).files)).toEqual(["keyhalo-profile-neon-focus.json"]);
      return json(201, { id: "0123456789abcdef0123", html_url: "https://gist.github.com/octo/0123456789abcdef0123", files: {} });
    });
    const res = await useCommunity.getState().shareGist("profile", profile);
    expect(res.deepLink).toBe("keyhalo://import?gist=0123456789abcdef0123");
  });

  it("needs sign-in to publish", async () => {
    await expect(useCommunity.getState().publish({ kind: "profile", data: profile })).rejects.toMatchObject({ code: "notSignedIn" });
  });
});
