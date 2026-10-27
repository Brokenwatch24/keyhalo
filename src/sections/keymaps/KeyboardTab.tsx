import { useEffect, useMemo, useRef, useState } from "react";
import { MousePointerClick, Pencil, Plus, Settings2 } from "lucide-react";
import { Button, Card, KeyboardView, Segmented, Select } from "@/ui";
import { useT } from "@/i18n";
import type { KeyBinding, KeymapPack, KeyDef, Layout, ModifierName, RGB, ShortcutLegend } from "@/core/types";
import { comboFromBinding, comboFromKeys, keyLabel, layerColorsFor, legendColorsFor, modifierCode, sortMods } from "@/core/keymaps";
import { Combo } from "./KeyRecorder";
import { ACTION_ICONS } from "./ActionEditor";
import { actionSummary, bindingParts, cx, keysParts, modsLabel } from "./util";

export interface Board {
  keys: KeyDef[];
  size: { w: number; h: number };
  layout?: Layout;
  name: string;
}

export interface KeyboardTabProps {
  pack: KeymapPack;
  board: Board;
  boardChoice: string;
  boardOptions: { value: string; label: string }[];
  onBoardChoice: (v: string) => void;
  layer: string;
  onLayer: (l: string) => void;
  onAddBinding: (layer: string, key: string, mods: ModifierName[]) => void;
  onEditBinding: (layer: string, index: number) => void;
  onAddLegend: (legend: ShortcutLegend) => void;
  onEditLegend: (index: number) => void;
  onCategoryColor: (cat: string, color: string) => void;
  onManageCategories: () => void;
}

const modsId = (mods: ModifierName[]) => mods.join("+");
const parseMods = (id: string): ModifierName[] => (id ? (id.split("+") as ModifierName[]) : []);

/** Which modifier sets have legends in a pack, most used first. */
function modifierSets(pack: KeymapPack): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  const add = (mods: ModifierName[]) => counts.set(modsId(mods), (counts.get(modsId(mods)) ?? 0) + 1);
  for (const l of pack.legends) {
    const c = comboFromKeys(l.keys);
    if (c) add(c.mods);
  }
  for (const b of pack.bindings) if (b.category || b.label) add(sortMods(b.with ?? []));
  return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.length - b.id.length);
}

export function defaultModifierSet(pack: KeymapPack): string {
  const sets = modifierSets(pack);
  return sets[0]?.id ?? "";
}

