// Neon scanner — a glowing bar sweeping back and forth with a soft falloff.
// Community effect for KeyHalo (MIT). API: docs/EFFECTS.md
export default {
  meta: {
    id: "neon-scanner",
    name: "Neon scanner",
    description: "A glowing bar that sweeps left and right across the whole desk.",
    author: "KeyHalo",
    tags: ["retro", "vivid"],
    params: {
      color: { type: "color", label: "Color", default: "#ff0040" },
      period: { type: "number", label: "Sweep time (s)", min: 0.8, max: 8, step: 0.1, default: 2.4 },
      width: { type: "number", label: "Bar width (keys)", min: 0.5, max: 6, step: 0.5, default: 2 },
      background: { type: "color", label: "Background", default: "#08000a" },
    },
  },
  create(params) {
    return {
      frame(ctx) {
        const c = ctx.hex(params.color);
        const bg = ctx.hex(params.background);
        // Eased position: 0 → width → 0 over one period.
        const phase = (Math.sin((ctx.t / params.period) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
        const x = phase * ctx.width;
        for (const k of ctx.region) {
          const d = Math.abs(k.x - x) / params.width;
          ctx.setAt(k.index, ctx.mix(bg, c, Math.exp(-d * d * 2)));
        }
      },
    };
  },
};
