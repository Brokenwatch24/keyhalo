import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileJson, FileUp, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Badge, Button, ColorInput, Field, Input, Modal, Segmented, TextArea } from "@/ui";
import { useT } from "@/i18n";
import type { KeymapPack } from "@/core/types";
import { backend } from "@/core/backend";
import { DEFAULT_SETTINGS, useSettings } from "@/core/state/settings";
import { useKeymaps, riskyActions, type RiskItem } from "@/core/keymaps";
import { ChipsInput } from "./ChipsInput";
import { Combo } from "./KeyRecorder";
import { bindingParts, clonePack, pickTextFile, slugify, uniqueId } from "./util";
import { newCatColor } from "./Editors";

/** Running process names (for app suggestions). */
export function useProcessSuggestions(): string[] {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    backend
      .processes()
      .then((p) => alive && setList([...new Set(p)].sort((a, b) => a.localeCompare(b))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

// ---------------------------------------------------------------------------
// Risk review
// ---------------------------------------------------------------------------

export function RiskList({ items, pack }: { items: RiskItem[]; pack: KeymapPack }) {
  const t = useT();
  const layerName = (id: string) => pack.layers?.find((l) => l.id === id)?.name ?? id;
  return (
    <ul className="keymaps-risks">
      {items.map((r, i) => (
        <li key={i} className="keymaps-risk">
          <div className="row wrap" style={{ gap: 8 }}>
            <Badge tone={r.kind === "launch" || r.kind === "http" ? "danger" : "warning"}>{t(`keymaps.risk.${r.kind}`)}</Badge>
            <Combo parts={bindingParts(r.binding)} />
            {r.layer && <span className="subtle">{layerName(r.layer)}</span>}
            {r.binding.label && <span className="muted">{r.binding.label}</span>}
          </div>
          <code className="keymaps-risk__detail">{r.detail || "—"}</code>
        </li>
      ))}
    </ul>
  );
}

export function RiskReviewModal({ pack, items, onClose, onConfirm }: { pack: KeymapPack; items: RiskItem[]; onClose: () => void; onConfirm: () => void }) {
  const t = useT();
  const [trust, setTrust] = useState(false);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="row">
          <ShieldAlert size={18} /> {t("keymaps.risk.title")}
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!trust} onClick={onConfirm}>
            {t("keymaps.ui.risk.enable")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <p className="muted">{t("keymaps.risk.intro")}</p>
        <RiskList items={items} pack={pack} />
        <label className="keymaps-check">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          {t("keymaps.risk.confirm")}
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type Source = "file" | "paste" | "vscode";
type Review = {
  pack: KeymapPack;
  risky: RiskItem[];
  vscode?: {
    imported: number;
    removed: number;
    skipped: { key: string; command: string; reason: string }[];
  };
};

export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (id: string) => void }) {
  const t = useT();
  const store = useKeymaps();
  const [source, setSource] = useState<Source>("file");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const f = await pickTextFile(".json,application/json");
    if (!f) return;
    setText(f.text);
    setFileName(f.name);
    setErrors([]);
  };

  const parse = async () => {
    setErrors([]);
    setBusy(true);
    try {
      if (source === "vscode") {
        const res = await store.importVsCode(text, { save: false });
        setReview({
          pack: res.pack,
          risky: riskyActions(res.pack),
          vscode: {
            imported: res.imported,
            removed: res.removed,
            skipped: res.skipped,
          },
        });
      } else {
        const res = await store.importPack(text, { save: false });
        if (!res.ok || !res.pack) setErrors(res.errors);
        else setReview({ pack: res.pack, risky: res.risky });
      }
    } catch (e) {
      setErrors([String((e as Error)?.message ?? e)]);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (enable: boolean) => {
    if (!review) return;
    setBusy(true);
    try {
      await store.savePack(review.pack);
      if (enable) store.toggle(review.pack.id, true);
      onImported(review.pack.id);
      onClose();
    } catch (e) {
      setErrors([String((e as Error)?.message ?? e)]);
    } finally {
      setBusy(false);
    }
  };

  if (review) {
    const p = review.pack;
    const exists = store.packs.some((x) => x.id === p.id);
    const bindings = p.bindings.length + (p.layers ?? []).reduce((n, l) => n + l.bindings.length, 0);
    return (
      <Modal
        open
        wide
        onClose={onClose}
        title={t("keymaps.ui.import.reviewTitle")}
        footer={
          <>
            <Button onClick={() => setReview(null)} style={{ marginRight: "auto" }}>
              {t("common.back")}
            </Button>
            <Button onClick={() => finish(false)} disabled={busy}>
              {t("keymaps.ui.import.importDisabled")}
            </Button>
            <Button variant="primary" onClick={() => finish(true)} disabled={busy || (review.risky.length > 0 && !trust)}>
              {t("keymaps.ui.import.importEnable")}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 16 }}>
          <div className="keymaps-import-summary">
            <div className="keymaps-appicon keymaps-appicon--lg">{p.name.slice(0, 1).toUpperCase()}</div>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="subtle mono" style={{ fontSize: 12 }}>
                {p.id} · {p.apps.length ? p.apps.join(", ") : t("keymaps.global")}
              </div>
            </div>
            <div className="keymaps-import-stats">
              <span>
                <strong>{p.legends.length}</strong> {t("keymaps.legends")}
              </span>
              <span>
                <strong>{bindings}</strong> {t("keymaps.bindings")}
              </span>
              <span>
                <strong>{p.layers?.length ?? 0}</strong> {t("keymaps.layers")}
              </span>
            </div>
          </div>
          {review.vscode && (
            <div className="keymaps-callout">
              <FileJson />
              <div>
                {t("keymaps.ui.import.vscodeResult", {
                  imported: review.vscode.imported,
                  removed: review.vscode.removed,
                  skipped: review.vscode.skipped.length,
                })}
                {review.vscode.skipped.length > 0 && (
                  <ul className="keymaps-ul subtle">
                    {review.vscode.skipped.slice(0, 6).map((s, i) => (
                      <li key={i} className="mono" style={{ fontSize: 12 }}>
                        {s.key} → {s.command} ({t(`keymaps.ui.import.skip.${s.reason}`)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {exists && (
            <div className="keymaps-callout keymaps-callout--warn">
              <AlertTriangle />
              <div>{t("keymaps.ui.import.replaces", { id: p.id })}</div>
            </div>
          )}
          {review.risky.length > 0 ? (
            <>
              <div className="keymaps-callout keymaps-callout--danger">
                <ShieldAlert />
                <div>
                  <div style={{ fontWeight: 600 }}>{t("keymaps.risk.title")}</div>
                  <div>{t("keymaps.risk.intro")}</div>
                </div>
              </div>
              <RiskList items={review.risky} pack={p} />
              <label className="keymaps-check">
                <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
                {t("keymaps.risk.confirm")}
              </label>
            </>
          ) : (
            <p className="muted">{t("keymaps.ui.import.safe")}</p>
          )}
          {errors.length > 0 && <ErrorList errors={errors} />}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("keymaps.ui.import.title")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!text.trim() || busy} onClick={parse}>
            {t("common.next")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Segmented
          value={source}
          onChange={(s) => {
            setSource(s);
            setErrors([]);
          }}
          options={[
            { value: "file", label: t("keymaps.ui.import.file") },
            { value: "paste", label: t("keymaps.ui.import.paste") },
            { value: "vscode", label: "VS Code keybindings.json" },
          ]}
        />
        {source === "vscode" && (
          <p className="muted">
            {t("keymaps.ui.import.vscodeHint")} <code className="keymaps-inline-code">%APPDATA%\Code\User\keybindings.json</code>
          </p>
        )}
        {source !== "paste" && (
          <div className="keymaps-drop">
            <FileUp />
            <div className="grow">{fileName ?? t("keymaps.ui.import.noFile")}</div>
            <Button onClick={choose}>{t("keymaps.ui.import.choose")}</Button>
          </div>
        )}
        {(source === "paste" || source === "vscode" || text) && (
          <TextArea
            rows={source === "paste" ? 12 : 8}
            value={text}
            placeholder={
              source === "vscode" ? '[ { "key": "ctrl+shift+d", "command": "editor.action.duplicateSelection" } ]' : '{ "id": "my-pack", "name": "My pack", … }'
            }
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="keymaps-code"
          />
        )}
        {errors.length > 0 && <ErrorList errors={errors} />}
      </div>
    </Modal>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div className="keymaps-callout keymaps-callout--danger">
      <AlertTriangle />
      <ul className="keymaps-ul">
        {errors.slice(0, 8).map((e, i) => (
          <li key={i} className="mono" style={{ fontSize: 12 }}>
            {e}
          </li>
        ))}
        {errors.length > 8 && <li>… +{errors.length - 8}</li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack details (new / edit)
// ---------------------------------------------------------------------------

export function PackDetailsModal({
  pack,
  isNew,
  onClose,
  onSave,
}: {
  pack: KeymapPack;
  isNew: boolean;
  onClose: () => void;
  onSave: (p: KeymapPack) => Promise<boolean>;
}) {
  const t = useT();
  const taken = useKeymaps((s) => s.packs.map((p) => p.id));
  const procs = useProcessSuggestions();
  const [draft, setDraft] = useState<KeymapPack>(() => clonePack(pack));
  const [idTouched, setIdTouched] = useState(false);
  const set = (patch: Partial<KeymapPack>) => setDraft((d) => ({ ...d, ...patch }));
  const idTaken = isNew && taken.includes(draft.id);

  const save = async () => {
    const out: KeymapPack = { ...draft, name: draft.name.trim() };
    if (!out.description?.trim()) delete out.description;
    if (!out.author?.trim()) delete out.author;
    if (!out.tags?.length) delete out.tags;
    if (await onSave(out)) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t("keymaps.ui.details.newTitle") : t("keymaps.ui.details.editTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!draft.name.trim() || !/^[a-z0-9][a-z0-9._-]*$/i.test(draft.id) || idTaken} onClick={save}>
            {isNew ? t("keymaps.ui.details.create") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Field label={t("common.name")}>
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => {
              const name = e.target.value;
              set(isNew && !idTouched ? { name, id: uniqueId(slugify(name), taken) } : { name });
            }}
          />
        </Field>
        {isNew && (
          <Field label="ID" hint={idTaken ? t("keymaps.ui.details.idTaken") : t("keymaps.ui.details.idHint")}>
            <Input
              className="mono"
              value={draft.id}
              onChange={(e) => {
                setIdTouched(true);
                set({ id: e.target.value.replace(/[^A-Za-z0-9._-]/g, "-") });
              }}
            />
          </Field>
        )}
        <Field label={t("common.description")}>
          <Input value={draft.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label={t("keymaps.ui.details.apps")} hint={t("keymaps.ui.details.appsHint")}>
          <ChipsInput value={draft.apps} onChange={(apps) => set({ apps })} suggestions={procs} placeholder="Code.exe" />
        </Field>
        <div className="keymaps-form-grid">
          <Field label={t("common.author")}>
            <Input value={draft.author ?? ""} onChange={(e) => set({ author: e.target.value })} />
          </Field>
          <Field label={t("keymaps.ui.details.version")}>
            <Input value={draft.version ?? ""} placeholder="1.0.0" onChange={(e) => set({ version: e.target.value || undefined })} />
          </Field>
        </div>
        <Field label={t("common.tags")}>
          <ChipsInput value={draft.tags ?? []} onChange={(tags) => set({ tags })} mono={false} placeholder="video, editing" />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function CategoriesModal({ pack, onClose, onSave }: { pack: KeymapPack; onClose: () => void; onSave: (p: KeymapPack) => Promise<boolean> }) {
  const t = useT();
  const [rows, setRows] = useState(() =>
    Object.entries(pack.categories).map(([name, color]) => ({
      orig: name as string | null,
      name,
      color,
    })),
  );
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of pack.legends) out[l.category] = (out[l.category] ?? 0) + 1;
    for (const b of [...pack.bindings, ...(pack.layers ?? []).flatMap((l) => l.bindings)]) if (b.category) out[b.category] = (out[b.category] ?? 0) + 1;
    return out;
  }, [pack]);
  const names = rows.map((r) => r.name.trim());
  const dup = names.some((n, i) => !n || names.indexOf(n) !== i);

  const save = async () => {
    const next = clonePack(pack);
    const rename = new Map(rows.filter((r) => r.orig && r.orig !== r.name.trim()).map((r) => [r.orig!, r.name.trim()]));
    next.categories = Object.fromEntries(rows.map((r) => [r.name.trim(), r.color]));
    for (const l of next.legends) l.category = rename.get(l.category) ?? l.category;
    for (const b of [...next.bindings, ...(next.layers ?? []).flatMap((l) => l.bindings)]) if (b.category) b.category = rename.get(b.category) ?? b.category;
    if (await onSave(next)) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("keymaps.categories")}
      footer={
        <>
          <Button
            icon={<Plus />}
            style={{ marginRight: "auto" }}
            onClick={() =>
              setRows((r) => [
                ...r,
                {
                  orig: null,
                  name: t("keymaps.ui.newCategoryName", { n: r.length + 1 }),
                  color: newCatColor({
                    ...pack,
                    categories: Object.fromEntries(r.map((x) => [x.name, x.color])),
                  }),
                },
              ])
            }
          >
            {t("common.add")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={dup} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 8 }}>
        {rows.map((r, i) => {
          const used = r.orig ? (counts[r.orig] ?? 0) : 0;
          return (
            <div key={i} className="row">
              <ColorInput value={r.color} onChange={(color) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, color } : x)))} />
              <Input value={r.name} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <span className="subtle tabular" style={{ minWidth: 64, fontSize: 12 }}>
                {t("keymaps.ui.uses", { n: used })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Trash2 />}
                title={used ? t("keymaps.ui.categoryInUse") : t("common.delete")}
                disabled={used > 0}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              />
            </div>
          );
        })}
        {rows.length === 0 && <p className="keymaps-note">{t("keymaps.ui.noCategories")}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Anti-cheat pause list
// ---------------------------------------------------------------------------

export function PauseAppsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const apps = useSettings((s) => s.settings.remapPauseApps);
  const update = useSettings((s) => s.update);
  const procs = useProcessSuggestions();
  return (
    <Modal
      open
      onClose={onClose}
      title={t("keymaps.ui.pauseApps.title")}
      footer={
        <>
          <Button style={{ marginRight: "auto" }} onClick={() => update({ remapPauseApps: DEFAULT_SETTINGS.remapPauseApps })}>
            {t("keymaps.ui.pauseApps.reset")}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <p className="muted">{t("keymaps.antiCheat")}</p>
        <ChipsInput value={apps} onChange={(remapPauseApps) => update({ remapPauseApps })} suggestions={procs} placeholder="Game.exe" />
        <div className="keymaps-callout">
          <ShieldAlert />
          <div>{t("keymaps.ui.emergency")}</div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export function ConfirmModal({
  title,
  body,
  confirm,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirm: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <p className="muted">{body}</p>
    </Modal>
  );
}
