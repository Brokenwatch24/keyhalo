// Lava lamp — slow warm blobs rising and merging.
// Community effect for KeyHalo (MIT). API: docs/EFFECTS.md
export default {
  meta: {
    id: "lava-lamp",
    name: "Lava lamp",
    description: "Slow, warm blobs that rise, merge and split.",
    author: "KeyHalo",
    tags: ["ambient", "warm"],
    params: {
      colors: { type: "colors", label: "Colors (3)", default: ["#2a0018", "#ff2e63", "#ff9f1c"] },
      speed: { type: "number", label: "Speed", min: 0.1, max: 2, step: 0.05, default: 0.4 },
      scale: { type: "number", label: "Blob size", min: 0.05, max: 0.6, step: 0.01, default: 0.18 },
    },
  },
  create(params) {
    const stops = Array.isArray(params.colors) && params.colors.length >= 3 ? params.colors : ["#2a0018", "#ff2e63", "#ff9f1c"];
    return {
      frame(ctx) {
        const cs = stops.map((c) => ctx.hex(c));
        const t = ctx.t * params.speed;
        const s = params.scale;
        for (const k of ctx.region) {
          const n = ctx.noise2D(k.x * s, k.y * s * 1.6 + t) * 0.6 + ctx.noise2D(k.x * s * 2 + 7, k.y * s * 2 - t * 0.7) * 0.4;
          const v = ctx.clamp((n + 0.6) / 1.2);
          ctx.setAt(k.index, v < 0.5 ? ctx.mix(cs[0], cs[1], v * 2) : ctx.mix(cs[1], cs[2], (v - 0.5) * 2));
        }
      },
    };
  },
};
