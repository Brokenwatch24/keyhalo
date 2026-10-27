import { useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Copy, Download, Eye, Info, Layers as LayersIcon, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Segmented, Select, TextArea } from "@/ui";
import { useT } from "@/i18n";
import type { KeyBinding, KeymapPack } from "@/core/types";
import { useKeymaps, type Conflict } from "@/core/keymaps";
import { Combo } from "./KeyRecorder";
import { ACTION_ICONS } from "./ActionEditor";
import { actionSummary, bindingParts, clonePack, copyText, downloadText, keysParts, slugify, uniqueId, type Translate } from "./util";

const layerNameOf = (pack: KeymapPack) => (id: string) => pack.layers?.find((l) => l.id === id)?.name ?? id;

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

export function BindingsTab({ pack, onAdd, onEdit }: { pack: KeymapPack; onAdd: (layer: string) => void; onEdit: (layer: string, index: number) => void }) {
  const t = useT();
  const groups: { id: string; name: string; bindings: KeyBinding[] }[] = [
    { id: "", name: t("keymaps.hud.baseLayer"), bindings: pack.bindings },
    ...(pack.layers ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      bindings: l.bindings,
    })),
  ];
  const total = groups.reduce((n, g) => n + g.bindings.length, 0);
  const layerName = layerNameOf(pack);

  if (total === 0)
    return (
      <Card>
        <EmptyState
          icon={<LayersIcon />}
          title={t("keymaps.ui.bindingsTab.emptyTitle")}
          action={
            <Button variant="primary" icon={<Plus />} onClick={() => onAdd("")}>
              {t("keymaps.ui.inspector.addRemap")}
            </Button>
          }
        >
          {t("keymaps.ui.bindingsTab.emptyText")}
        </EmptyState>
      </Card>
    );

  return (
    <div className="col" style={{ gap: 16 }}>
      {groups.map((g) => (
        <Card
          key={g.id || "base"}
          flush
          title={
            <span className="row">
              {g.name}
              <span className="subtle" style={{ fontWeight: 400 }}>
                {g.bindings.length}
              </span>
            </span>
          }
          actions={
            <Button size="sm" icon={<Plus />} onClick={() => onAdd(g.id)}>
              {t("common.add")}
            </Button>
          }
        >
          {g.bindings.length === 0 ? (
            <div className="keymaps-table-empty">{t("keymaps.ui.bindingsTab.layerEmpty")}</div>
          ) : (
            <table className="keymaps-table">
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>{t("keymaps.ui.binding.trigger")}</th>
                  <th>{t("keymaps.ui.binding.action")}</th>
                  <th style={{ width: "24%" }}>{t("keymaps.ui.binding.label")}</th>
                  <th style={{ width: "16%" }}>{t("keymaps.ui.binding.category")}</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {g.bindings.map((b, i) => (
                  <tr key={i} className="is-clickable" onClick={() => onEdit(g.id, i)}>
                    <td>
                      <Combo parts={bindingParts(b)} />
                    </td>
                    <td>
                      <span className="keymaps-action-cell">
                        {ACTION_ICONS[b.action.type]}
                        <span className="keymaps-action-cell__type">{t(`keymaps.ui.actions.${b.action.type}`)}</span>
                        <span className="keymaps-action-cell__sum">{actionSummary(t, b.action, layerName)}</span>
                      </span>
                    </td>
                    <td className="muted">{b.label ?? <span className="subtle">—</span>}</td>
                    <td>{b.category ? <CategoryTag name={b.category} color={pack.categories[b.category]} /> : <span className="subtle">—</span>}</td>
                    <td>
                      <Pencil className="keymaps-row-edit" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  );
}

export function CategoryTag({ name, color }: { name: string; color?: string }) {
  return (
    <span className="keymaps-cattag">
      <span className="keymaps-dot" style={{ background: color ?? "var(--text-3)" }} />
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legends
// ---------------------------------------------------------------------------

export function LegendsTab({ pack, onAdd, onEdit }: { pack: KeymapPack; onAdd: () => void; onEdit: (index: number) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pack.legends
      .map((l, i) => ({ l, i, parts: keysParts(l.keys) }))
      .filter(
        ({ l, parts }) => (!cat || l.category === cat) && (!needle || l.label.toLowerCase().includes(needle) || parts.join("+").toLowerCase().includes(needle)),
      );
  }, [pack.legends, q, cat]);

  return (
    <Card
      flush
      title={
        <span className="row">
          {t("keymaps.legends")}
          <span className="subtle" style={{ fontWeight: 400 }}>
            {pack.legends.length}
          </span>
        </span>
      }
      actions={
        <>
          <div className="keymaps-search">
            <Search />
            <Input value={q} placeholder={t("common.search")} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select
            value={cat}
            onChange={setCat}
            options={[
              { value: "", label: t("keymaps.ui.allCategories") },
              ...Object.keys(pack.categories).map((c) => ({
                value: c,
                label: c,
              })),
            ]}
            style={{ width: 150 }}
          />
          <Button size="sm" variant="primary" icon={<Plus />} onClick={onAdd}>
            {t("common.add")}
          </Button>
        </>
      }
    >
      {pack.legends.length === 0 ? (
        <EmptyState title={t("keymaps.ui.legendsTab.emptyTitle")}>{t("keymaps.ui.legendsTab.emptyText")}</EmptyState>
      ) : rows.length === 0 ? (
        <div className="keymaps-table-empty">{t("keymaps.ui.noMatches")}</div>
      ) : (
        <table className="keymaps-table">
          <thead>
            <tr>
              <th style={{ width: "28%" }}>{t("keymaps.ui.legend.keys")}</th>
              <th>{t("keymaps.ui.binding.label")}</th>
              <th style={{ width: "20%" }}>{t("keymaps.ui.binding.category")}</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, i, parts }) => (
              <tr key={i} className="is-clickable" onClick={() => onEdit(i)}>
                <td>
                  <Combo parts={parts} />
                </td>
                <td>{l.label}</td>
                <td>
                  <CategoryTag name={l.category} color={pack.categories[l.category]} />
                </td>
                <td>
                  <Pencil className="keymaps-row-edit" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export function LayersTab({ pack, onSave, onShow }: { pack: KeymapPack; onSave: (p: KeymapPack) => Promise<boolean>; onShow: (layer: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const layers = pack.layers ?? [];

  const activators = (id: string) =>
    pack.bindings.filter((b) => {
      const a = b.action;
      return (
        (a.type === "layer" && a.layer === id) ||
        (a.type === "tapHold" && ((a.hold.type === "layer" && a.hold.layer === id) || (a.tap.type === "layer" && a.tap.layer === id)))
      );
    });

  const add = async () => {
    if (!name.trim()) return;
    const next = clonePack(pack);
    const id = uniqueId(
      slugify(name, "layer"),
      layers.map((l) => l.id),
    );
    next.layers = [...(next.layers ?? []), { id, name: name.trim(), bindings: [] }];
    if (await onSave(next)) setName("");
  };
  const rename = (id: string, value: string) => {
    const next = clonePack(pack);
    const l = next.layers?.find((x) => x.id === id);
    if (l && value.trim()) {
      l.name = value.trim();
      void onSave(next);
    }
  };
  const remove = (id: string) => {
    const next = clonePack(pack);
    next.layers = (next.layers ?? []).filter((l) => l.id !== id);
    if (!next.layers.length) delete next.layers;
    void onSave(next);
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title={t("keymaps.layers")} subtitle={t("keymaps.ui.layersTab.intro")}>
        <div className="row">
          <Input
            value={name}
            placeholder={t("keymaps.ui.layersTab.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            style={{ maxWidth: 280 }}
          />
          <Button icon={<Plus />} onClick={add} disabled={!name.trim()}>
            {t("keymaps.ui.layersTab.add")}
          </Button>
        </div>
      </Card>
      {layers.length === 0 ? (
        <Card>
          <EmptyState icon={<LayersIcon />} title={t("keymaps.ui.layersTab.emptyTitle")}>
            {t("keymaps.ui.layersTab.emptyText")}
          </EmptyState>
        </Card>
      ) : (
        <div className="keymaps-layer-grid">
          {layers.map((l) => {
            const acts = activators(l.id);
            return (
              <Card key={l.id} className="keymaps-layer">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div className="grow col" style={{ gap: 4 }}>
                    <Input defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && rename(l.id, e.target.value)} className="keymaps-layer__name" />
                    <span className="mono subtle" style={{ fontSize: 11 }}>
                      id: {l.id}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title={t("common.delete")} onClick={() => remove(l.id)} />
                </div>
                <div className="keymaps-layer__meta">
                  <div>
                    <span className="subtle">{t("keymaps.ui.layersTab.bindings")}</span>
                    <strong>{l.bindings.length}</strong>
                  </div>
                  <div>
                    <span className="subtle">{t("keymaps.ui.layersTab.activatedBy")}</span>
                    {acts.length ? (
                      <span className="row wrap" style={{ gap: 6 }}>
                        {acts.map((b, i) => (
                          <Combo key={i} parts={bindingParts(b)} />
                        ))}
                      </span>
                    ) : (
                      <span className="keymaps-warn-text">
                        <AlertTriangle size={13} /> {t("keymaps.ui.layersTab.unreachable")}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" icon={<Eye />} onClick={() => onShow(l.id)}>
                  {t("keymaps.ui.layersTab.show")}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export function conflictText(t: Translate, c: Conflict) {
  const s = t(c.messageKey, c.params);
  return s === c.messageKey ? c.message : s;
}

export function ConflictsTab({
  pack,
  conflicts,
  keyboardName,
  onEdit,
}: {
  pack: KeymapPack;
  conflicts: Conflict[];
  keyboardName: string;
  onEdit: (layer: string, binding: KeyBinding) => void;
}) {
  const t = useT();
  const layerName = layerNameOf(pack);
  if (conflicts.length === 0)
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 />} title={t("keymaps.conflicts.none")}>
          {t("keymaps.ui.conflictsTab.clean", { keyboard: keyboardName })}
        </EmptyState>
      </Card>
    );
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...conflicts].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <Card
      flush
      title={t("keymaps.conflicts.title")}
      subtitle={t("keymaps.ui.conflictsTab.checked", {
        keyboard: keyboardName,
      })}
    >
      <div className="keymaps-conflicts">
        {sorted.map((c, i) => (
          <div key={i} className={`keymaps-conflict keymaps-conflict--${c.severity}`}>
            <span className="keymaps-conflict__icon">
              {c.severity === "error" ? <AlertOctagon /> : c.severity === "warning" ? <AlertTriangle /> : <Info />}
            </span>
            <div className="grow col" style={{ gap: 4 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <Badge tone={c.severity === "error" ? "danger" : c.severity === "warning" ? "warning" : "info"}>{t(`keymaps.ui.severity.${c.severity}`)}</Badge>
                <Combo parts={bindingParts(c.binding)} />
                {c.layer && <span className="subtle">{layerName(c.layer)}</span>}
              </div>
              <div>{conflictText(t, c)}</div>
              {c.suggestionKey && <div className="subtle">{t(c.suggestionKey)}</div>}
            </div>
            <Button size="sm" onClick={() => onEdit(c.layer, c.binding)}>
              {t("common.edit")}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

type ExportFormat = "json" | "kanata" | "ahk";

export function ExportTab({ pack }: { pack: KeymapPack }) {
  const t = useT();
  const [fmt, setFmt] = useState<ExportFormat>("json");
  const out = useMemo(() => {
    const s = useKeymaps.getState();
    if (fmt === "json")
      return {
        text: s.exportPack(pack.id) || JSON.stringify(pack, null, 2),
        warnings: [] as string[],
        file: `${pack.id}.json`,
        mime: "application/json",
      };
    if (fmt === "kanata") {
      const r = s.exportKanata(pack.id);
      return {
        text: r?.text ?? "",
        warnings: r?.warnings ?? [],
        file: `${pack.id}.kbd`,
        mime: "text/plain",
      };
    }
    const r = s.exportAutoHotkey(pack.id);
    return {
      text: r?.text ?? "",
      warnings: r?.warnings ?? [],
      file: `${pack.id}.ahk`,
      mime: "text/plain",
    };
  }, [fmt, pack]);

  return (
    <Card
      title={t("common.export")}
      subtitle={t(`keymaps.ui.exportTab.${fmt}Hint`)}
      actions={
        <>
          <Button size="sm" icon={<Copy />} onClick={() => copyText(out.text, t("common.copied"))}>
            {t("common.copy")}
          </Button>
          <Button size="sm" icon={<Download />} onClick={() => downloadText(out.file, out.text, out.mime)}>
            {out.file}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Segmented
          value={fmt}
          onChange={setFmt}
          options={[
            { value: "json", label: "JSON" },
            { value: "kanata", label: "Kanata (.kbd)" },
            { value: "ahk", label: "AutoHotkey v2" },
          ]}
        />
        {out.warnings.length > 0 && (
          <div className="keymaps-callout keymaps-callout--warn">
            <AlertTriangle />
            <div>
              <div style={{ fontWeight: 500 }}>{t("keymaps.exportWarnings")}</div>
              <ul className="keymaps-ul">
                {out.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <TextArea readOnly value={out.text} rows={18} className="keymaps-code" spellCheck={false} />
      </div>
    </Card>
  );
}
