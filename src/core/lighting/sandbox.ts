import type { EffectMeta, RGB } from "@/core/types";
import type { EffectContext, EffectInstance, KeyEventInfo, SceneKey } from "./api";

/**
 * Sandbox for community effects. Each effect instance runs in its own Web Worker created from
 * a Blob URL. Before the effect's source is evaluated the runtime removes network and code
 * loading APIs (fetch, XMLHttpRequest, importScripts, WebSocket, EventSource, nested workers,
 * storage) from the worker global *and* shadows them as parameters of the effect function.
 * Sources with `import` statements / `import()` / `require()` are rejected.
 *
 * The host sends geometry once, then a small context per frame; the worker answers with colour
 * and alpha buffers. Frames over budget, exceptions and stalls disable the effect.
 */

export const FRAME_BUDGET_MS = 8;
export const MAX_ERRORS = 5;
export const MAX_SLOW_FRAMES = 60;
export const STALL_MS = 1500;

export const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "importScripts",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
  "navigator",
  "location",
  "postMessage",
  "close",
  "self",
  "globalThis",
  "WebTransport",
  "RTCPeerConnection",
];

const FORBIDDEN = /\bimport\s*\(|^\s*import\s[\s\S]*?from\s|^\s*import\s*["']|\brequire\s*\(/m;

/** Static checks; returns an error message or null. */
export function checkSource(source: string): string | null {
  if (source.length > 200_000) return "Effect source is too large (max 200 kB)";
  if (FORBIDDEN.test(source)) return "Community effects must be self-contained: import/require are not allowed";
  if (!/\bexport\s+default\b/.test(source)) return "Effect must `export default { meta, create }`";
  return null;
}

// ---------------------------------------------------------------------------
// Worker runtime. Serialised with Function.prototype.toString, so it must be fully
// self-contained (no imports, no closures over module scope).
// ---------------------------------------------------------------------------

export function sandboxRuntime(scope: {
  postMessage: (m: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: { data: unknown }) => void) | null;
}, blocked: string[], budgetMs: number) {
  const post = scope.postMessage.bind(scope);
  // 1. Remove dangerous globals from the worker scope.
  for (const name of blocked) {
    if (name === "postMessage" || name === "self" || name === "globalThis") continue;
    try {
      Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
    } catch {
      try {
        (scope as unknown as Record<string, unknown>)[name] = undefined;
      } catch {
        /* ignore */
      }
    }
  }

  // 2. Helpers (duplicated from color.ts / noise.ts because the worker cannot import).
  const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const hsv = (h: number, s = 1, v = 1) => {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    const r = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r[0] + m) * 255, (r[1] + m) * 255, (r[2] + m) * 255];
  };
  const mix = (a: number[], b: number[], t: number) => {
    t = clamp(t);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const hex = (c: unknown) => {
    if (Array.isArray(c)) return [c[0] || 0, c[1] || 0, c[2] || 0];
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ""));
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const perm = new Uint8Array(512);
  {
    let s = 1337;
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h: number, x: number, y: number) => {
    const g = h & 7;
    return g === 0 ? x + y : g === 1 ? -x + y : g === 2 ? x - y : g === 3 ? -x - y : g === 4 ? x : g === 5 ? -x : g === 6 ? y : -y;
  };
  const noise2D = (x: number, y: number) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.7071;
  };
  let status: Record<string, number[]> = { good: [40, 220, 90], warn: [255, 170, 0], bad: [255, 40, 30], info: [40, 140, 255] };

  // 3. State.
  type Mod = { meta: { id: string; params?: Record<string, { default?: unknown }> }; create: (p: unknown) => { frame: (c: unknown) => void; onKey?: (e: unknown) => void } };
  let mod: Mod | null = null;
  let inst: ReturnType<Mod["create"]> | null = null;
  let keys: { id: string; index: number }[] = [];
  let region: unknown[] = [];
  const byId = new Map<string, number[]>();
  let rgb = new Float32Array(0);
  let alpha = new Float32Array(0);

  const compile = (source: string): Mod => {
    const body = source.replace(/\bexport\s+default\b/, "__module.exports =");
    // Shadow the blocked globals inside the effect's scope as well.
    const params = ["__module", ...blocked.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))];
    const fn = new Function(...params, `"use strict";\n${body}\n;return __module.exports;`);
    const holder: { exports: unknown } = { exports: undefined };
    const result = fn(holder, ...params.slice(1).map(() => undefined)) as Mod;
    if (!result || typeof result.create !== "function" || !result.meta || typeof result.meta.id !== "string") {
      throw new Error("Effect must export default { meta: { id, name, params }, create(params) }");
    }
    return result;
  };

  const ctxBase = {
    hsv,
    mix,
    hex,
    noise2D,
    clamp,
    lerp,
    statusColor: (k: string) => (status[k] || status.info).slice(),
    set(id: string, c: number[], a = 1) {
      const list = byId.get(id);
      if (list) for (const i of list) ctxBase.setAt(i, c, a);
    },
    setAt(i: number, c: number[], a = 1) {
      if (i < 0 || i >= alpha.length) return;
      rgb[i * 3] = c[0];
      rgb[i * 3 + 1] = c[1];
      rgb[i * 3 + 2] = c[2];
      alpha[i] = clamp(a);
    },
    fill(c: number[], a = 1) {
      for (const k of region as { index: number }[]) ctxBase.setAt(k.index, c, a);
    },
  };

  scope.onmessage = (e: { data: unknown }) => {
    const m = e.data as Record<string, unknown>;
    try {
      switch (m.type) {
        case "load": {
          mod = compile(String(m.source));
          post({ type: "meta", meta: mod.meta });
          break;
        }
        case "create": {
          if (!mod) throw new Error("not loaded");
          inst = mod.create(m.params || {});
          if (!inst || typeof inst.frame !== "function") throw new Error("create() must return { frame(ctx) }");
          post({ type: "ready" });
          break;
        }
        case "geometry": {
          keys = m.keys as typeof keys;
          region = (m.region as number[]).map((i) => keys[i]);
          byId.clear();
          for (const k of keys) {
            const l = byId.get(k.id);
            if (l) l.push(k.index);
            else byId.set(k.id, [k.index]);
          }
          if (m.status) status = m.status as typeof status;
          break;
        }
        case "key":
          inst?.onKey?.(m.event);
          break;
        case "frame": {
          if (!inst) break;
          const n = keys.length;
          rgb = new Float32Array(n * 3);
          alpha = new Float32Array(n);
          const f = m.ctx as Record<string, unknown>;
          const ctx = Object.assign(Object.create(ctxBase), f, {
            keys,
            region,
            pressed: new Set(f.pressed as string[]),
          });
          const t0 = Date.now();
          inst.frame(ctx);
          const ms = Date.now() - t0;
          post({ type: "frame", seq: m.seq, rgb, alpha, ms, over: ms > budgetMs }, [rgb.buffer, alpha.buffer]);
          break;
        }
      }
    } catch (err) {
      post({ type: "error", stage: m.type, message: err instanceof Error ? err.message : String(err) });
    }
  };
}

