import { useMemo, useState } from "react";
import { AlertTriangle, Info, MousePointer2, Trash2 } from "lucide-react";
import { Badge, Button, ColorInput, Field, Input, Modal, Select } from "@/ui";
import { useT } from "@/i18n";
import type { KeyBinding, KeymapPack, Layout, ModifierName, ShortcutLegend } from "@/core/types";
import { CATEGORY_PALETTE, MODIFIER_ORDER, findConflicts, isModifierCode, modifierCode, modifierOf, validatePack } from "@/core/keymaps";
import { useProfiles } from "@/core/lighting/profiles";
import { KeyRecorder } from "./KeyRecorder";
import { ActionFields, ActionTypePicker, defaultAction } from "./ActionEditor";
import { clonePack, cx } from "./util";

export interface BindingTarget {
  /** Layer id the binding lives in ("" = base). */
  layer: string;
  /** Index in that layer's bindings; null = new binding. */
  index: number | null;
  draft: KeyBinding;
}

/** Returns a copy of `pack` with the binding removed from `from` and (optionally) inserted into `to`. */
export function placeBinding(pack: KeymapPack, from: { layer: string; index: number | null }, to: { layer: string; binding: KeyBinding } | null): KeymapPack {
  const next = clonePack(pack);
  const list = (layer: string) => (layer ? next.layers?.find((l) => l.id === layer)?.bindings : next.bindings);
  let insertAt: number | null = null;
  if (from.index !== null) {
    const src = list(from.layer);
    if (src) {
      src.splice(from.index, 1);
      if (to && to.layer === from.layer) insertAt = from.index;
    }
  }
  if (to) {
    const dst = list(to.layer);
    if (dst) {
      if (insertAt !== null) dst.splice(insertAt, 0, to.binding);
      else dst.push(to.binding);
    }
  }
  return next;
}

