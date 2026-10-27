import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input, Modal, Segmented } from "@/ui";
import { useEffects, useLighting } from "@/core/lighting";
import type { BlendMode, EffectMeta } from "@/core/types";
import { useMiniPreview } from "./miniPreview";
import { CATEGORIES, categoryOf, useFx, useStudio, type Category } from "./util";

/** Sensible blend for a new layer: reactive/overlay effects screen over the base. */
function defaultBlend(meta: EffectMeta, isFirst: boolean): BlendMode {
  if (isFirst) return "normal";
  const cat = categoryOf(meta);
  if (cat === "reactive" && meta.params.background) return "screen";
  return "normal";
}

export function addEffectLayer(meta: EffectMeta) {
  const { scene, addLayer } = useLighting.getState();
  const id = addLayer({ effect: meta.id, params: {}, blend: defaultBlend(meta, scene.layers.length === 0) });
  useStudio.getState().selectLayer(id);
}

function EffectCard({ meta, current, onPick }: { meta: EffectMeta; current: boolean; onPick: () => void }) {
  const fx = useFx();
  const ref = useMiniPreview(meta.id, { reactive: meta.reactive });
  return (
    <button type="button" className={`lighting-fxcard${current ? " is-current" : ""}`} onClick={onPick}>
      <canvas ref={ref} className="lighting-fxcard__preview" aria-hidden />
      <span className="lighting-fxcard__name">{fx.name(meta)}</span>
      <span className="lighting-fxcard__desc">{fx.desc(meta)}</span>
      {meta.source === "community" && meta.author && <span className="lighting-fxcard__author">{fx.t("lighting.picker.by", { author: meta.author })}</span>}
    </button>
  );
}

/** Effect picker: a grid of live mini-previews grouped by category. */
export function EffectPicker() {
  const fx = useFx();
  const t = fx.t;
  const picker = useStudio((s) => s.picker);
  const openPicker = useStudio((s) => s.openPicker);
  const effects = useEffects();
  const layers = useLighting((s) => s.scene.layers);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");

  const replacing = picker?.mode === "replace" ? layers.find((l) => l.id === picker.layerId) : undefined;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = effects.filter((m) => {
      if (!needle) return true;
      return [m.id, m.name, fx.name(m), m.description ?? "", fx.desc(m), m.author ?? "", ...(m.tags ?? [])].some((s) => s.toLowerCase().includes(needle));
    });
    return CATEGORIES.filter((c) => cat === "all" || c === cat)
      .map((c) => ({ cat: c, items: list.filter((m) => categoryOf(m) === c).sort((a, b) => (a.id === "off" ? 1 : b.id === "off" ? -1 : 0)) }))
      .filter((g) => g.items.length);
  }, [effects, q, cat, fx]);

  if (!picker) return null;
  const close = () => openPicker(null);
  const pick = (meta: EffectMeta) => {
    if (picker.mode === "replace" && replacing) {
      useLighting.getState().updateLayer(replacing.id, { effect: meta.id, params: {} });
    } else addEffectLayer(meta);
    close();
  };

  return (
    <Modal open wide onClose={close} title={picker.mode === "replace" ? t("lighting.picker.changeTitle") : t("lighting.picker.title")}>
      <div className="lighting-picker">
        <div className="lighting-picker__bar">
          <div className="lighting-search">
            <Search />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("lighting.picker.search")} />
          </div>
          <Segmented
            value={cat}
            onChange={setCat}
            options={[{ value: "all" as const, label: t("common.all") }, ...CATEGORIES.map((c) => ({ value: c, label: t(`lighting.categories.${c}`) }))]}
          />
        </div>
        <div className="lighting-picker__scroll">
          {groups.length === 0 && <div className="subtle lighting-picker__empty">{t("lighting.picker.none")}</div>}
          {groups.map((g) => (
            <div key={g.cat} className="lighting-picker__group">
              <div className="lighting-picker__heading">
                {t(`lighting.categories.${g.cat}`)}
                <span>{g.items.length}</span>
              </div>
              <div className="lighting-picker__grid">
                {g.items.map((m) => (
                  <EffectCard key={m.id} meta={m} current={replacing?.effect === m.id} onPick={() => pick(m)} />
                ))}
              </div>
            </div>
          ))}
          <div className="lighting-picker__foot subtle">{t("lighting.picker.communityHint")}</div>
        </div>
      </div>
    </Modal>
  );
}
