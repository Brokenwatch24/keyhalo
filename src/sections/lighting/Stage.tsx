import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Cpu, Keyboard, Sun, Zap } from "lucide-react";
import { Button, KeyboardView, MouseView, Select, Slider } from "@/ui";
import { effectRegistry, engine, flash, useLighting, useLightingFrame } from "@/core/lighting";
import { setSoftwareMode, useDevices } from "@/core/devices";
import type { RGB } from "@/core/types";
import { useT } from "@/i18n";
import { pct, quickSelection, QUICK_SELECTIONS, useDesk, useStudio, type DeskDevice } from "./util";

const PLATE = 14; // KeyboardView plate padding (px)
const MOUSE_BOX = { w: 2.4, h: 3.8, ox: 0.2, oy: 0.2 }; // MouseView viewBox (units)
const CAPTION = 26;

interface Box {
  dev: DeskDevice;
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(d: DeskDevice): Box {
  if (d.type === "mouse") return { dev: d, x: d.desk.x - MOUSE_BOX.ox, y: d.desk.y - MOUSE_BOX.oy, w: MOUSE_BOX.w, h: MOUSE_BOX.h };
  return { dev: d, x: d.desk.x, y: d.desk.y, w: d.definition.size.w, h: d.definition.size.h };
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Soft colour bloom behind a device, sampled from its live frame. */
function bloomOf(frame: Record<string, RGB>, keys: { code: string; x: number }[], width: number): string | undefined {
  const buckets = 7;
  const acc = Array.from({ length: buckets }, () => [0, 0, 0, 0]);
  for (const k of keys) {
    const c = frame[k.code];
    if (!c) continue;
    const b = Math.min(buckets - 1, Math.max(0, Math.floor((k.x / width) * buckets)));
    acc[b][0] += c[0];
    acc[b][1] += c[1];
    acc[b][2] += c[2];
    acc[b][3]++;
  }
  const stops = acc.filter((a) => a[3]).map((a) => `rgb(${Math.round(a[0] / a[3])}, ${Math.round(a[1] / a[3])}, ${Math.round(a[2] / a[3])})`);
  if (!stops.length) return undefined;
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function KeyboardDevice({ dev, unit, selected }: { dev: DeskDevice; unit: number; selected: Set<string> }) {
  const frame = useLightingFrame(dev.uid);
  const keys = dev.layout?.keys ?? [];
  const bloom = useMemo(() => bloomOf(frame, keys, dev.definition.size.w), [frame, keys, dev.definition.size.w]);
  const width = dev.definition.size.w * unit + PLATE * 2;
  return (
    <>
      {bloom && <div className="lighting-bloom" style={{ background: bloom }} />}
      <KeyboardView keys={keys} size={dev.definition.size} colors={frame} selected={selected} onKeyClick={() => {}} maxWidth={width} glow={0.9} />
    </>
  );
}

function MouseDevice({ dev, unit, selected }: { dev: DeskDevice; unit: number; selected: string[] }) {
  const frame = useLightingFrame(dev.uid);
  const glow = useMemo(() => {
    const cs = Object.values(frame);
    if (!cs.length) return undefined;
    const avg = cs.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => Math.round(v / cs.length));
    return `radial-gradient(closest-side, rgb(${avg.join(",")}), transparent)`;
  }, [frame]);
  return (
    <>
      {glow && <div className="lighting-bloom lighting-bloom--mouse" style={{ background: glow }} />}
      <MouseView leds={dev.definition.leds} colors={frame} height={MOUSE_BOX.h * unit} selected={selected} />
    </>
  );
}

function OtherDevice({ dev, unit, selected }: { dev: DeskDevice; unit: number; selected: Set<string> }) {
  const frame = useLightingFrame(dev.uid);
  return (
    <div className="lighting-other" style={{ width: dev.definition.size.w * unit, height: dev.definition.size.h * unit }}>
      {(dev.definition.leds ?? []).map((l) => {
        const c = frame[l.id];
        const w = (l.w ?? 0.36) * unit;
        const h = (l.h ?? 0.36) * unit;
        return (
          <span
            key={l.id}
            title={l.name}
            className={selected.has(l.id) ? "is-selected" : undefined}
            style={{
              left: l.x * unit - w / 2,
              top: l.y * unit - h / 2,
              width: w,
              height: h,
              background: c ? `rgb(${c.join(",")})` : "#222",
              boxShadow: c ? `0 0 ${unit * 0.4}px rgb(${c.join(",")})` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/** Large live preview of the desk with key selection (click, shift-click, drag a rectangle). */
export function Stage() {
  const t = useT();
  const desk = useDesk();
  const keys = useStudio((s) => s.keys);
  const setKeys = useStudio((s) => s.setKeys);
  const live = useDevices((s) => s.live);
  const brightness = useLighting((s) => s.scene.brightness);
  const fps = useLighting((s) => s.scene.fps);
  const layers = useLighting((s) => s.scene.layers);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const innerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; additive: boolean } | null>(null);

  const boxes = useMemo(() => desk.map(boxOf), [desk]);
  const bounds = useMemo(() => {
    if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 };
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [boxes]);

  const padX = 84;
  const maxH = Math.max(220, size.h - 72 - CAPTION);
  const unit = size.w ? Math.max(12, Math.min(60, (size.w - padX * 2) / bounds.w, maxH / bounds.h)) : 0;
  const innerW = bounds.w * unit;
  const innerH = bounds.h * unit;

  /** Hit-test rectangles of every key / LED in inner (px) coordinates. */
  const targets = useMemo(() => {
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const b of boxes) {
      const left = (b.x - bounds.x) * unit;
      const top = (b.y - bounds.y) * unit;
      if (b.dev.type === "keyboard") {
        for (const k of b.dev.layout?.keys ?? []) out.push({ id: k.code, x: left + k.x * unit, y: top + k.y * unit, w: (k.w ?? 1) * unit, h: (k.h ?? 1) * unit });
      }
      const ox = b.dev.type === "mouse" ? MOUSE_BOX.ox : 0;
      const oy = b.dev.type === "mouse" ? MOUSE_BOX.oy : 0;
      for (const l of b.dev.definition.leds ?? []) {
        const w = (l.w ?? 0.36) * unit;
        const h = (l.h ?? 0.36) * unit;
        out.push({ id: l.id, x: left + (l.x + ox) * unit - w / 2, y: top + (l.y + oy) * unit - h / 2, w, h });
      }
    }
    return out;
  }, [boxes, bounds, unit]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = innerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !innerRef.current) return;
    const p = local(e);
    drag.current = { ...p, moved: false, additive: e.shiftKey || e.ctrlKey || e.metaKey };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 5) return;
    d.moved = true;
    setRect({ x0: Math.min(d.x, p.x), y0: Math.min(d.y, p.y), x1: Math.max(d.x, p.x), y1: Math.max(d.y, p.y) });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = local(e);
    if (d.moved) {
      const r = { x0: Math.min(d.x, p.x), y0: Math.min(d.y, p.y), x1: Math.max(d.x, p.x), y1: Math.max(d.y, p.y) };
      const hit = targets.filter((k) => k.x < r.x1 && k.x + k.w > r.x0 && k.y < r.y1 && k.y + k.h > r.y0).map((k) => k.id);
      setKeys(d.additive ? [...keys, ...hit] : hit);
      setRect(null);
      return;
    }
    const hit = targets.find((k) => p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h);
    if (!hit) {
      if (!d.additive) setKeys([]);
      return;
    }
    if (d.additive) {
      const next = new Set(keys);
      if (next.has(hit.id)) next.delete(hit.id);
      else next.add(hit.id);
      setKeys(next);
    } else setKeys(keys.size === 1 && keys.has(hit.id) ? [] : [hit.id]);
  };

  const hardware = desk.filter((d) => !d.virtual && live[d.uid]?.mode === "hardware");
  const virtual = desk.some((d) => d.virtual);
  const reactive = layers.some((l) => l.enabled && effectRegistry.get(l.effect)?.meta.reactive);
  const keyCount = keys.size;
  const selectedArr = useMemo(() => [...keys], [keys]);

  return (
    <section className="lighting-stage kh-card">
      <div className="lighting-canvas" ref={wrapRef}>
        <div className="lighting-canvas__meta">
          <span className="lighting-live">
            <span className="lighting-live__dot" />
            {t("lighting.stage.live")}
          </span>
          {virtual && <span>{t("lighting.preview.virtual")}</span>}
          {reactive && (
            <span className="lighting-tag">
              <Keyboard />
              {t("lighting.stage.reactive")}
            </span>
          )}
          <span className="grow" />
          <span className="lighting-canvas__hint">{t("lighting.stage.selectHint")}</span>
        </div>
        {hardware.length > 0 && (
          <div className="lighting-hwbanner">
            <Cpu />
            <span className="grow">{t("lighting.stage.hardware", { names: hardware.map((d) => d.definition.name).join(", ") })}</span>
            <Button size="sm" variant="primary" onClick={() => hardware.forEach((d) => setSoftwareMode(d.uid))}>
              {t("lighting.stage.useKeyHalo")}
            </Button>
          </div>
        )}
        {unit > 0 && (
          <div
            ref={innerRef}
            className="lighting-desk"
            style={{ width: innerW, height: innerH }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setRect(null);
            }}
          >
            {boxes.map((b) => {
              const left = (b.x - bounds.x) * unit;
              const top = (b.y - bounds.y) * unit;
              const isKb = b.dev.type === "keyboard";
              return (
                <div
                  key={b.dev.uid}
                  className={`lighting-device lighting-device--${b.dev.type}`}
                  style={{
                    left: isKb ? left - PLATE : left,
                    top: isKb ? top - PLATE : top,
                    width: isKb ? b.w * unit + PLATE * 2 : b.w * unit,
                    height: isKb ? b.h * unit + PLATE * 2 : b.h * unit,
                  }}
                >
                  {isKb ? (
                    <KeyboardDevice dev={b.dev} unit={unit} selected={keys} />
                  ) : b.dev.type === "mouse" ? (
                    <MouseDevice dev={b.dev} unit={unit} selected={selectedArr} />
                  ) : (
                    <OtherDevice dev={b.dev} unit={unit} selected={keys} />
                  )}
                  <div className="lighting-device__caption">{b.dev.definition.name}</div>
                </div>
              );
            })}
            {rect && <div className="lighting-marquee" style={{ left: rect.x0, top: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 }} />}
          </div>
        )}
      </div>
      <div className="lighting-stage__bar">
        <div className="lighting-chips" role="group" aria-label={t("lighting.select.title")}>
          <span className="lighting-chips__label">{t("lighting.select.title")}</span>
          {QUICK_SELECTIONS.map((q) => (
            <button key={q} type="button" className="lighting-chip" onClick={() => setKeys(quickSelection(q, desk))}>
              {t(`lighting.select.${q}`)}
            </button>
          ))}
          {keyCount > 0 && (
            <>
              <span className="lighting-chips__count">{t("lighting.select.count", { n: keyCount })}</span>
              <button type="button" className="lighting-chip lighting-chip--ghost" onClick={() => setKeys([])}>
                {t("lighting.select.clear")}
              </button>
            </>
          )}
        </div>
        <div className="lighting-stage__controls">
          <div className="lighting-bright" title={t("lighting.stage.brightness")}>
            <Sun />
            <Slider value={Math.round(brightness * 100)} min={0} max={100} onChange={(v) => useLighting.getState().setBrightness(v / 100)} />
            <span className="lighting-bright__value">{pct(brightness)}</span>
          </div>
          <Select
            className="lighting-fps"
            aria-label={t("lighting.stage.fps")}
            value={String(fps)}
            onChange={(v) => useLighting.getState().setFps(Number(v))}
            options={[15, 20, 30, 45, 60].map((f) => ({ value: String(f), label: `${f} fps` }))}
          />
          <Button
            size="sm"
            icon={<Zap />}
            title={t("lighting.stage.flashHint")}
            onClick={() => flash({ keys: keyCount ? [...keys] : undefined, color: "#ffffff", times: 2, durationMs: 900 })}
          >
            {t("lighting.stage.flash")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Dev switch `?demoKeys=1`: simulated typing so reactive layers show off in screenshots. */
export function useDemoTyping(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const codes = ["KeyK", "KeyE", "KeyY", "KeyH", "KeyA", "KeyL", "KeyO", "KeyD", "KeyJ", "KeyU", "KeyN", "KeyG"];
    let i = 0;
    const tick = () => {
      if (!alive) return;
      const code = codes[i++ % codes.length];
      engine.compositor.keyEvent(code, true, engine.now());
      setTimeout(() => engine.compositor.keyEvent(code, false, engine.now()), 70);
      setTimeout(tick, 260 + Math.random() * 220);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [on]);
}
