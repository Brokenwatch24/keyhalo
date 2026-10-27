import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, devicesMarkdownTable, replaceBetweenMarkers, schemaValidator } from "./lib/community.mjs";
import { run } from "./build-index.mjs";
import { device, effectSource, keymap, makeRoot, profile, typing } from "./test-utils.mjs";

let env;
afterEach(() => {
  env?.cleanup();
  vi.restoreAllMocks();
});

const fixtures = () => ({
  "community/devices/razer/huntsman-mini.json": device(),
  "community/profiles/neon-focus.json": profile(),
  "community/profiles/neon-focus.png": "png",
  "community/keymaps/davinci-resolve.json": keymap({ bindings: [{ key: "F13", action: { type: "text", text: "hi" } }] }),
  "community/typing/es-common-words.json": typing(),
  "community/effects/rain.js": effectSource({ tags: ["weather"], reactive: true }),
  "community/profiles/broken.json": "{ not json",
});

describe("buildIndex", () => {
  it("creates one entry per item with kind-specific fields", () => {
    env = makeRoot(fixtures());
    const { index, skipped } = buildIndex({ root: env.root });
    expect(index.repo).toBe("Brokenwatch24/keyhalo");
    expect(index.entries.map((e) => `${e.kind}:${e.id}`)).toEqual([
      "device:huntsman-mini",
      "profile:neon-focus",
      "keymap:davinci-resolve",
      "effect:rain",
      "typing:es-common-words",
    ]);
    expect(skipped.map((s) => s.rel)).toEqual(["community/profiles/broken.json"]);

    const byId = Object.fromEntries(index.entries.map((e) => [e.id, e]));
    expect(byId["huntsman-mini"]).toMatchObject({ status: "verified", devices: ["huntsman-mini"], path: "community/devices/razer/huntsman-mini.json", author: "Brokenwatch24" });
    expect(byId["huntsman-mini"].tags).toEqual(expect.arrayContaining(["razer", "keyboard"]));
    expect(byId["neon-focus"]).toMatchObject({ preview: "community/profiles/neon-focus.png", devices: ["huntsman-mini"], author: "keyhalo" });
    expect(byId["davinci-resolve"]).toMatchObject({ apps: ["Resolve.exe"] });
    expect(byId["davinci-resolve"].tags).toContain("macros");
    expect(byId.rain.tags).toEqual(expect.arrayContaining(["weather", "reactive"]));
    expect(byId["es-common-words"].tags).toEqual(expect.arrayContaining(["es", "words"]));
    for (const e of index.entries) expect(Date.parse(e.updated)).not.toBeNaN();
  });

  it("produces an index that satisfies catalog.schema.json", () => {
    env = makeRoot(fixtures());
    const { index } = buildIndex({ root: env.root });
    const validate = schemaValidator("catalog.schema.json", env.root);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  it("is deterministic: generated = newest entry date", () => {
    env = makeRoot(fixtures());
    const a = buildIndex({ root: env.root }).index;
    const b = buildIndex({ root: env.root }).index;
    expect(a).toEqual(b);
    expect(a.generated).toBe(a.entries.map((e) => e.updated).sort().at(-1));
  });
});

describe("README devices table", () => {
  it("renders a table and replaces the marker block", () => {
    env = makeRoot({ "community/devices/razer/huntsman-mini.json": device() });
    const table = devicesMarkdownTable(env.root);
    expect(table).toMatch(/\| Razer Huntsman Mini \| Keyboard \| Razer HID \| `1532:0257` \| ✅ Verified \|/);
    const text = "# x\n<!-- devices:start -->\nold\n<!-- devices:end -->\nrest";
    expect(replaceBetweenMarkers(text, "devices", "NEW")).toBe("# x\n<!-- devices:start -->\nNEW\n<!-- devices:end -->\nrest");
    expect(replaceBetweenMarkers("no markers", "devices", "NEW")).toBeNull();
  });

  it("run() writes index.json and refreshes README, and --check detects staleness", () => {
    env = makeRoot({
      "community/devices/razer/huntsman-mini.json": device(),
      "README.md": "<!-- devices:start -->\n<!-- devices:end -->\n",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(run(["--check"], env.root)).toBe(1);
    expect(run([], env.root)).toBe(0);
    expect(run(["--check"], env.root)).toBe(0);
    const index = JSON.parse(readFileSync(join(env.root, "community", "index.json"), "utf8"));
    expect(index.entries).toHaveLength(1);
    expect(readFileSync(join(env.root, "README.md"), "utf8")).toMatch(/Razer Huntsman Mini/);
  });
});
