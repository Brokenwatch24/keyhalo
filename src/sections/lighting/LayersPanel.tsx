import { useState, type DragEvent } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, GripVertical, Layers, Plus, Trash2 } from "lucide-react";
import { Button, EmptyState } from "@/ui";
import { effectRegistry, newLayerId, useEffects, useLighting } from "@/core/lighting";
import type { LightingLayer } from "@/core/types";
import { categoryOf, layerSwatch, pct, plural, useFx, useStudio } from "./util";

export function duplicateLayer(id: string) {
  const { scene, addLayer } = useLighting.getState();
  const i = scene.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const src = scene.layers[i];
  const copy = structuredClone(src);
  const nid = addLayer({ ...copy, id: newLayerId() }, i + 1);
  useStudio.getState().selectLayer(nid);
}

export function deleteLayer(id: string) {
  const { scene, removeLayer } = useLighting.getState();
  const i = scene.layers.findIndex((l) => l.id === id);
  removeLayer(id);
  const rest = scene.layers.filter((l) => l.id !== id);
  useStudio.getState().selectLayer(rest[Math.min(i, rest.length - 1)]?.id ?? null);
}

/** Ordered layer stack (top row = highest layer), like a design tool. */
export function LayersPanel() {
  const fx = useFx();
  const t = fx.t;
  useEffects(); // re-render when community effects load
  const layers = useLighting((s) => s.scene.layers);
  const errors = useLighting((s) => s.errors);
  const selected = useStudio((s) => s.selectedLayer);
  const selectLayer = useStudio((s) => s.selectLayer);
  const openPicker = useStudio((s) => s.openPicker);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // Display order: top of the list = last (highest) layer.
  const rows = [...layers].reverse();
  const n = layers.length;

  const onDragOver = (e: DragEvent, displayIndex: number) => {
    if (!dragId) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientY < r.top + r.height / 2 ? displayIndex : displayIndex + 1);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && dropAt !== null) {
      const from = rows.findIndex((l) => l.id === dragId);
      let to = dropAt;
      if (to > from) to -= 1;
      // display index → scene index
      useLighting.getState().moveLayer(dragId, n - 1 - to);
    }
    setDragId(null);
    setDropAt(null);
  };

  return (
    <section className="kh-card lighting-panel lighting-layers">
      <header className="lighting-panel__head">
        <Layers />
        <span className="lighting-panel__title">{t("lighting.layers.title")}</span>
        <span className="lighting-count">{n}</span>
        <span className="grow" />
        <Button size="sm" icon={<Plus />} onClick={() => openPicker({ mode: "add" })}>
          {t("lighting.layers.add")}
        </Button>
      </header>
      {n === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={t("lighting.layers.emptyTitle")}
          action={
            <Button variant="primary" icon={<Plus />} onClick={() => openPicker({ mode: "add" })}>
              {t("lighting.layers.add")}
            </Button>
          }
        >
          {t("lighting.layers.empty")}
        </EmptyState>
      ) : (
        <ol className="lighting-layerlist" onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
          {rows.map((layer, i) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              error={errors[layer.id]}
              selected={selected === layer.id}
              dragging={dragId === layer.id}
              dropBefore={dropAt === i}
              dropAfter={dropAt === rows.length && i === rows.length - 1}
              bottom={i === rows.length - 1}
              onSelect={() => selectLayer(layer.id)}
              onDragStart={(e) => {
                setDragId(layer.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", layer.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={onDrop}
              fxName={fx.name(effectRegistry.get(layer.effect)?.meta, layer.effect)}
              t={t}
            />
          ))}
        </ol>
      )}
      <footer className="lighting-panel__foot">{t("lighting.layers.hint")}</footer>
    </section>
  );
}

function LayerRow({
  layer,
  error,
  selected,
  dragging,
  dropBefore,
  dropAfter,
  bottom,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  fxName,
  t,
}: {
  layer: LightingLayer;
  error?: string;
  selected: boolean;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  bottom: boolean;
  onSelect: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  fxName: string;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const meta = effectRegistry.get(layer.effect)?.meta;
  const cat = categoryOf(meta);
  const update = useLighting.getState().updateLayer;
  const scope = layer.mask?.length
    ? plural(t, "lighting.layers.keys", layer.mask.length)
    : layer.devices?.length
      ? t("lighting.layers.someDevices")
      : t("lighting.layers.allKeys");
  const cls = [
    "lighting-layer",
    selected && "is-selected",
    !layer.enabled && "is-hidden",
    dragging && "is-dragging",
    dropBefore && "drop-before",
    dropAfter && "drop-after",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      className={cls}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <GripVertical className="lighting-layer__grip" />
      <button
        type="button"
        className="lighting-iconbtn"
        title={layer.enabled ? t("lighting.layers.hide") : t("lighting.layers.show")}
        aria-pressed={layer.enabled}
        onClick={(e) => {
          e.stopPropagation();
          update(layer.id, { enabled: !layer.enabled });
        }}
      >
        {layer.enabled ? <Eye /> : <EyeOff />}
      </button>
      <span className={`lighting-swatch lighting-swatch--${cat}`} style={{ background: layerSwatch(layer, meta) }} />
      <span className="lighting-layer__text">
        <span className="lighting-layer__name">
          {fxName}
          {error && <AlertTriangle className="lighting-layer__warn" aria-label={error} />}
        </span>
        <span className="lighting-layer__meta">
          {bottom && layer.blend === "normal" ? t("lighting.layers.base") : t(`lighting.blend.${layer.blend}`)}
          {layer.opacity < 1 && <> · {pct(layer.opacity)}</>} · {scope}
        </span>
      </span>
      <span className="lighting-layer__actions">
        <button
          type="button"
          className="lighting-iconbtn"
          title={t("lighting.layers.duplicate")}
          onClick={(e) => {
            e.stopPropagation();
            duplicateLayer(layer.id);
          }}
        >
          <Copy />
        </button>
        <button
          type="button"
          className="lighting-iconbtn lighting-iconbtn--danger"
          title={t("lighting.layers.delete")}
          onClick={(e) => {
            e.stopPropagation();
            deleteLayer(layer.id);
          }}
        >
          <Trash2 />
        </button>
      </span>
    </li>
  );
}