const workerSource = () =>
  `(${sandboxRuntime.toString()})(self, ${JSON.stringify(BLOCKED_GLOBALS)}, ${FRAME_BUDGET_MS});`;

let blobUrl: string | null = null;
function createWorker(): Worker {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") throw new Error("Web Workers are not available");
  if (!blobUrl) blobUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
  return new Worker(blobUrl);
}

/** Load a community effect's metadata inside a throwaway sandbox. */
export function loadSandboxedMeta(source: string, timeoutMs = 3000): Promise<EffectMeta> {
  const bad = checkSource(source);
  if (bad) return Promise.reject(new Error(bad));
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = createWorker();
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error("Effect took too long to load"));
    }, timeoutMs);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      const m = e.data as { type: string; meta?: EffectMeta; message?: string };
      if (m.type === "meta" && m.meta) resolve({ ...m.meta, params: m.meta.params ?? {}, source: "community" });
      else reject(new Error(m.message ?? "Effect failed to load"));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      reject(new Error(e.message || "Effect failed to load"));
    };
    w.postMessage({ type: "load", source });
  });
}

/** Signals → plain data for postMessage. */
function plainSignals(s: EffectContext["signals"]) {
  return JSON.parse(JSON.stringify(s)) as unknown;
}

/** An effect instance whose code runs in a sandboxed worker (one frame of latency). */
export class SandboxInstance implements EffectInstance {
  private worker: Worker | null;
  private keysRef: SceneKey[] | null = null;
  private regionRef: SceneKey[] | null = null;
  private latest: { rgb: Float32Array; alpha: Float32Array } | null = null;
  private inflight: { seq: number; at: number } | null = null;
  private seq = 0;
  private errors = 0;
  private slow = 0;
  private waiters: (() => void)[] = [];
  disabled: string | null = null;

