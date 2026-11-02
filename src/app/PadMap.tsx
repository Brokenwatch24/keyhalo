import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/core/backend";
import { mapPayload, parseButton, usePads, type PadMapItem, type PadMapPayload } from "@/core/pads";
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
      {payload.list ? <PadList items={payload.list} /> : <PadGrid cells={payload.buttons} compact />}
      {payload.hint && <div className="kh-padmap__hint">{payload.hint}</div>}
    </div>
  );
}

/** A list (tasks, sessions) where each row shows where its pad is on the 8×8 grid. */
function PadList({ items }: { items: PadMapItem[] }) {
  return (
    <ol className="kh-padlist">
      {items.slice(0, 16).map((it) => {
        const b = parseButton(it.button);
        const at = b && b.kind === "g" ? b.y * 8 + b.x : -1;
        return (
          <li key={it.button} className={it.done ? "is-done" : ""} style={{ ["--c" as string]: it.color }}>
            <span className="kh-padlist__where" aria-hidden>
              {Array.from({ length: 64 }, (_, i) => (
                <i key={i} className={i === at ? "is-here" : ""} />
              ))}
            </span>
            <span className="kh-padlist__text">
              <span className="kh-padlist__label">{it.label}</span>
              {it.sub && <span className="kh-padlist__sub">{it.sub}</span>}
            </span>
          </li>
        );
      })}
      {items.length > 16 && <li className="kh-padlist__more">+{items.length - 16}</li>}
    </ol>
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