export function KeyboardTab(p: KeyboardTabProps) {
  const { pack, board, layer } = p;
  const t = useT();
  const [mods, setMods] = useState(() => defaultModifierSet(pack));
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [pinCat, setPinCat] = useState<string | null>(null);
  const focusCat = hoverCat ?? pinCat;

  useEffect(() => {
    setMods(defaultModifierSet(pack));
    setSelected(null);
    setPinCat(null);
    // only when switching packs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id]);

  const sets = useMemo(() => modifierSets(pack), [pack]);
  const modOptions = useMemo(() => {
    const ids = ["", ...sets.map((s) => s.id).filter((id) => id !== "")].slice(0, 8);
    for (const id of ["Ctrl", "Shift", "Alt"]) if (!ids.includes(id) && ids.length < 8) ids.push(id);
    if (mods && !ids.includes(mods)) ids.push(mods);
    const count = (id: string) => sets.find((s) => s.id === id)?.count ?? 0;
    return ids.map((id) => ({
      value: id,
      label: (
        <>
          {id ? modsLabel(parseMods(id)) : t("keymaps.ui.noModifier")}
          {count(id) > 0 && <span className="keymaps-seg-count">{count(id)}</span>}
        </>
      ),
    }));
  }, [sets, mods, t]);

  const layerName = (id: string) => pack.layers?.find((l) => l.id === id)?.name ?? id;

  // Colours, legends, badges and categories for the current view.
  const view = useMemo(() => {
    const legends: Record<string, string> = {};
    const catOf: Record<string, string> = {};
    const badges: Record<string, string> = {};
    for (const k of board.keys) legends[k.code] = "";
    let colors: Record<string, RGB>;
    if (layer) {
      colors = layerColorsFor(pack, layer, [210, 210, 215]);
      const l = pack.layers?.find((x) => x.id === layer);
      for (const b of l?.bindings ?? []) {
        if (legends[b.key]) continue;
        legends[b.key] = b.label ?? actionSummary(t, b.action, layerName);
        if (b.category) catOf[b.key] = b.category;
      }
      // keys that activate this layer
      for (const b of pack.bindings) {
        const a = b.action;
        const refs =
          a.type === "layer"
            ? a.layer === layer
            : a.type === "tapHold" && ((a.hold.type === "layer" && a.hold.layer === layer) || (a.tap.type === "layer" && a.tap.layer === layer));
        if (refs) {
          colors[b.key] = [255, 255, 255];
          legends[b.key] = layerName(layer);
          badges[b.key] = "L";
        }
      }
    } else {
      const held = parseMods(mods);
      colors = legendColorsFor(pack, held, { modifierColor: [200, 200, 206] });
      for (const l of pack.legends) {
        const c = comboFromKeys(l.keys);
        if (!c || modsId(c.mods) !== mods || legends[c.key]) continue;
        legends[c.key] = l.label;
        catOf[c.key] = l.category;
      }
      for (const b of pack.bindings) {
        const c = comboFromBinding(b);
        if (modsId(c.mods) !== mods) continue;
        legends[b.key] = b.label ?? actionSummary(t, b.action, layerName);
        if (b.category && !catOf[b.key]) catOf[b.key] = b.category;
        badges[b.key] = "↻";
      }
      for (const m of held) {
        const code = modifierCode(m);
        legends[code] = "";
        legends[code.replace("Left", "Right")] = "";
      }
    }
    const dim = new Set<string>();
    if (focusCat) for (const k of board.keys) if (catOf[k.code] !== focusCat && colors[k.code]) dim.add(k.code);
    if (focusCat) for (const k of board.keys) if (!colors[k.code]) dim.add(k.code);
    return { colors, legends, badges, dim, catOf };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, layer, mods, board.keys, focusCat, t]);

  const catCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of pack.legends) out[l.category] = (out[l.category] ?? 0) + 1;
    for (const b of [...pack.bindings, ...(pack.layers ?? []).flatMap((l) => l.bindings)]) if (b.category) out[b.category] = (out[b.category] ?? 0) + 1;
    return out;
  }, [pack]);

  const layers = pack.layers ?? [];

  return (
    <div className="keymaps-kbtab">
      <div className="keymaps-toolbar">
        {layers.length > 0 && (
          <Segmented
            value={layer}
            onChange={(l) => {
              p.onLayer(l);
              setSelected(null);
            }}
            options={[{ value: "", label: t("keymaps.hud.baseLayer") }, ...layers.map((l) => ({ value: l.id, label: l.name }))]}
          />
        )}
        {!layer && (
          <div className="keymaps-toolbar__mods">
            <span className="keymaps-toolbar__label">{t("keymaps.ui.holding")}</span>
            <Segmented value={mods} onChange={setMods} options={modOptions} />
          </div>
        )}
        <div className="grow" />
        <Select className="keymaps-board-select" value={p.boardChoice} onChange={p.onBoardChoice} options={p.boardOptions} aria-label={t("keymaps.ui.board")} />
      </div>

      <div className="keymaps-board">
        <KeyboardView
          keys={board.keys}
          size={board.size}
          colors={view.colors}
          legends={view.legends}
          badges={view.badges}
          dim={view.dim}
          selected={selected ? [selected] : []}
          onKeyClick={(code) => setSelected((s) => (s === code ? null : code))}
          glow={0.75}
        />
      </div>

      <div className="keymaps-below">
        <Card
          title={t("keymaps.categories")}
          actions={
            <Button size="sm" variant="ghost" icon={<Settings2 />} onClick={p.onManageCategories}>
              {t("keymaps.ui.manage")}
            </Button>
          }
        >
          {Object.keys(pack.categories).length === 0 ? (
            <p className="keymaps-note">{t("keymaps.ui.noCategories")}</p>
          ) : (
            <div className="keymaps-cats">
              {Object.entries(pack.categories).map(([name, color]) => (
                <CategoryChip
                  key={name}
                  name={name}
                  color={color}
                  count={catCounts[name] ?? 0}
                  active={pinCat === name}
                  onHover={(on) => setHoverCat(on ? name : null)}
                  onClick={() => setPinCat((c) => (c === name ? null : name))}
                  onColor={(c) => p.onCategoryColor(name, c)}
                />
              ))}
            </div>
          )}
        </Card>
        <KeyInspector
          pack={pack}
          code={selected}
          keyDef={board.keys.find((k) => k.code === selected)}
          layer={layer}
          mods={parseMods(mods)}
          layerName={layerName}
          onAddBinding={p.onAddBinding}
          onEditBinding={p.onEditBinding}
          onAddLegend={p.onAddLegend}
          onEditLegend={p.onEditLegend}
        />
      </div>
    </div>
  );
}

