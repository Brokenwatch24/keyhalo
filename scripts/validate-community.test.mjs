import { afterEach, describe, expect, it } from "vitest";
import { validateCommunity, extractEffectModule, riskyActionsOf } from "./lib/community.mjs";
import { formatMarkdown, parseArgs } from "./validate-community.mjs";
import { device, effectSource, keymap, makeRoot, profile, typing } from "./test-utils.mjs";

let env;
afterEach(() => env?.cleanup());

const resultFor = (report, rel) => report.results.find((r) => r.rel === rel);

describe("validateCommunity", () => {
  it("accepts valid content of every kind", () => {
    env = makeRoot({
      "community/devices/razer/huntsman-mini.json": device(),
      "community/profiles/neon-focus.json": profile(),
      "community/keymaps/davinci-resolve.json": keymap(),
      "community/typing/es-common-words.json": typing(),
      "community/effects/rain.js": effectSource(),
    });
    const report = validateCommunity({ root: env.root });
    expect(report.results).toHaveLength(5);
    for (const r of report.results) expect(r.errors, r.rel).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports schema errors with readable messages", () => {
    env = makeRoot({
      "community/devices/razer/huntsman-mini.json": device({
        match: [{ vendorId: "1532", productId: "0x0257" }],
        layouts: { ansi: { id: "ansi", name: "US", standard: "ansi", keys: [{ code: "Kq", label: "Q", x: 0, y: 0 }] } },
        bogus: true,
      }),
    });
    const r = validateCommunity({ root: env.root }).results[0];
    expect(r.errors.join("\n")).toMatch(/vendorId must be a 4-digit hex string/);
    expect(r.errors.join("\n")).toMatch(/code is not a valid KeyboardEvent\.code/);
    expect(r.errors.join("\n")).toMatch(/unknown property "bogus"/);
  });

  it("requires file name == id and unique ids per kind", () => {
    env = makeRoot({
      "community/profiles/neon-focus.json": profile(),
      "community/profiles/other.json": profile(),
    });
    const report = validateCommunity({ root: env.root });
    const other = resultFor(report, "community/profiles/other.json");
    expect(other.errors.join("\n")).toMatch(/must match id "neon-focus"/);
    expect(other.errors.join("\n")).toMatch(/duplicate profile id "neon-focus"/);
    expect(report.ok).toBe(false);
  });

  it("accepts <vendor>-<file> ids for devices", () => {
    env = makeRoot({ "community/devices/razer/huntsman-mini.json": device({ id: "razer-huntsman-mini" }) });
    expect(validateCommunity({ root: env.root }).results[0].errors).toEqual([]);
  });

  it("checks device layout references", () => {
    env = makeRoot({ "community/devices/razer/huntsman-mini.json": device({ defaultLayout: "iso", layoutDetection: { "0x02": "jis" } }) });
    const r = validateCommunity({ root: env.root }).results[0];
    expect(r.errors).toContain('defaultLayout "iso" is not a key of layouts');
    expect(r.errors).toContain('layoutDetection["0x02"] points to unknown layout "jis"');
  });

  it("flags risky keymap actions as warnings, not errors", () => {
    env = makeRoot({
      "community/keymaps/davinci-resolve.json": keymap({
        bindings: [
          { key: "F13", action: { type: "launch", path: "C:/Windows/notepad.exe" } },
          { key: "F14", action: { type: "macro", steps: [{ op: "tap", key: "KeyA" }, { op: "text", text: "hello" }] } },
          { key: "F15", action: { type: "tapHold", tap: { type: "key", keys: ["Escape"] }, hold: { type: "text", text: "secret" } } },
          { key: "F16", action: { type: "macro", steps: [{ op: "tap", key: "KeyA" }] } },
        ],
      }),
    });
    const r = validateCommunity({ root: env.root }).results[0];
    expect(r.errors).toEqual([]);
    expect(r.risky.map((x) => x.type)).toEqual(["launch", "macro", "text"]);
    expect(r.warnings.filter((w) => w.startsWith("risky action"))).toHaveLength(3);
  });

  it("detects risky http actions too", () => {
    expect(riskyActionsOf({ bindings: [{ key: "F1", action: { type: "http", method: "POST", url: "https://x" } }] })[0].type).toBe("http");
  });

  it("rejects effects with forbidden tokens", () => {
    env = makeRoot({ "community/effects/rain.js": effectSource({}, "fetch('https://evil'); return { frame() {} };") });
    const r = validateCommunity({ root: env.root }).results[0];
    expect(r.errors.join("\n")).toMatch(/forbidden token `fetch`/);
  });

  it("rejects effects using eval or Function(", () => {
    env = makeRoot({
      "community/effects/a.js": effectSource({ id: "a" }, "eval('1'); return { frame() {} };"),
      "community/effects/b.js": effectSource({ id: "b" }, "new Function ('return 1'); return { frame() {} };"),
    });
    const report = validateCommunity({ root: env.root });
    expect(report.results.every((r) => r.errors.length > 0)).toBe(true);
  });

  it("validates effect meta and params", () => {
    env = makeRoot({
      "community/effects/rain.js": effectSource({ params: { speed: { type: "number", label: "Speed", min: 1, max: 10, default: 40 }, mode: { type: "select", label: "Mode", options: [{ value: "a", label: "A" }], default: "z" } } }),
    });
    const r = validateCommunity({ root: env.root }).results[0];
    expect(r.errors).toContain("params.speed: default 40 is outside 1..10");
    expect(r.errors).toContain('params.mode: default "z" is not one of the options');
  });

  it("times out runaway effect modules", () => {
    expect(() => extractEffectModule("while (true) {}\nexport default { meta: {}, create() {} };", { timeout: 50 })).toThrow(/timed out/i);
  });

  it("evaluates effects without host globals", () => {
    const mod = extractEffectModule("export const meta = { id: 'x', name: typeof process + '/' + typeof require, params: {} };\nexport default { meta, create() {} };");
    expect(mod.meta.name).toBe("undefined/undefined");
    expect(mod.hasCreate).toBe(true);
  });

  it("warns about unknown references in profiles", () => {
    env = makeRoot({ "community/profiles/neon-focus.json": profile({ devices: ["nope"], keymaps: ["missing"] }) });
    const r = validateCommunity({ root: env.root }).results[0];
    expect(r.errors).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/"nope" is not a known device/);
    expect(r.warnings.join("\n")).toMatch(/"missing" is not a known keymap/);
  });

  it("requires words for word packs and texts for other packs", () => {
    env = makeRoot({ "community/typing/q.json": typing({ id: "q", kind: "quotes", words: undefined }) });
    expect(validateCommunity({ root: env.root }).results[0].errors.join("\n")).toMatch(/texts/);
  });

  it("--changed mode validates only the given files but checks ids across the repo", () => {
    env = makeRoot({
      "community/profiles/neon-focus.json": profile(),
      "community/profiles/copy.json": profile({ id: "copy" }),
      "community/keymaps/davinci-resolve.json": keymap({ categories: { Edit: "red" } }),
      "community/index.json": "{}",
    });
    const report = validateCommunity({ root: env.root, only: ["community/profiles/copy.json", "community/index.json", "community/profiles/deleted.json"] });
    expect(report.results.map((r) => r.rel)).toEqual(["community/profiles/copy.json"]);
    expect(report.ok).toBe(true);
    expect(report.notes.map((n) => n.rel)).toEqual(["community/index.json"]);
  });

  it("renders a Markdown PR summary with the comment marker", () => {
    env = makeRoot({ "community/keymaps/davinci-resolve.json": keymap({ bindings: [{ key: "F13", action: { type: "launch", path: "calc.exe" } }] }) });
    const md = formatMarkdown(validateCommunity({ root: env.root }));
    expect(md.startsWith("<!-- keyhalo-community-validation -->")).toBe(true);
    expect(md).toMatch(/risky action \(launch\)/);
    expect(md).toMatch(/\[!IMPORTANT\]/);
  });
});

describe("parseArgs", () => {
  it("collects --changed files until the next flag", () => {
    expect(parseArgs(["--changed", "a.json", "b.js", "--summary-md", "out.md"])).toMatchObject({ changed: ["a.json", "b.js"], summaryMd: "out.md" });
  });
  it("splits whitespace-separated lists", () => {
    expect(parseArgs(["--changed", "a.json b.json"]).changed).toEqual(["a.json", "b.json"]);
  });
});
