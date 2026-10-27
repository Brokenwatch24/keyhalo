/** Test helpers: build a throw-away repo root with the real schemas and fixture content. */
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT } from "./lib/community.mjs";

export function makeRoot(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "keyhalo-community-"));
  cpSync(join(ROOT, "community", "schemas"), join(root, "community", "schemas"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const device = (over = {}) => ({
  $schema: "../../schemas/device.schema.json",
  id: "huntsman-mini",
  name: "Razer Huntsman Mini",
  vendor: "Razer",
  type: "keyboard",
  match: [{ vendorId: "0x1532", productId: "0x0257", interface: 2 }],
  driver: "razer",
  capabilities: { perKeyRgb: true, brightness: true, hardwareEffects: ["static", "spectrum"] },
  layouts: {
    ansi: {
      id: "ansi",
      name: "US ANSI",
      standard: "ansi",
      keys: [
        { code: "Escape", label: "Esc", x: 0, y: 0, led: [0, 1] },
        { code: "KeyQ", label: "Q", x: 1, y: 1, led: [1, 2] },
      ],
      fnLayer: { Escape: "Backquote" },
    },
  },
  layoutDetection: { "0x01": "ansi" },
  defaultLayout: "ansi",
  size: { w: 15, h: 5 },
  status: "verified",
  testedBy: ["Brokenwatch24"],
  ...over,
});

export const profile = (over = {}) => ({
  $schema: "../schemas/profile.schema.json",
  id: "neon-focus",
  name: "Neon Focus",
  description: "Calm cyan with a reactive ripple.",
  author: "keyhalo",
  tags: ["calm"],
  devices: ["huntsman-mini"],
  lighting: {
    brightness: 0.8,
    fps: 30,
    layers: [{ id: "base", effect: "static", params: { color: "#00e5ff" }, blend: "normal", opacity: 1, enabled: true }],
  },
  ...over,
});

export const keymap = (over = {}) => ({
  $schema: "../schemas/keymap.schema.json",
  id: "davinci-resolve",
  name: "DaVinci Resolve",
  apps: ["Resolve.exe"],
  categories: { Edit: "#ff4d6d", Playback: "#3ddc97" },
  legends: [{ keys: ["KeyB"], label: "Blade", category: "Edit" }],
  bindings: [{ key: "F13", action: { type: "key", keys: ["ControlLeft", "KeyB"] }, category: "Edit" }],
  ...over,
});

export const typing = (over = {}) => ({
  $schema: "../schemas/typing.schema.json",
  id: "es-common-words",
  name: "Spanish — common words",
  language: "es",
  kind: "words",
  words: Array.from({ length: 60 }, (_, i) => `palabra${i}`),
  ...over,
});

export const effectSource = (meta = {}, body = "return { frame(ctx) { ctx.fill?.('#000000'); } };") => `
const meta = ${JSON.stringify({ id: "rain", name: "Rain", author: "keyhalo", params: { speed: { type: "number", label: "Speed", min: 1, max: 10, default: 4 } }, ...meta })};
// fetch() is mentioned in a comment and must not be flagged
export default {
  meta,
  create(params) {
    ${body}
  },
};
`;
