import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Check, ChevronDown, Copy, Download, FilePlus2, Link2, MoreHorizontal, Pencil, Plus, Save, Share2, Trash2, Upload, Users } from "lucide-react";
import { Badge, Button, Field, Input, Modal, toast } from "@/ui";
import { DEFAULT_SCENE, renderProfilePreview, useLighting, useProfiles } from "@/core/lighting";
import { useDevices, primaryKeyboard, layoutOf } from "@/core/devices";
import { useCommunity, communityErrorMessage, type GistShareResult } from "@/core/community";
import { navigate } from "@/app/router";
import type { DeviceDefinition, Profile } from "@/core/types";
import { useT } from "@/i18n";
import { plural, virtualKeyboardDefinition } from "./util";

// ---------------------------------------------------------------------------
// Dialog state (shared with the page shortcuts)
// ---------------------------------------------------------------------------

type Dialog = { kind: "new" } | { kind: "duplicate" } | { kind: "rename" } | { kind: "saveAs" } | { kind: "delete" } | { kind: "share" } | null;
const useDialog = create<{ dialog: Dialog; open(d: Dialog): void }>((set) => ({ dialog: null, open: (dialog) => set({ dialog }) }));

/** Ctrl+S: save in place for user profiles, otherwise ask for a name ("Save as new"). */
export function requestSave(t: (k: string) => string) {
  const { activeId, sources, saveActiveScene } = useProfiles.getState();
  if (activeId && sources[activeId] === "user") {
    saveActiveScene();
    toast(t("lighting.toolbar.saved"));
  } else useDialog.getState().open({ kind: "saveAs" });
}

// ---------------------------------------------------------------------------
// Thumbnails (memoised per profile content)
// ---------------------------------------------------------------------------

const thumbs = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function useThumbDefinition(): { def: DeviceDefinition; layout?: string } {
  const devices = useDevices((s) => s.devices);
  return useMemo(() => {
    const kb = primaryKeyboard(devices);
    if (kb) return { def: kb.definition, layout: layoutOf(kb)?.id };
    return { def: virtualKeyboardDefinition() };
  }, [devices]);
}