/** Modal editor for one binding: trigger, action, label, category, layer. */
export function BindingEditor({
  pack,
  target,
  layout,
  onClose,
  onSave,
}: {
  pack: KeymapPack;
  target: BindingTarget;
  layout?: Layout;
  onClose: () => void;
  onSave: (pack: KeymapPack) => Promise<boolean>;
}) {
  const t = useT();
  const profiles = useProfiles((s) => s.profiles);
  const [draft, setDraft] = useState<KeyBinding>(() => JSON.parse(JSON.stringify(target.draft)));
  const [layer, setLayer] = useState(target.layer);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layers = pack.layers ?? [];
  const isNew = target.index === null;

  const triggerCodes = useMemo(() => [...(draft.with ?? []).map((m) => modifierCode(m)), ...(draft.key ? [draft.key] : [])], [draft.with, draft.key]);
  const isMouse = /^Mouse\d$/.test(draft.key);

  const setTrigger = (codes: string[]) => {
    const main = [...codes].reverse().find((c) => !isModifierCode(c)) ?? codes[codes.length - 1];
    const mods = MODIFIER_ORDER.filter((m) => codes.some((c) => c !== main && modifierOf(c) === m));
    setDraft((d) => ({
      ...d,
      key: main ?? "",
      with: mods.length ? mods : undefined,
    }));
  };
  const toggleMod = (m: ModifierName) =>
    setDraft((d) => {
      const cur = new Set(d.with ?? []);
      if (cur.has(m)) cur.delete(m);
      else cur.add(m);
      const w = MODIFIER_ORDER.filter((x) => cur.has(x));
      return { ...d, with: w.length ? w : undefined };
    });

  const finalBinding = (): KeyBinding => {
    const b: KeyBinding = { key: draft.key, action: draft.action };
    if (draft.with?.length) b.with = draft.with;
    if (draft.label?.trim()) b.label = draft.label.trim();
    if (draft.category) b.category = draft.category;
    return b;
  };

  const preview = useMemo(() => {
    const b = finalBinding();
    let next = placeBinding(pack, { layer: target.layer, index: target.index }, { layer, binding: b });
    if (b.category && !next.categories[b.category])
      next = {
        ...next,
        categories: { ...next.categories, [b.category]: newCatColor(next) },
      };
    const conflicts = draft.key ? findConflicts(next, { layout }).filter((c) => c.binding === b) : [];
    return { next, conflicts, errors: draft.key ? validatePack(next) : [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, layer, pack, layout]);

  const save = async () => {
    setBusy(true);
    const ok = await onSave(preview.next);
    setBusy(false);
    if (ok) onClose();
  };
  const remove = async () => {
    setBusy(true);
    const ok = await onSave(placeBinding(pack, { layer: target.layer, index: target.index }, null));
    setBusy(false);
    if (ok) onClose();
  };

  const cats = Object.keys(pack.categories);
  const catOptions = [
    { value: "", label: t("keymaps.ui.noCategory") },
    ...cats.map((c) => ({ value: c, label: c })),
    ...(draft.category && !cats.includes(draft.category) ? [{ value: draft.category, label: draft.category }] : []),
    { value: "__new", label: t("keymaps.ui.newCategory") },
  ];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? t("keymaps.ui.binding.addTitle") : t("keymaps.ui.binding.editTitle")}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove} disabled={busy} style={{ marginRight: "auto" }}>
              {t("common.delete")}
            </Button>
          )}
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={busy || !draft.key || preview.errors.length > 0}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="keymaps-editor">
        <section className="keymaps-editor__section">
          <h3 className="keymaps-editor__h">{t("keymaps.ui.binding.trigger")}</h3>
          <div className="keymaps-form-grid keymaps-form-grid--trigger">
            <Field label={t("keymaps.ui.binding.whenPressed")} hint={t("keymaps.ui.binding.triggerHint")}>
              {isMouse ? (
                <div className="row">
                  <Badge>
                    <MousePointer2 size={12} /> {draft.key}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, key: "" }))}>
                    {t("keymaps.ui.recorder.clear")}
                  </Button>
                </div>
              ) : (
                <KeyRecorder value={triggerCodes} onChange={setTrigger} autoFocus={isNew && !draft.key} />
              )}
            </Field>
            <Field label={t("keymaps.ui.binding.holding")}>
              <div className="keymaps-modchips">
                {MODIFIER_ORDER.map((m) => (
                  <button key={m} type="button" className={cx("keymaps-chip", draft.with?.includes(m) && "is-on")} onClick={() => toggleMod(m)}>
                    {m === "Meta" ? "Win" : m}
                  </button>
                ))}
                <select
                  className="kh-select keymaps-mouse-pick"
                  value={isMouse ? draft.key : ""}
                  onChange={(e) => e.target.value && setDraft((d) => ({ ...d, key: e.target.value }))}
                  aria-label={t("keymaps.ui.binding.mouseTrigger")}
                >
                  <option value="">{t("keymaps.ui.binding.mouseTrigger")}</option>
                  {["Mouse4", "Mouse5", "Mouse3", "Mouse2", "Mouse1"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            {layers.length > 0 && (
              <Field label={t("keymaps.ui.binding.layer")}>
                <Select
                  value={layer}
                  onChange={setLayer}
                  options={[{ value: "", label: t("keymaps.hud.baseLayer") }, ...layers.map((l) => ({ value: l.id, label: l.name }))]}
                />
              </Field>
            )}
          </div>
        </section>

        <section className="keymaps-editor__section">
          <h3 className="keymaps-editor__h">{t("keymaps.ui.binding.action")}</h3>
          <ActionTypePicker
            value={draft.action.type}
            onChange={(type) =>
              type !== draft.action.type &&
              setDraft((d) => ({
                ...d,
                action: defaultAction(type, layers, profiles[0]?.id ?? ""),
              }))
            }
          />
          <div className="keymaps-editor__fields">
            <ActionFields action={draft.action} onChange={(action) => setDraft((d) => ({ ...d, action }))} layers={layers} />
          </div>
        </section>

        <section className="keymaps-editor__section">
          <h3 className="keymaps-editor__h">{t("keymaps.ui.binding.display")}</h3>
          <div className="keymaps-form-grid">
            <Field label={t("keymaps.ui.binding.label")} hint={t("keymaps.ui.binding.labelHint")}>
              <Input
                value={draft.label ?? ""}
                placeholder={t("keymaps.ui.binding.labelPlaceholder")}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </Field>
            <Field label={t("keymaps.ui.binding.category")}>
              {newCat !== null ? (
                <div className="row">
                  <Input autoFocus value={newCat} placeholder={t("keymaps.ui.categoryName")} onChange={(e) => setNewCat(e.target.value)} />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newCat.trim()) setDraft((d) => ({ ...d, category: newCat.trim() }));
                      setNewCat(null);
                    }}
                  >
                    {t("common.add")}
                  </Button>
                </div>
              ) : (
                <Select
                  value={draft.category ?? ""}
                  onChange={(v) => (v === "__new" ? setNewCat("") : setDraft((d) => ({ ...d, category: v || undefined })))}
                  options={catOptions}
                />
              )}
            </Field>
          </div>
        </section>

        {(preview.conflicts.length > 0 || preview.errors.length > 0) && (
          <div className="keymaps-callout keymaps-callout--warn">
            <AlertTriangle />
            <div>
              {preview.conflicts.map((c, i) => (
                <div key={i}>
                  {t(c.messageKey, c.params) === c.messageKey ? c.message : t(c.messageKey, c.params)}
                  {c.suggestionKey && <div className="subtle">{t(c.suggestionKey)}</div>}
                </div>
              ))}
              {preview.errors.slice(0, 3).map((e, i) => (
                <div key={`e${i}`} className="mono" style={{ fontSize: 12 }}>
                  {e}
                </div>
              ))}
            </div>
          </div>
        )}
        {(draft.action.type === "launch" || draft.action.type === "macro" || draft.action.type === "text") && (
          <div className="keymaps-callout">
            <Info />
            <div>{t("keymaps.ui.binding.reviewNote")}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function newCatColor(pack: KeymapPack): string {
  const used = new Set(Object.values(pack.categories).map((c) => c.toLowerCase()));
  return CATEGORY_PALETTE.find((c) => !used.has(c)) ?? CATEGORY_PALETTE[Object.keys(pack.categories).length % CATEGORY_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Legend editor
// ---------------------------------------------------------------------------

export function LegendEditor({
  pack,
  index,
  initial,
  onClose,
  onSave,
}: {
  pack: KeymapPack;
  /** null = new legend. */
  index: number | null;
  initial: ShortcutLegend;
  onClose: () => void;
  onSave: (pack: KeymapPack) => Promise<boolean>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<ShortcutLegend>(initial);
  const [newCat, setNewCat] = useState<{ name: string; color: string } | null>(
    Object.keys(pack.categories).length ? null : { name: "", color: newCatColor(pack) },
  );
  const cats = Object.keys(pack.categories);

  const build = () => {
    const next = clonePack(pack);
    let legend = draft;
    if (newCat?.name.trim()) {
      next.categories[newCat.name.trim()] = newCat.color;
      legend = { ...draft, category: newCat.name.trim() };
    }
    if (index === null) next.legends.push(legend);
    else next.legends[index] = legend;
    return next;
  };
  const save = async () => (await onSave(build())) && onClose();
  const remove = async () => {
    if (index === null) return onClose();
    const next = clonePack(pack);
    next.legends.splice(index, 1);
    if (await onSave(next)) onClose();
  };
  const valid = draft.keys.length > 0 && draft.label.trim() && (newCat ? newCat.name.trim() : draft.category);

  return (
    <Modal
      open
      onClose={onClose}
      title={index === null ? t("keymaps.ui.legend.addTitle") : t("keymaps.ui.legend.editTitle")}
      footer={
        <>
          {index !== null && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove} style={{ marginRight: "auto" }}>
              {t("common.delete")}
            </Button>
          )}
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <p className="keymaps-note">{t("keymaps.ui.legend.intro")}</p>
        <Field label={t("keymaps.ui.legend.keys")}>
          <KeyRecorder value={draft.keys} onChange={(keys) => setDraft((d) => ({ ...d, keys }))} autoFocus={draft.keys.length === 0} />
        </Field>
        <Field label={t("keymaps.ui.binding.label")}>
          <Input
            value={draft.label}
            placeholder={t("keymaps.ui.legend.labelPlaceholder")}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </Field>
        <Field label={t("keymaps.ui.binding.category")}>
          {newCat ? (
            <div className="row">
              <ColorInput value={newCat.color} onChange={(color) => setNewCat({ ...newCat, color })} />
              <Input value={newCat.name} placeholder={t("keymaps.ui.categoryName")} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
              {cats.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setNewCat(null)}>
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          ) : (
            <Select
              value={draft.category}
              onChange={(v) => (v === "__new" ? setNewCat({ name: "", color: newCatColor(pack) }) : setDraft((d) => ({ ...d, category: v })))}
              options={[...cats.map((c) => ({ value: c, label: c })), { value: "__new", label: t("keymaps.ui.newCategory") }]}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
