import { useMemo, useState, type ReactNode } from "react";
import { Copy, FileDown, Keyboard, Pause, Pencil, Play, Plus, RotateCcw, Search, Share2, ShieldAlert, Trash2, Wand2 } from "lucide-react";
import { Badge, Button, Card, Input, Page, Tabs, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { useRoute } from "@/app/router";
import type { KeyBinding, KeymapPack, ModifierName, ShortcutLegend } from "@/core/types";
import { TEMPLATES, layoutOf, primaryKeyboard, useDevices } from "@/core/devices";
import { useSettings } from "@/core/state/settings";
import { findConflicts, packHasRemaps, riskyActions, useKeymaps, type RiskItem } from "@/core/keymaps";
import { useCommunity } from "@/core/community";
import { KeyboardTab, type Board } from "./KeyboardTab";
import { BindingsTab, ConflictsTab, ExportTab, LayersTab, LegendsTab } from "./Tabs";
import { BindingEditor, LegendEditor, type BindingTarget } from "./Editors";
import { CategoriesModal, ConfirmModal, ImportModal, PackDetailsModal, PauseAppsModal, RiskReviewModal } from "./Modals";
import { clonePack, copyText, cx, initialOf, uniqueId, useThemeQuery } from "./util";
import "./keymaps.css";

type Tab = "keyboard" | "bindings" | "legends" | "layers" | "conflicts" | "export";

type ModalState =
  | { kind: "binding"; target: BindingTarget }
  | { kind: "legend"; index: number | null; initial: ShortcutLegend }
  | { kind: "details"; pack: KeymapPack; isNew: boolean }
  | { kind: "categories" }
  | { kind: "import" }
  | { kind: "pauseApps" }
  | { kind: "risk"; pack: KeymapPack; items: RiskItem[] }
  | { kind: "delete"; pack: KeymapPack; reset: boolean }
  | null;

const BOARD_TEMPLATES = ["ansi-100", "ansi-tkl", "ansi-75", "ansi-65", "ansi-60", "iso-100"] as const;

export default function KeymapsSection() {
  useThemeQuery();
  const t = useT();
  const route = useRoute();
  const packs = useKeymaps((s) => s.packs);
  const enabledIds = useKeymaps((s) => s.enabledIds);
  const activePackId = useKeymaps((s) => s.activePackId);
  const store = useKeymaps();
  const devices = useDevices((s) => s.devices);

  const [selId, setSelId] = useState<string | null>(route[1] ?? null);
  const [tab, setTab] = useState<Tab>("keyboard");
  const [layer, setLayer] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [query, setQuery] = useState("");

  const pack = packs.find((p) => p.id === selId) ?? packs.find((p) => p.id === activePackId) ?? packs.find((p) => p.id === "vscode") ?? packs[0];

  // Keyboard drawing: the connected keyboard, or a template.
  const kb = primaryKeyboard(devices);
  const kbLayout = kb ? layoutOf(kb) : undefined;
  const [boardPick, setBoardPick] = useState<string | null>(null);
  const boardChoice = boardPick ?? (kb && kbLayout ? "device" : "ansi-tkl");
  const board: Board = useMemo(() => {
    if (boardChoice === "device" && kb && kbLayout)
      return {
        keys: kbLayout.keys,
        size: kb.definition.size,
        layout: kbLayout,
        name: kb.definition.name,
      };
    const tpl = TEMPLATES[boardChoice] ?? TEMPLATES["ansi-tkl"];
    return {
      keys: tpl.layout.keys,
      size: tpl.size,
      layout: tpl.layout,
      name: tpl.layout.name,
    };
  }, [boardChoice, kb, kbLayout]);
  const boardOptions = [
    ...(kb && kbLayout ? [{ value: "device", label: kb.definition.name }] : []),
    ...BOARD_TEMPLATES.map((id) => ({
      value: id,
      label: t(`keymaps.ui.boards.${id}`),
    })),
  ];

  const conflicts = useMemo(
    () =>
      pack
        ? findConflicts(pack, {
            layout: board.layout,
            keyboardName: board.name,
          })
        : [],
    [pack, board],
  );

  const save = async (p: KeymapPack) => {
    try {
      await store.savePack(p);
      return true;
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "danger");
      return false;
    }
  };

  const select = (id: string) => {
    setSelId(id);
    setLayer("");
  };

  const newPack = () =>
    setModal({
      kind: "details",
      pack: blankPack(
        packs.map((p) => p.id),
        t,
      ),
      isNew: true,
    });

  if (!pack) {
    return (
      <Page title={t("keymaps.title")}>
        <Card>
          <Button icon={<Plus />} onClick={newPack}>
            {t("keymaps.ui.newPack")}
          </Button>
        </Card>
      </Page>
    );
  }

  const source = store.sourceOf(pack.id);
  const isEdited = source === "user" && store.bundled.some((b) => b.id === pack.id);
  const enabled = enabledIds.includes(pack.id);
  const bindingCount = pack.bindings.length + (pack.layers ?? []).reduce((n, l) => n + l.bindings.length, 0);
  const worst = conflicts.some((c) => c.severity === "error") ? "danger" : conflicts.some((c) => c.severity === "warning") ? "warning" : "info";

  const setEnabled = (p: KeymapPack, on: boolean) => {
    const risky = on && store.sourceOf(p.id) === "installed" ? riskyActions(p) : [];
    if (risky.length) setModal({ kind: "risk", pack: p, items: risky });
    else store.toggle(p.id, on);
  };

  const openBinding = (ly: string, index: number) => {
    const list = ly ? pack.layers?.find((l) => l.id === ly)?.bindings : pack.bindings;
    const b = list?.[index];
    if (b) setModal({ kind: "binding", target: { layer: ly, index, draft: b } });
  };
  const addBinding = (ly: string, key = "", mods: ModifierName[] = []) =>
    setModal({
      kind: "binding",
      target: {
        layer: ly,
        index: null,
        draft: {
          key,
          with: mods.length ? mods : undefined,
          action: { type: "key", keys: [] },
        },
      },
    });
  const editByRef = (ly: string, b: KeyBinding) => {
    const list = ly ? pack.layers?.find((l) => l.id === ly)?.bindings : pack.bindings;
    const index = list?.indexOf(b) ?? -1;
    if (index >= 0) openBinding(ly, index);
  };

  const duplicate = async () => {
    const copy = await store.duplicatePack(pack.id).catch((e) => {
      toast(String((e as Error)?.message ?? e), "danger");
      return null;
    });
    if (copy) {
      select(copy.id);
      toast(t("keymaps.ui.duplicated", { name: copy.name }));
    }
  };

  const share = async () => {
    const community = useCommunity.getState();
    if (community.auth.status === "signedIn") {
      try {
        const r = await community.shareGist("keymap", pack);
        await copyText(r.gistUrl, t("keymaps.ui.share.gist"));
        return;
      } catch (e) {
        toast(String((e as Error)?.message ?? e), "danger");
      }
    }
    await copyText(store.exportPack(pack.id), t("keymaps.ui.share.json"));
  };

  const tabs: { value: Tab; label: ReactNode }[] = [
    { value: "keyboard", label: t("keymaps.ui.tabs.keyboard") },
    {
      value: "bindings",
      label: <TabLabel text={t("keymaps.bindings")} n={bindingCount} />,
    },
    {
      value: "legends",
      label: <TabLabel text={t("keymaps.legends")} n={pack.legends.length} />,
    },
    {
      value: "layers",
      label: <TabLabel text={t("keymaps.layers")} n={pack.layers?.length ?? 0} />,
    },
    {
      value: "conflicts",
      label: (
        <span className="row" style={{ gap: 6 }}>
          {t("keymaps.conflicts.title")}
          {conflicts.length > 0 && <span className={`keymaps-tabcount keymaps-tabcount--${worst}`}>{conflicts.length}</span>}
        </span>
      ),
    },
    { value: "export", label: t("common.export") },
  ];

  return (
    <Page
      title={t("keymaps.title")}
      description={t("keymaps.ui.description")}
      actions={
        <>
          <Button icon={<FileDown />} onClick={() => setModal({ kind: "import" })}>
            {t("common.import")}
          </Button>
          <Button variant="primary" icon={<Plus />} onClick={newPack}>
            {t("keymaps.ui.newPack")}
          </Button>
        </>
      }
    >
      <div className="keymaps-layout">
        <aside className="keymaps-side">
          <StatusCard onSelect={select} onPauseApps={() => setModal({ kind: "pauseApps" })} />
          <PackList packs={packs} selected={pack.id} query={query} onQuery={setQuery} onSelect={select} onToggle={setEnabled} />
          <div className="keymaps-emergency">
            <ShieldAlert />
            <span>{t("keymaps.ui.emergencyShort")}</span>
          </div>
        </aside>

        <div className="keymaps-main">
          <div className="keymaps-packhead">
            <div className="keymaps-appicon keymaps-appicon--lg">{initialOf(pack.name)}</div>
            <div className="grow col" style={{ gap: 4, minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <h2 className="keymaps-packhead__name">{pack.name}</h2>
                <SourceBadges source={source} edited={isEdited} />
                {!packHasRemaps(pack) && <Badge>{t("keymaps.legendOnly")}</Badge>}
              </div>
              {pack.description && <p className="keymaps-packhead__desc">{pack.description}</p>}
              <div className="keymaps-packhead__meta">
                {pack.apps.length ? pack.apps.map((a) => <code key={a}>{a}</code>) : <span>{t("keymaps.global")}</span>}
                {pack.author && <span>· {pack.author}</span>}
                {pack.version && <span>· v{pack.version}</span>}
              </div>
            </div>
            <div className="keymaps-packhead__actions">
              <Toggle checked={enabled} onChange={(on) => setEnabled(pack, on)} label={t("keymaps.enabled")} />
              <span className="keymaps-vsep" />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Pencil />}
                title={t("keymaps.ui.details.editTitle")}
                onClick={() => setModal({ kind: "details", pack, isNew: false })}
              />
              <Button size="sm" variant="ghost" iconOnly icon={<Copy />} title={t("common.duplicate")} onClick={duplicate} />
              <Button size="sm" variant="ghost" iconOnly icon={<Share2 />} title={t("common.share")} onClick={share} />
              {source !== "bundled" && (
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={isEdited ? <RotateCcw /> : <Trash2 />}
                  title={isEdited ? t("keymaps.ui.reset") : t("common.delete")}
                  onClick={() => setModal({ kind: "delete", pack, reset: isEdited })}
                />
              )}
            </div>
          </div>

          <Tabs value={tab} onChange={setTab} tabs={tabs} />

          <div className="keymaps-tabbody">
            {tab === "keyboard" && (
              <KeyboardTab
                pack={pack}
                board={board}
                boardChoice={boardChoice}
                boardOptions={boardOptions}
                onBoardChoice={setBoardPick}
                layer={pack.layers?.some((l) => l.id === layer) ? layer : ""}
                onLayer={setLayer}
                onAddBinding={addBinding}
                onEditBinding={openBinding}
                onAddLegend={(initial) => setModal({ kind: "legend", index: null, initial })}
                onEditLegend={(index) =>
                  setModal({
                    kind: "legend",
                    index,
                    initial: pack.legends[index],
                  })
                }
                onCategoryColor={(cat, color) => {
                  const next = clonePack(pack);
                  next.categories[cat] = color;
                  void save(next);
                }}
                onManageCategories={() => setModal({ kind: "categories" })}
              />
            )}
            {tab === "bindings" && <BindingsTab pack={pack} onAdd={(ly) => addBinding(ly)} onEdit={openBinding} />}
            {tab === "legends" && (
              <LegendsTab
                pack={pack}
                onAdd={() =>
                  setModal({
                    kind: "legend",
                    index: null,
                    initial: {
                      keys: [],
                      label: "",
                      category: Object.keys(pack.categories)[0] ?? "",
                    },
                  })
                }
                onEdit={(index) =>
                  setModal({
                    kind: "legend",
                    index,
                    initial: pack.legends[index],
                  })
                }
              />
            )}
            {tab === "layers" && (
              <LayersTab
                pack={pack}
                onSave={save}
                onShow={(ly) => {
                  setLayer(ly);
                  setTab("keyboard");
                }}
              />
            )}
            {tab === "conflicts" && <ConflictsTab pack={pack} conflicts={conflicts} keyboardName={board.name} onEdit={editByRef} />}
            {tab === "export" && <ExportTab pack={pack} />}
          </div>
        </div>
      </div>

      {modal?.kind === "binding" && <BindingEditor pack={pack} target={modal.target} layout={board.layout} onClose={() => setModal(null)} onSave={save} />}
      {modal?.kind === "legend" && <LegendEditor pack={pack} index={modal.index} initial={modal.initial} onClose={() => setModal(null)} onSave={save} />}
      {modal?.kind === "details" && (
        <PackDetailsModal
          pack={modal.pack}
          isNew={modal.isNew}
          onClose={() => setModal(null)}
          onSave={async (p) => {
            const ok = await save(p);
            if (ok && modal.isNew) {
              select(p.id);
              setTab("keyboard");
            }
            return ok;
          }}
        />
      )}
      {modal?.kind === "categories" && <CategoriesModal pack={pack} onClose={() => setModal(null)} onSave={save} />}
      {modal?.kind === "import" && <ImportModal onClose={() => setModal(null)} onImported={(id) => select(id)} />}
      {modal?.kind === "pauseApps" && <PauseAppsModal onClose={() => setModal(null)} />}
      {modal?.kind === "risk" && (
        <RiskReviewModal
          pack={modal.pack}
          items={modal.items}
          onClose={() => setModal(null)}
          onConfirm={() => {
            store.toggle(modal.pack.id, true);
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "delete" && (
        <ConfirmModal
          title={modal.reset ? t("keymaps.ui.reset") : t("keymaps.ui.deleteTitle")}
          body={modal.reset ? t("keymaps.ui.resetBody", { name: modal.pack.name }) : t("keymaps.ui.deleteBody", { name: modal.pack.name })}
          confirm={modal.reset ? t("keymaps.ui.reset") : t("common.delete")}
          onClose={() => setModal(null)}
          onConfirm={() => {
            void store.deletePack(modal.pack.id);
            if (!modal.reset) setSelId(null);
          }}
        />
      )}
    </Page>
  );
}

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {text}
      <span className="keymaps-tabcount">{n}</span>
    </span>
  );
}

function blankPack(taken: string[], t: (k: string) => string): KeymapPack {
  return {
    id: uniqueId("my-pack", taken),
    name: t("keymaps.ui.details.defaultName"),
    apps: [],
    categories: { [t("keymaps.ui.details.defaultCategory")]: "#5aa9ff" },
    legends: [],
    bindings: [],
  };
}

function SourceBadges({ source, edited }: { source: string | null; edited: boolean }) {
  const t = useT();
  if (edited)
    return (
      <>
        <Badge>{t("keymaps.source.bundled")}</Badge>
        <Badge tone="info">{t("keymaps.ui.edited")}</Badge>
      </>
    );
  if (source === "user") return <Badge tone="info">{t("keymaps.source.user")}</Badge>;
  if (source === "installed") return <Badge tone="success">{t("keymaps.source.installed")}</Badge>;
  return <Badge>{t("keymaps.source.bundled")}</Badge>;
}

// ---------------------------------------------------------------------------
// Left column
// ---------------------------------------------------------------------------

function StatusCard({ onSelect, onPauseApps }: { onSelect: (id: string) => void; onPauseApps: () => void }) {
  const t = useT();
  const foreground = useKeymaps((s) => s.foreground);
  const activePackId = useKeymaps((s) => s.activePackId);
  const paused = useKeymaps((s) => s.paused);
  const setPaused = useKeymaps((s) => s.setPaused);
  const activePack = useKeymaps((s) => s.packs.find((p) => p.id === s.activePackId));
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const pausedByApp = Boolean(foreground && settings.remapPauseApps.some((a) => a.toLowerCase() === foreground.toLowerCase()));
  const state = !settings.remapEnabled ? "off" : paused ? "paused" : pausedByApp ? "game" : "on";

  return (
    <Card className="keymaps-status">
      <div className="keymaps-now">
        <span className="keymaps-now__label">{t("keymaps.ui.nowIn")}</span>
        <div className="keymaps-now__row">
          <span className="keymaps-appicon">{initialOf(foreground ?? "?")}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="keymaps-now__proc mono">{foreground ?? t("keymaps.ui.noForeground")}</div>
            {activePack ? (
              <button type="button" className="keymaps-now__pack" onClick={() => activePackId && onSelect(activePackId)}>
                → {activePack.name}
              </button>
            ) : (
              <div className="subtle" style={{ fontSize: 12 }}>
                {t("keymaps.ui.noActivePack")}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="keymaps-status__rows">
        <div className="keymaps-status__row">
          <div className="grow">
            <div>{t("keymaps.ui.remapping")}</div>
            <div className={cx("keymaps-state", `keymaps-state--${state}`)}>
              <span className="kh-dot" />
              {t(`keymaps.ui.state.${state}`)}
            </div>
          </div>
          <Toggle checked={settings.remapEnabled} onChange={(remapEnabled) => update({ remapEnabled })} />
        </div>
        <div className="keymaps-status__row">
          <div className="grow">
            <div>{t("keymaps.cheatsheet")}</div>
            <div className="subtle" style={{ fontSize: 12 }}>
              {t("keymaps.ui.cheatsheetShort")}
            </div>
          </div>
          <Toggle checked={settings.cheatsheet} onChange={(cheatsheet) => update({ cheatsheet })} />
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" icon={paused ? <Play /> : <Pause />} onClick={() => setPaused(!paused)} disabled={!settings.remapEnabled} style={{ flex: 1 }}>
            {paused ? t("keymaps.resume") : t("keymaps.pause")}
          </Button>
          <Button size="sm" icon={<ShieldAlert />} onClick={onPauseApps} style={{ flex: 1 }} title={t("keymaps.ui.pauseApps.title")}>
            {t("keymaps.ui.pauseApps.button", {
              n: settings.remapPauseApps.length,
            })}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PackList({
  packs,
  selected,
  query,
  onQuery,
  onSelect,
  onToggle,
}: {
  packs: KeymapPack[];
  selected: string;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onToggle: (p: KeymapPack, on: boolean) => void;
}) {
  const t = useT();
  const enabledIds = useKeymaps((s) => s.enabledIds);
  const activeIds = useKeymaps((s) => s.activePackIds);
  const foreground = useKeymaps((s) => s.foreground);
  const sourceOf = useKeymaps((s) => s.sourceOf);
  const bundled = useKeymaps((s) => s.bundled);

  const needle = query.trim().toLowerCase();
  const visible = packs.filter(
    (p) => !needle || p.name.toLowerCase().includes(needle) || p.apps.some((a) => a.toLowerCase().includes(needle)) || p.tags?.some((x) => x.includes(needle)),
  );
  const active = activeIds.map((id) => visible.find((p) => p.id === id)).filter((p): p is KeymapPack => Boolean(p));
  const enabled = visible.filter((p) => enabledIds.includes(p.id) && !activeIds.includes(p.id));
  const library = visible.filter((p) => !enabledIds.includes(p.id));

  const groups = [
    {
      id: "active",
      title: foreground ? t("keymaps.activeFor", { app: foreground }) : t("keymaps.ui.groups.active"),
      list: active,
    },
    { id: "enabled", title: t("keymaps.ui.groups.enabled"), list: enabled },
    { id: "library", title: t("keymaps.ui.groups.library"), list: library },
  ].filter((g) => g.list.length);

  return (
    <Card flush className="keymaps-packs">
      <div className="keymaps-packs__search">
        <Search />
        <Input value={query} placeholder={t("keymaps.ui.searchPacks")} onChange={(e) => onQuery(e.target.value)} />
      </div>
      {groups.length === 0 && <div className="keymaps-table-empty">{t("keymaps.ui.noMatches")}</div>}
      {groups.map((g) => (
        <div key={g.id} className="keymaps-packs__group">
          <div className="keymaps-packs__heading">
            <span>{g.title}</span>
            <span>{g.list.length}</span>
          </div>
          {g.list.map((p) => {
            const src = sourceOf(p.id);
            const edited = src === "user" && bundled.some((b) => b.id === p.id);
            const srcLabel = edited ? t("keymaps.ui.edited") : t(`keymaps.source.${src ?? "bundled"}`);
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                className={cx("keymaps-packrow", p.id === selected && "is-selected")}
                onClick={() => onSelect(p.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onSelect(p.id)}
              >
                <span className="keymaps-appicon">{initialOf(p.name)}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="keymaps-packrow__name">
                    <span>{p.name}</span>
                    {packHasRemaps(p) && <Wand2 className="keymaps-packrow__remap" aria-label={t("keymaps.bindings")} />}
                  </div>
                  <div className="keymaps-packrow__meta">
                    <span className={cx("keymaps-src", src === "user" && !edited && "keymaps-src--mine", src === "installed" && "keymaps-src--inst")}>
                      {srcLabel}
                    </span>
                    <span>·</span>
                    <span className="keymaps-packrow__apps">{p.apps.length ? p.apps.join(", ") : t("keymaps.global")}</span>
                  </div>
                </div>
                <span onClick={(e) => e.stopPropagation()} className="keymaps-packrow__toggle">
                  <Toggle checked={enabledIds.includes(p.id)} onChange={(on) => onToggle(p, on)} />
                </span>
              </div>
            );
          })}
        </div>
      ))}
      {packs.length === 0 && (
        <div className="keymaps-table-empty">
          <Keyboard size={16} /> {t("keymaps.ui.noPacks")}
        </div>
      )}
    </Card>
  );
}
