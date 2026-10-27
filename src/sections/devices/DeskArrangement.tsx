import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Move } from "lucide-react";
import { Card, KeyboardView, MouseView } from "@/ui";
import { useT } from "@/i18n";
import { useDevices, layoutOf } from "@/core/devices";
import { useLightingFrame } from "@/core/lighting";
import type { ConnectedDevice } from "@/core/types";
import { DeviceIcon } from "../dashboard/shared";

const SNAP = 0.25;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/**
 * The virtual desk used by synced effects (a wave crossing keyboard → mouse). Devices are drawn
 * to scale in keyboard units; drag them to match where they sit on your real desk.
 */
export function DeskArrangement() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const setDesk = useDevices((s) => s.setDesk);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ uid: string; x: number; y: number; ox: number; oy: number } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const spanW = Math.max(26, ...devices.map((d) => d.desk.x + d.definition.size.w + 4));
  const spanH = Math.max(7, ...devices.map((d) => d.desk.y + d.definition.size.h + 1.9));
  const scale = width > 0 ? width / spanW : 0;
  const pos = (d: ConnectedDevice) => (drag?.uid === d.uid ? { x: drag.x, y: drag.y } : d.desk);

  const onDown = (e: ReactPointerEvent, d: ConnectedDevice) => {
    if (!scale) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = ref.current!.getBoundingClientRect();
    setDrag({ uid: d.uid, x: d.desk.x, y: d.desk.y, ox: (e.clientX - rect.left) / scale - d.desk.x, oy: (e.clientY - rect.top) / scale - d.desk.y });
  };
  const onMove = (e: ReactPointerEvent, d: ConnectedDevice) => {
    if (!drag || drag.uid !== d.uid) return;
    const rect = ref.current!.getBoundingClientRect();
    const x = snap(Math.max(-2, Math.min(spanW - d.definition.size.w, (e.clientX - rect.left) / scale - drag.ox)));
    const y = snap(Math.max(-1, Math.min(spanH - d.definition.size.h, (e.clientY - rect.top) / scale - drag.oy)));
    setDrag({ ...drag, x, y });
  };
  const onUp = (d: ConnectedDevice) => {
    if (!drag || drag.uid !== d.uid) return;
    if (drag.x !== d.desk.x || drag.y !== d.desk.y) setDesk(d.uid, { x: drag.x, y: drag.y });
    setDrag(null);
  };

  // Offset so negative positions still fit.
  const ox = Math.max(0, -Math.min(0, ...devices.map((d) => pos(d).x))) + 1;
  const oy = Math.max(0, -Math.min(0, ...devices.map((d) => pos(d).y))) + 0.9;

  return (
    <Card title={t("devices.page.desk")} subtitle={t("devices.page.deskHint")}>
      <div ref={ref} className="dev-desk" style={{ height: scale ? (spanH + 1) * scale : 220 }}>
        {devices.length === 0 && <div className="dev-desk__empty subtle">{t("devices.page.deskEmpty")}</div>}
        {scale > 0 &&
          devices.map((d) => {
            const p = pos(d);
            return (
              <div
                key={d.uid}
                className={`dev-desk__item${drag?.uid === d.uid ? " dev-desk__item--drag" : ""}`}
                style={{ left: (p.x + ox) * scale, top: (p.y + oy) * scale, width: d.definition.size.w * scale }}
                onPointerDown={(e) => onDown(e, d)}
                onPointerMove={(e) => onMove(e, d)}
                onPointerUp={() => onUp(d)}
                onPointerCancel={() => setDrag(null)}
                title={d.definition.name}
              >
                <DeskDevice device={d} scale={scale} />
                <div className="dev-desk__label">
                  <Move />
                  {d.definition.size.w >= 6 && <span>{d.definition.name}</span>}
                  <span className="mono subtle">
                    {p.x},{p.y}
                  </span>
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}

function DeskDevice({ device, scale }: { device: ConnectedDevice; scale: number }) {
  const colors = useLightingFrame(device.uid);
  const def = device.definition;
  const layout = def.type === "keyboard" ? layoutOf(device) : undefined;
  if (layout) {
    // KeyboardView adds a 14 px plate border on each side.
    return (
      <div style={{ width: def.size.w * scale + 28, marginLeft: -14, marginTop: -14, pointerEvents: "none" }}>
        <KeyboardView keys={layout.keys} size={def.size} colors={colors} showLabels={false} />
      </div>
    );
  }
  if (def.type === "mouse") return <MouseView leds={def.leds} colors={colors} height={def.size.h * scale} />;
  return (
    <div className="dev-desk__generic" style={{ height: def.size.h * scale }}>
      <DeviceIcon type={def.type} size={18} />
    </div>
  );
}
