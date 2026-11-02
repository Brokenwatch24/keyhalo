import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/core/backend";
import { mapPayload, usePads, type PadMapPayload } from "@/core/pads";
import { PadGrid } from "@/ui/PadGrid";
import "./padmap.css";

/** The pad map card: active page name, page dots and the Launchpad with every pad's label. */
export function PadMapView({ payload }: { payload: PadMapPayload }) {
  return (
    <div className="kh-padmap">
      <div className="kh-padmap__head">
        <span className="kh-padmap__title">{payload.page}</span>
        <span className="kh-padmap__pages">
          {payload.pages.map((p) => (
            <span key={p.name} className={p.active ? "is-active" : ""} style={{ ["--c" as string]: p.color }}>
              {p.name}
            </span>
          ))}
        </span>
      </div>
      <PadGrid cells={payload.buttons} compact />
    </div>
  );
}

/** Route #/padmap: the transparent, click-through overlay window. */
export function PadMapWindow() {
  const [payload, setPayload] = useState<PadMapPayload | null>(null);
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const un = listen<PadMapPayload>("padmap-update", (e) => setPayload(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);
  return payload ? (
    <div className="kh-padmap-window">
      <PadMapView payload={payload} />
    </div>
  ) : null;
}

/** Browser demo: the same map, floating inside the app. */
export function PadMapInApp() {
  const visible = usePads((s) => s.mapVisible);
  usePads((s) => s.pageId);
  usePads((s) => s.board);
  usePads((s) => s.audio);
  if (isTauri || !visible) return null;
  return (
    <div className="kh-padmap-float">
      <PadMapView payload={mapPayload()} />
    </div>
  );
}