function CategoryChip({
  name,
  color,
  count,
  active,
  onHover,
  onClick,
  onColor,
}: {
  name: string;
  color: string;
  count: number;
  active: boolean;
  onHover: (on: boolean) => void;
  onClick: () => void;
  onColor: (c: string) => void;
}) {
  const [local, setLocal] = useState(color);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setLocal(color), [color]);
  return (
    <div className={cx("keymaps-cat", active && "is-active")} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <label className="keymaps-cat__swatch" style={{ background: local }} title={local}>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(local) ? local : "#888888"}
          onChange={(e) => {
            const v = e.target.value;
            setLocal(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => onColor(v), 350);
          }}
        />
      </label>
      <button type="button" className="keymaps-cat__name" onClick={onClick}>
        {name}
        <span className="keymaps-cat__count">{count}</span>
      </button>
    </div>
  );
}

function KeyInspector({
  pack,
  code,
  keyDef,
  layer,
  mods,
  layerName,
  onAddBinding,
  onEditBinding,
  onAddLegend,
  onEditLegend,
}: {
  pack: KeymapPack;
  code: string | null;
  keyDef?: KeyDef;
  layer: string;
  mods: ModifierName[];
  layerName: (id: string) => string;
  onAddBinding: (layer: string, key: string, mods: ModifierName[]) => void;
  onEditBinding: (layer: string, index: number) => void;
  onAddLegend: (legend: ShortcutLegend) => void;
  onEditLegend: (index: number) => void;
}) {
  const t = useT();
  if (!code) {
    return (
      <Card title={t("keymaps.ui.inspector.title")}>
        <div className="keymaps-inspector-empty">
          <MousePointerClick />
          <div>{t("keymaps.ui.inspector.empty")}</div>
        </div>
      </Card>
    );
  }
  const legends = pack.legends.map((l, i) => ({ l, i })).filter(({ l }) => comboFromKeys(l.keys)?.key === code);
  const bindings: { layer: string; index: number; b: KeyBinding }[] = [];
  pack.bindings.forEach((b, i) => b.key === code && bindings.push({ layer: "", index: i, b }));
  (pack.layers ?? []).forEach((ly) => ly.bindings.forEach((b, i) => b.key === code && bindings.push({ layer: ly.id, index: i, b })));
  const color = (cat?: string) => (cat ? pack.categories[cat] : undefined);

  return (
    <Card
      title={
        <span className="row" style={{ gap: 10 }}>
          <span className="keymaps-inspector-key">{keyDef?.label || keyLabel(code)}</span>
          <span className="mono subtle" style={{ fontWeight: 400, fontSize: 12 }}>
            {code}
          </span>
        </span>
      }
      actions={
        <>
          <Button
            size="sm"
            icon={<Plus />}
            onClick={() =>
              onAddLegend({
                keys: [...mods.map(modifierCode), code],
                label: "",
                category: Object.keys(pack.categories)[0] ?? "",
              })
            }
          >
            {t("keymaps.ui.inspector.addLegend")}
          </Button>
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => onAddBinding(layer, code, layer ? [] : mods)}>
            {t("keymaps.ui.inspector.addRemap")}
          </Button>
        </>
      }
      flush
    >
      {legends.length === 0 && bindings.length === 0 ? (
        <div className="keymaps-inspector-empty" style={{ padding: 20 }}>
          <div>{t("keymaps.ui.inspector.nothing")}</div>
        </div>
      ) : (
        <div className="keymaps-inspector-list">
          {bindings.map(({ layer: ly, index, b }) => (
            <button key={`b${ly}${index}`} type="button" className="keymaps-irow" onClick={() => onEditBinding(ly, index)}>
              <Combo parts={bindingParts(b)} />
              <span className="keymaps-irow__icon">{ACTION_ICONS[b.action.type]}</span>
              <span className="keymaps-irow__text">
                <span>{b.label || actionSummary(t, b.action, layerName)}</span>
                <span className="subtle">
                  {t("keymaps.ui.inspector.remap")}
                  {ly ? ` · ${layerName(ly)}` : ""}
                </span>
              </span>
              {color(b.category) && <span className="keymaps-dot" style={{ background: color(b.category) }} />}
              <Pencil className="keymaps-irow__edit" />
            </button>
          ))}
          {legends.map(({ l, i }) => (
            <button key={`l${i}`} type="button" className="keymaps-irow" onClick={() => onEditLegend(i)}>
              <Combo parts={keysParts(l.keys)} />
              <span className="keymaps-irow__text">
                <span>{l.label}</span>
                <span className="subtle">{l.category}</span>
              </span>
              {color(l.category) && <span className="keymaps-dot" style={{ background: color(l.category) }} />}
              <Pencil className="keymaps-irow__edit" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
