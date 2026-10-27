// Breathing duo — two colours breathing in opposite phase on the left and right halves.
// Community effect for KeyHalo (MIT). API: docs/EFFECTS.md
export default {
  meta: {
    id: "breathing-duo",
    name: "Breathing duo",
    description: "Left and right halves breathe in opposite phase with two colours.",
    author: "KeyHalo",
    tags: ["ambient", "calm"],
    params: {
      left: { type: "color", label: "Left", default: "#00e5ff" },
      right: { type: "color", label: "Right", default: "#ff2bd6" },
      period: { type: "number", label: "Breath (s)", min: 2, max: 12, step: 0.5, default: 5 },
      blend: { type: "number", label: "Middle blend (keys)", min: 0, max: 6, step: 0.5, default: 3 },
    },
  },
  create(params) {
    return {
      frame(ctx) {
        const a = ctx.hex(params.left);
        const b = ctx.hex(params.right);
        const s = Math.sin((ctx.t / params.period) * Math.PI * 2);
        const va = 0.15 + 0.85 * (0.5 + 0.5 * s);
        const vb = 0.15 + 0.85 * (0.5 - 0.5 * s);
        const ca = [a[0] * va, a[1] * va, a[2] * va];
        const cb = [b[0] * vb, b[1] * vb, b[2] * vb];
        const mid = ctx.width / 2;
        for (const k of ctx.region) {
          const m = params.blend > 0 ? ctx.clamp((k.x - mid) / params.blend + 0.5) : k.x < mid ? 0 : 1;
          ctx.setAt(k.index, ctx.mix(ca, cb, m));
        }
      },
    };
  },
};
