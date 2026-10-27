// Typing sparks — each key press throws coloured sparks onto its neighbours (reactive).
// Community effect for KeyHalo (MIT). API: docs/EFFECTS.md
export default {
  meta: {
    id: "typing-sparks",
    name: "Typing sparks",
    description: "Every key press throws coloured sparks onto nearby keys.",
    author: "KeyHalo",
    tags: ["reactive"],
    reactive: true,
    params: {
      hueShift: { type: "number", label: "Hue step per key", min: 0, max: 120, step: 1, default: 37 },
      radius: { type: "number", label: "Spark radius (keys)", min: 1, max: 5, step: 0.5, default: 2.5 },
      fade: { type: "number", label: "Fade (s)", min: 0.2, max: 2, step: 0.1, default: 0.8 },
    },
  },
  create(params) {
    const sparks = [];
    let hue = 0;
    return {
      onKey(e) {
        if (!e.down) return;
        hue = (hue + params.hueShift) % 360;
        sparks.push({ x: e.x, y: e.y, t: e.t, hue });
        if (sparks.length > 32) sparks.shift();
      },
      frame(ctx) {
        while (sparks.length && ctx.t - sparks[0].t > params.fade) sparks.shift();
        for (const k of ctx.region) {
          let out = [0, 0, 0];
          for (const s of sparks) {
            const age = (ctx.t - s.t) / params.fade;
            const d = Math.hypot(k.x - s.x, k.y - s.y);
            if (d > params.radius) continue;
            const c = ctx.hsv(s.hue + d * 20, 1, (1 - d / params.radius) * (1 - age));
            out = [Math.max(out[0], c[0]), Math.max(out[1], c[1]), Math.max(out[2], c[2])];
          }
          ctx.setAt(k.index, out);
        }
      },
    };
  },
};
