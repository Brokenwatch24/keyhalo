// Matrix rain — green trails falling down each column of keys.
// Community effect for KeyHalo (MIT). API: docs/EFFECTS.md
export default {
  meta: {
    id: "matrix-rain",
    name: "Matrix rain",
    description: "Bright heads with fading green trails falling down the keyboard.",
    author: "KeyHalo",
    tags: ["ambient", "retro"],
    params: {
      color: { type: "color", label: "Color", default: "#00ff66" },
      speed: { type: "number", label: "Speed", min: 0.3, max: 3, step: 0.1, default: 1 },
      density: { type: "number", label: "Density", min: 0.1, max: 2, step: 0.1, default: 0.8 },
    },
  },
  create(params) {
    const drops = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    return {
      frame(ctx) {
        const base = ctx.hex(params.color);
        const head = ctx.mix(base, [255, 255, 255], 0.7);
        if (rand() < params.density * ctx.dt * ctx.width * 0.25) {
          drops.push({ x: Math.floor(rand() * ctx.width) + 0.5, y: -1, v: (3 + rand() * 4) * params.speed, len: 2 + rand() * 3 });
        }
        for (let i = drops.length - 1; i >= 0; i--) {
          drops[i].y += drops[i].v * ctx.dt;
          if (drops[i].y - drops[i].len > ctx.height + 1) drops.splice(i, 1);
        }
        for (const k of ctx.region) {
          let best = 0;
          let isHead = false;
          for (const d of drops) {
            if (Math.abs(d.x - k.x) > 0.55) continue;
            const behind = d.y - k.y;
            if (behind < -0.5 || behind > d.len) continue;
            const v = behind < 0.5 ? 1 : 1 - behind / d.len;
            if (v > best) {
              best = v;
              isHead = behind < 0.5;
            }
          }
          ctx.setAt(k.index, isHead ? head : ctx.mix([0, 6, 2], base, best));
        }
      },
    };
  },
};