  constructor(
    source: string,
    params: Record<string, unknown>,
    private onDisable: (reason: string) => void,
    private statusPalette: () => Record<string, RGB>,
  ) {
    this.worker = createWorker();
    this.worker.onmessage = (e) => this.onMessage(e.data as Record<string, unknown>);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.fail(e.message || "worker error");
    };
    this.worker.postMessage({ type: "load", source });
    this.worker.postMessage({ type: "create", params });
  }

  private onMessage(m: Record<string, unknown>) {
    if (m.type === "frame") {
      this.inflight = null;
      this.latest = { rgb: m.rgb as Float32Array, alpha: m.alpha as Float32Array };
      if (m.over) {
        if (++this.slow > MAX_SLOW_FRAMES) this.fail(`over the ${FRAME_BUDGET_MS} ms frame budget`);
      } else this.slow = Math.max(0, this.slow - 1);
      this.waiters.splice(0).forEach((r) => r());
    } else if (m.type === "error") {
      this.inflight = null;
      this.waiters.splice(0).forEach((r) => r());
      if (m.stage === "load" || m.stage === "create" || ++this.errors >= MAX_ERRORS) this.fail(String(m.message));
    }
  }

  private fail(reason: string) {
    if (this.disabled) return;
    this.disabled = reason;
    this.dispose();
    this.onDisable(reason);
  }

  frame(ctx: EffectContext) {
    if (!this.worker) return;
    if (this.inflight && Date.now() - this.inflight.at > STALL_MS) {
      this.fail("stopped responding");
      return;
    }
    if (ctx.keys !== this.keysRef || ctx.region !== this.regionRef) {
      this.keysRef = ctx.keys;
      this.regionRef = ctx.region;
      this.latest = null;
      this.worker.postMessage({
        type: "geometry",
        keys: ctx.keys,
        region: ctx.region.map((k) => k.index),
        status: this.statusPalette(),
      });
    }
    const l = this.latest;
    if (l && l.alpha.length === ctx.keys.length) {
      for (let i = 0; i < l.alpha.length; i++) {
        if (l.alpha[i] > 0) ctx.setAt(i, [l.rgb[i * 3], l.rgb[i * 3 + 1], l.rgb[i * 3 + 2]], l.alpha[i]);
      }
    }
    if (!this.inflight) {
      this.inflight = { seq: ++this.seq, at: Date.now() };
      this.worker.postMessage({
        type: "frame",
        seq: this.seq,
        ctx: {
          t: ctx.t,
          dt: ctx.dt,
          width: ctx.width,
          height: ctx.height,
          masked: ctx.masked,
          params: ctx.params,
          pressed: [...ctx.pressed],
          events: ctx.events,
          signals: plainSignals(ctx.signals),
        },
      });
    }
  }

  onKey(event: KeyEventInfo) {
    this.worker?.postMessage({ type: "key", event });
  }

  flush(): Promise<void> {
    if (!this.worker || !this.inflight) return Promise.resolve();
    return new Promise((r) => {
      this.waiters.push(r);
      setTimeout(r, 500);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.waiters.splice(0).forEach((r) => r());
  }
}