function useThumb(profile: Profile | undefined, def: DeviceDefinition, layout?: string, unit = 9) {
  const key = profile ? `${def.id}|${unit}|${profile.id}|${JSON.stringify(profile.lighting)}` : "";
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (!profile) return;
    let alive = true;
    let p = thumbs.get(key);
    if (!p) {
      // Render one at a time so opening the menu never stalls the UI.
      p = queue.then(() => renderProfilePreview(profile, def, layout, { unit, background: "#0b0b0d" }));
      queue = p.catch(() => undefined);
      thumbs.set(key, p);
    }
    p.then((u) => alive && setUrl(u)).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

function Thumb({ profile, def, layout, className }: { profile: Profile; def: DeviceDefinition; layout?: string; className?: string }) {
  const url = useThumb(profile, def, layout);
  return <span className={`lighting-thumb ${className ?? ""}`}>{url && <img src={url} alt="" draggable={false} />}</span>;
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

function Popover({ button, children, align = "left", className }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="lighting-pop" ref={ref}>
      {button(open, () => setOpen((o) => !o))}
      {open && <div className={`lighting-pop__panel lighting-pop__panel--${align} ${className ?? ""}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`lighting-menuitem${danger ? " is-danger" : ""}`} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copy(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast(text);
  }
}

export function ProfileBar() {
  const t = useT();
  const profiles = useProfiles((s) => s.profiles);
  const sources = useProfiles((s) => s.sources);
  const activeId = useProfiles((s) => s.activeId);
  const dirty = useProfiles((s) => s.dirty);
  const active = profiles.find((p) => p.id === activeId);
  const source = activeId ? sources[activeId] : undefined;
  const editable = source === "user";
  const { def, layout } = useThumbDefinition();
  const open = useDialog((s) => s.open);
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const by = (s: string) => profiles.filter((p) => (sources[p.id] ?? "user") === s);
    return [
      { id: "user", items: by("user") },
      { id: "installed", items: by("installed") },
      { id: "bundled", items: by("bundled") },
    ].filter((g) => g.items.length);
  }, [profiles, sources]);

  const apply = (id: string) => void useProfiles.getState().apply(id).catch((e) => toast(String(e instanceof Error ? e.message : e), "danger"));

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = useProfiles.getState().importJson(await file.text());
      await useProfiles.getState().apply(p.id);
      toast(t("lighting.toolbar.imported", { name: p.name }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "danger");
    }
  };

  return (
    <div className="lighting-toolbar">
      <Popover
        className="lighting-profiles"
        button={(o, toggle) => (
          <button type="button" className={`lighting-switcher${o ? " is-open" : ""}`} onClick={toggle} aria-haspopup="listbox" aria-expanded={o}>
            {active && <Thumb profile={active} def={def} layout={layout} className="lighting-thumb--sm" />}
            <span className="lighting-switcher__text">
              <span className="lighting-switcher__label">{t("lighting.toolbar.profile")}</span>
              <span className="lighting-switcher__name">{active?.name ?? "—"}</span>
            </span>
            <ChevronDown className="lighting-switcher__chev" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="lighting-profiles__list" role="listbox">
              {groups.map((g) => (
                <div key={g.id} className="lighting-profiles__group">
                  <div className="lighting-profiles__heading">{t(`lighting.profile.group.${g.id}`)}</div>
                  {g.items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={p.id === activeId}
                      className="lighting-profiles__item"
                      onClick={() => {
                        apply(p.id);
                        close();
                      }}
                    >
                      <Thumb profile={p} def={def} layout={layout} />
                      <span className="lighting-profiles__text">
                        <span className="lighting-profiles__name">{p.name}</span>
                        <span className="lighting-profiles__desc">{p.description ?? plural(t, "lighting.profile.layers", p.lighting.layers.length)}</span>
                      </span>
                      {p.id === activeId && <Check className="lighting-profiles__check" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="lighting-profiles__foot">
              <Button
                size="sm"
                variant="ghost"
                icon={<FilePlus2 />}
                onClick={() => {
                  close();
                  open({ kind: "new" });
                }}
              >
                {t("lighting.toolbar.new")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Upload />}
                onClick={() => {
                  close();
                  fileRef.current?.click();
                }}
              >
                {t("lighting.toolbar.import")}
              </Button>
            </div>
          </>
        )}
      </Popover>

      {source && source !== "user" && !dirty && <Badge>{t(`lighting.profile.source.${source}`)}</Badge>}
      {dirty && (
        <Badge tone="warning" dot>
          {t("lighting.profiles.unsaved")}
        </Badge>
      )}

      <span className="lighting-toolbar__spacer" />

      {dirty || !editable ? (
        <Button variant={dirty ? "primary" : "secondary"} icon={<Save />} onClick={() => open({ kind: "saveAs" })} title="Ctrl+S">
          {dirty ? t("lighting.profiles.saveAs") : t("lighting.toolbar.duplicateToEdit")}
        </Button>
      ) : (
        <Button icon={<Check />} onClick={() => requestSave(t)} title="Ctrl+S">
          {t("lighting.toolbar.saved")}
        </Button>
      )}
      <Button icon={<Share2 />} onClick={() => open({ kind: "share" })} disabled={!active}>
        {t("common.share")}
      </Button>
      <Popover
        align="right"
        className="lighting-menu"
        button={(_, toggle) => <Button iconOnly icon={<MoreHorizontal />} title={t("lighting.toolbar.more")} onClick={toggle} />}
      >
        {(close) => {
          const run = (fn: () => void) => () => {
            close();
            fn();
          };
          return (
            <>
              <MenuItem icon={<Plus />} onClick={run(() => open({ kind: "new" }))}>
                {t("lighting.toolbar.new")}
              </MenuItem>
              <MenuItem icon={<Copy />} onClick={run(() => open({ kind: "duplicate" }))} disabled={!active}>
                {t("common.duplicate")}
              </MenuItem>
              <MenuItem icon={<Pencil />} onClick={run(() => open({ kind: "rename" }))} disabled={!editable}>
                {t("common.rename")}
              </MenuItem>
              <div className="lighting-menu__sep" />
              <MenuItem icon={<Upload />} onClick={run(() => fileRef.current?.click())}>
                {t("lighting.toolbar.import")}
              </MenuItem>
              <MenuItem icon={<Download />} onClick={run(() => active && download(`${active.id}.json`, exportActive(active.id)))} disabled={!active}>
                {t("lighting.toolbar.export")}
              </MenuItem>
              <div className="lighting-menu__sep" />
              <MenuItem icon={<Trash2 />} danger onClick={run(() => open({ kind: "delete" }))} disabled={!active || source === "bundled"}>
                {t("common.delete")}
              </MenuItem>
            </>
          );
        }}
      </Popover>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Dialogs def={def} layout={layout} />
    </div>
  );
}

/** Export JSON of a profile, including unsaved edits when it is the active one. */
function exportActive(id: string): string {
  const { activeId, exportJson } = useProfiles.getState();
  const json = JSON.parse(exportJson(id)) as Profile;
  if (id === activeId) json.lighting = useLighting.getState().scene;
  return JSON.stringify(json, null, 2);
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function NameDialog({ title, initial, cta, onSubmit, onClose }: { title: string; initial: string; cta: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  const submit = () => {
    if (!name.trim()) return;
    onSubmit(name.trim());
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            {cta}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("common.name")}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </Field>
      </form>
    </Modal>
  );
}

function Dialogs({ def, layout }: { def: DeviceDefinition; layout?: string }) {
  const t = useT();
  const dialog = useDialog((s) => s.dialog);
  const open = useDialog((s) => s.open);
  const active = useProfiles((s) => s.profiles.find((p) => p.id === s.activeId));
  const close = () => open(null);
  if (!dialog || (!active && dialog.kind !== "new")) return null;
  const P = useProfiles.getState();

  switch (dialog.kind) {
    case "new":
      return (
        <NameDialog
          title={t("lighting.toolbar.newTitle")}
          initial={t("lighting.toolbar.newName")}
          cta={t("lighting.toolbar.create")}
          onClose={close}
          onSubmit={(name) => {
            const p = P.create(name, { lighting: structuredClone(DEFAULT_SCENE) });
            void P.apply(p.id);
          }}
        />
      );
    case "duplicate":
      return (
        <NameDialog
          title={t("common.duplicate")}
          initial={t("lighting.profiles.copyOf", { name: active!.name })}
          cta={t("common.duplicate")}
          onClose={close}
          onSubmit={(name) => {
            const p = P.create(name, { ...structuredClone(active!), lighting: structuredClone(useLighting.getState().scene) });
            void P.apply(p.id);
          }}
        />
      );
    case "rename":
      return <NameDialog title={t("common.rename")} initial={active!.name} cta={t("common.rename")} onClose={close} onSubmit={(name) => P.rename(active!.id, name)} />;
    case "saveAs":
      return (
        <NameDialog
          title={t("lighting.profiles.saveAs")}
          initial={t("lighting.profiles.copyOf", { name: active!.name })}
          cta={t("common.save")}
          onClose={close}
          onSubmit={(name) => {
            P.saveActiveScene(name);
            toast(t("lighting.toolbar.savedAs", { name }));
          }}
        />
      );
    case "delete":
      return (
        <Modal
          open
          onClose={close}
          title={t("lighting.toolbar.deleteTitle", { name: active!.name })}
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 />}
                onClick={() => {
                  P.remove(active!.id);
                  close();
                }}
              >
                {t("common.delete")}
              </Button>
            </>
          }
        >
          <p className="muted">{t("lighting.toolbar.deleteBody")}</p>
        </Modal>
      );
    case "share":
      return <ShareDialog profile={active!} def={def} layout={layout} onClose={close} />;
  }
}

function ShareDialog({ profile, def, layout, onClose }: { profile: Profile; def: DeviceDefinition; layout?: string; onClose: () => void }) {
  const t = useT();
  const auth = useCommunity((s) => s.auth);
  const [busy, setBusy] = useState(false);
  const [gist, setGist] = useState<GistShareResult | null>(null);
  const data = useMemo(() => JSON.parse(exportActive(profile.id)) as Profile, [profile.id]);
  const preview = useThumb(data, def, layout, 22);

  const createGist = async () => {
    setBusy(true);
    try {
      setGist(await useCommunity.getState().shareGist("profile", data, { public: false }));
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} title={t("lighting.share.title", { name: profile.name })}>
      <div className="lighting-share">
        <div className="lighting-share__preview">{preview && <img src={preview} alt="" />}</div>
        <div className="lighting-share__options">
          <div className="lighting-share__opt">
            <Link2 />
            <div className="grow">
              <div className="lighting-share__title">{t("lighting.share.gist")}</div>
              <div className="subtle lighting-muted-sm">{t("lighting.share.gistHint")}</div>
              {gist && (
                <div className="lighting-share__links">
                  <code>{gist.deepLink}</code>
                  <Button size="sm" icon={<Copy />} onClick={() => void copy(gist.deepLink, t("common.copied"))}>
                    {t("common.copy")}
                  </Button>
                  <code>{gist.gistUrl}</code>
                  <Button size="sm" icon={<Copy />} onClick={() => void copy(gist.gistUrl, t("common.copied"))}>
                    {t("common.copy")}
                  </Button>
                </div>
              )}
            </div>
            {auth.status === "signedIn" ? (
              !gist && (
                <Button variant="primary" icon={<Link2 />} onClick={() => void createGist()} disabled={busy}>
                  {busy ? t("common.loading") : t("lighting.share.createGist")}
                </Button>
              )
            ) : (
              <Button
                onClick={() => {
                  onClose();
                  navigate("community");
                }}
              >
                {t("lighting.share.signIn")}
              </Button>
            )}
          </div>
          <div className="lighting-share__opt">
            <Users />
            <div className="grow">
              <div className="lighting-share__title">{t("lighting.share.publish")}</div>
              <div className="subtle lighting-muted-sm">{t("lighting.share.publishHint")}</div>
            </div>
            <Button
              onClick={() => {
                onClose();
                navigate("community/share");
              }}
            >
              {t("lighting.share.openCommunity")}
            </Button>
          </div>
          <div className="lighting-share__opt">
            <Copy />
            <div className="grow">
              <div className="lighting-share__title">{t("lighting.share.json")}</div>
              <div className="subtle lighting-muted-sm">{t("lighting.share.jsonHint")}</div>
            </div>
            <div className="row">
              <Button onClick={() => void copy(JSON.stringify(data, null, 2), t("common.copied"))}>{t("common.copy")}</Button>
              <Button iconOnly icon={<Download />} title={t("lighting.toolbar.export")} onClick={() => download(`${profile.id}.json`, JSON.stringify(data, null, 2))} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
