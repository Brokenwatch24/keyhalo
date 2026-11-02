import { useEffect, useId, useState, type ReactNode } from "react";
import { AppEditor } from "./AppEditor";
import { TasksEditor } from "./TasksEditor";
import { WindowsEditor } from "./WindowsEditor";
import { AgentsEditor } from "./AgentsEditor";
import { FolderOpen, Play, Plus, Trash2 } from "lucide-react";
import { Button, ColorInput, Field, Input, Modal, Segmented, Select, TextArea } from "@/ui";
import { useT } from "@/i18n";
import { isTauri } from "@/core/backend";
import { useIntegrations } from "@/core/integrations";
import { useProfiles } from "@/core/lighting";
import {
  activePage,
  describePadAction,
  mixerColumns,
  padInput,
  parseButton,
  previewColor,
  right,
  top,
  usePads,
  PAD_COLORS,
  PAD_PALETTE,
  RIGHT_NAMES,
  TOP_NAMES,
  type PadAction,
  type PadDef,
  type PadPage,
  type PadState,
} from "@/core/pads";
import { KeyRecorder } from "../keymaps/KeyRecorder";
import { ChipsInput } from "../keymaps/ChipsInput";

type T = ReturnType<typeof useT>;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Mixer column / top-button name for a process ("master" = the whole PC). */
export const appName = (proc: string, t: T) => (proc === "master" ? t("pads.mixer.master") : proc.replace(/\.exe$/i, ""));

/** Add an empty grid page at the end and make it active. Returns its index (or -1 when full). */
export function addBlankPage(t: T): number {
  const st = usePads.getState();
  const n = st.board.pages.length;
  if (n >= 7) return -1;
  const id = `page-${Date.now().toString(36)}`;
  st.addPage({ id, name: t("pads.board.newPage", { n: n + 1 }), color: PAD_PALETTE[n % PAD_PALETTE.length], kind: "grid", pads: {} });
  st.setPage(id);
  return n;
}

/** Like Field, but a <div>: clicking the label must not press the first button inside. */
export function Group({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="kh-field">
      <span className="kh-field__label">
        <span>{label}</span>
      </span>
      {children}
      {hint && <span className="kh-field__hint">{hint}</span>}
    </div>
  );
}

export function Head({ kicker, title, children }: { kicker: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pads-insp__head">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="pads-insp__kicker">{kicker}</div>
        <div className="pads-insp__title">{title}</div>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

/** Right-hand editor for the selected button of the active page. */
export function Inspector({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const t = useT();
  const board = usePads((s) => s.board);
  const pageId = usePads((s) => s.pageId);
  const page = activePage({ board, pageId });
  const b = parseButton(selected);

  let body: ReactNode = null;
  if (b && page) {
    if (b.kind === "r") {
      const p = board.pages[b.y];
      if (b.y === 7) body = <MapButtonInfo />;
      else if (p) body = <PageEditor key={p.id} page={p} index={b.y} />;
      else
        body = (
          <>
            <Head kicker={t("pads.page.kicker", { n: b.y + 1, name: RIGHT_NAMES[b.y] })} title={t("pads.page.none")} />
            <p className="pads-note">{t("pads.page.noneHint")}</p>
            <div>
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() => {
                  const i = addBlankPage(t);
                  if (i >= 0) onSelect(right(i));
                }}
              >
                {t("pads.board.addPage")}
              </Button>
            </div>
          </>
        );
    } else if (page.kind === "mixer") body = <MixerEditor page={page} column={b.x} onSelect={onSelect} />;
    else if (page.kind === "agents") body = <AgentsEditor selected={selected} />;
    else if (page.kind === "windows") body = <WindowsEditor selected={selected} />;
    else if (page.kind === "app") body = <AppEditor />;
    else if (page.kind === "tasks") body = <TasksEditor key={`${page.id}/${selected}`} page={page} selected={selected} />;
    else body = <PadEditor key={`${page.id}/${selected}`} page={page} id={selected} />;
  }
  return <aside className="pads-inspector">{body}</aside>;
}

function buttonName(id: string, t: T): string {
  const b = parseButton(id);
  if (!b) return id;
  if (b.kind === "t") return t("pads.pad.top", { n: b.x + 1, name: TOP_NAMES[b.x] });
  return t("pads.pad.grid", { row: b.y + 1, col: b.x + 1 });
}

// ---------------------------------------------------------------------------
// Grid pad
// ---------------------------------------------------------------------------

function presets(t: T): { id: string; label: string; def: PadDef }[] {
  return [
    {
      id: "claude",
      label: "Claude Code",
      def: { label: "Claude Code", color: PAD_COLORS.ai, action: { type: "claude" }, hold: { type: "terminal", command: "claude" }, state: { type: "claude" } },
    },
    { id: "codex", label: "Codex", def: { label: "Codex", color: PAD_COLORS.ai, action: { type: "terminal", command: "codex" } } },
    { id: "website", label: t("pads.presets.website"), def: { color: PAD_COLORS.web, action: { type: "url", url: "https://" } } },
    { id: "shortcut", label: t("pads.presets.shortcut"), def: { color: PAD_COLORS.system, action: { type: "keys", keys: [] } } },
    {
      id: "playPause",
      label: t("pads.presets.playPause"),
      def: { label: t("pads.presets.playPause"), color: PAD_COLORS.media, action: { type: "media", command: "playPause" }, state: { type: "media" } },
    },
    { id: "mic", label: t("pads.presets.mic"), def: { label: t("pads.presets.mic"), color: "#3ccf4e", action: { type: "mic" }, state: { type: "mic" } } },
  ];
}

function PadEditor({ page, id }: { page: PadPage; id: string }) {
  const t = useT();
  const setPad = usePads((s) => s.setPad);
  const def = page.pads[id];
  const cur: PadDef = def ?? { color: PAD_COLORS.app };
  const patch = (p: Partial<PadDef>) => setPad(page.id, id, { ...cur, ...p });
  const test = () => {
    padInput(id, true);
    padInput(id, false);
  };

  return (
    <>
      <Head kicker={buttonName(id, t)} title={def ? def.label || describePadAction(def.action) || t("pads.pad.unnamed") : t("pads.pad.empty")}>
        <Button size="sm" icon={<Play />} disabled={!def?.action} title={t("pads.pad.testHint")} onClick={test}>
          {t("pads.pad.test")}
        </Button>
      </Head>

      <Group label={def ? t("pads.presets.replace") : t("pads.presets.title")}>
        <div className="pads-presets">
          {presets(t).map((p) => (
            <button key={p.id} type="button" className="pads-chip" onClick={() => setPad(page.id, id, p.def)}>
              {p.label}
            </button>
          ))}
        </div>
      </Group>

      <div className="pads-insp__section">
        <Field label={t("pads.pad.label")} hint={t("pads.pad.labelHint")}>
          <Input value={cur.label ?? ""} placeholder={describePadAction(cur.action)} onChange={(e) => patch({ label: e.target.value || undefined })} />
        </Field>
        <Group label={t("pads.pad.color")} hint={t("pads.pad.colorHint")}>
          <ColorField value={cur.color} onChange={(color) => patch({ color })} />
        </Group>
      </div>

      <div className="pads-insp__section">
        <h4>{t("pads.pad.action")}</h4>
        <ActionEditor value={cur.action} onChange={(action) => patch({ action })} />
      </div>

      <div className="pads-insp__section">
        <h4>{t("pads.pad.hold")}</h4>
        <p className="pads-note">{t("pads.pad.holdHint")}</p>
        <ActionEditor value={cur.hold} onChange={(hold) => patch({ hold })} />
      </div>

      <div className="pads-insp__section">
        <h4>{t("pads.state.title")}</h4>
        <StateEditor value={cur.state} onChange={(state) => patch({ state })} />
      </div>

      {def && (
        <div className="pads-insp__section">
          <div>
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setPad(page.id, id, null)}>
              {t("pads.pad.clear")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** Launchpad palette swatches (as the LEDs show them) plus a free colour. */
function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const t = useT();
  return (
    <div className="pads-color">
      <div className="pads-swatches">
        {PAD_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            className={cx("pads-swatch", hex === value.toLowerCase() && "is-active")}
            style={{ ["--c" as string]: previewColor(hex) }}
            title={hex}
            aria-label={hex}
            onClick={() => onChange(hex)}
          />
        ))}
      </div>
      <ColorInput value={value} onChange={onChange} />
      <span className="pads-led" style={{ ["--c" as string]: previewColor(value) }} title={t("pads.pad.onDevice")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action editor
// ---------------------------------------------------------------------------

type ActionType = PadAction["type"];

const ACTION_TYPES: ActionType[] = ["app", "url", "terminal", "claude", "broken", "focus", "keys", "appKeys", "text", "media", "mic", "volume", "notificationsSeen", "map", "page", "profile"];

function defaultAction(type: ActionType): PadAction {
  switch (type) {
    case "app":
      return { type, path: "" };
    case "url":
      return { type, url: "https://" };
    case "terminal":
      return { type, command: "" };
    case "focus":
      return { type, process: "" };
    case "keys":
      return { type, keys: [] };
    case "appKeys":
      return { type, process: "", keys: [] };
    case "text":
      return { type, text: "" };
    case "media":
      return { type, command: "playPause" };
    case "volume":
      return { type, process: "master", step: 0.1 };
    case "page":
      return { type, page: usePads.getState().board.pages[0]?.id ?? "" };
    case "profile":
      return { type, profileId: useProfiles.getState().profiles[0]?.id ?? "" };
    case "claude":
    case "broken":
    case "mic":
    case "notificationsSeen":
    case "map":
      return { type };
  }
}

/** Pick an action type, then fill in its fields. "Nothing" clears it. */
function ActionEditor({ value, onChange }: { value: PadAction | undefined; onChange: (a: PadAction | undefined) => void }) {
  const t = useT();
  return (
    <div className="pads-action">
      <Select<ActionType | "">
        value={value?.type ?? ""}
        onChange={(type) => onChange(type ? defaultAction(type) : undefined)}
        options={[{ value: "", label: t("pads.action.none") }, ...ACTION_TYPES.map((v) => ({ value: v, label: t(`pads.action.types.${v}`) }))]}
      />
      {value && <ActionFields action={value} onChange={onChange} />}
    </div>
  );
}

const splitArgs = (s: string) => (s.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"(.*)"$/, "$1"));
const joinArgs = (args: string[]) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");

/** Space-separated arguments ("quotes" keep spaces). Keeps its own text so typing a space isn't eaten. */
function ArgsInput({ value, onChange }: { value: string[]; onChange: (args: string[]) => void }) {
  const [text, setText] = useState(() => joinArgs(value));
  useEffect(() => setText((cur) => (joinArgs(splitArgs(cur)) === joinArgs(value) ? cur : joinArgs(value))), [value]);
  return (
    <Input
      className="mono"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitArgs(e.target.value));
      }}
    />
  );
}

export function FolderInput({ value, onChange }: { value: string; onChange: (dir: string) => void }) {
  const t = useT();
  const browse = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, defaultPath: value || undefined });
    if (typeof dir === "string") onChange(dir);
  };
  return (
    <div className="pads-inline">
      <Input className="mono" value={value} placeholder={t("pads.action.folderAny")} onChange={(e) => onChange(e.target.value)} />
      {isTauri && (
        <Button size="sm" icon={<FolderOpen />} onClick={() => void browse()}>
          {t("pads.action.browse")}
        </Button>
      )}
    </div>
  );
}

const URLISH = /^(https?:|mailto:|ms-[\w-]+:)/i;

/** Fallback of a focus action as one text: a URL, or a program / shell:AppsFolder path. */
function fallbackText(f: PadAction | undefined): string {
  if (!f) return "";
  if (f.type === "url") return f.url;
  if (f.type === "app") return f.args?.[0]?.startsWith("shell:") ? f.args[0] : f.path;
  return describePadAction(f);
}

const fallbackAction = (text: string): PadAction | undefined =>
  !text.trim() ? undefined : URLISH.test(text.trim()) ? { type: "url", url: text } : { type: "app", path: text };

function ActionFields({ action: a, onChange }: { action: PadAction; onChange: (a: PadAction) => void }) {
  const t = useT();
  const listId = useId();
  const pages = usePads((s) => s.board.pages);
  const audio = usePads((s) => s.audio);
  const rules = useIntegrations((s) => s.config.notifications.rules);
  const profiles = useProfiles((s) => s.profiles);
  const note = (key: string) => <p className="pads-note">{t(key)}</p>;

  switch (a.type) {
    case "app":
      return (
        <>
          <Field label={t("pads.action.path")} hint={t("pads.action.pathHint")}>
            <Input className="mono" value={a.path} placeholder="C:\…\app.exe" onChange={(e) => onChange({ ...a, path: e.target.value })} />
          </Field>
          <Field label={t("pads.action.args")} hint={t("pads.action.argsHint")}>
            <ArgsInput value={a.args ?? []} onChange={(args) => onChange({ ...a, args: args.length ? args : undefined })} />
          </Field>
        </>
      );
    case "url":
      return (
        <Field label={t("pads.action.url")}>
          <Input className="mono" value={a.url} onChange={(e) => onChange({ ...a, url: e.target.value })} />
        </Field>
      );
    case "terminal":
      return (
        <>
          <Field label={t("pads.action.command")} hint={t("pads.action.commandHint")}>
            <Input className="mono" value={a.command} placeholder="claude" onChange={(e) => onChange({ ...a, command: e.target.value })} />
          </Field>
          <Group label={t("pads.action.folder")}>
            <FolderInput value={a.cwd ?? ""} onChange={(cwd) => onChange({ ...a, cwd: cwd || undefined })} />
          </Group>
        </>
      );
    case "claude":
      return (
        <Group label={t("pads.action.folder")} hint={t("pads.action.claudeHint")}>
          <FolderInput value={a.cwd ?? ""} onChange={(cwd) => onChange({ ...a, cwd: cwd || undefined })} />
        </Group>
      );
    case "focus":
      return (
        <>
          <Field label={t("pads.action.process")} hint={t("pads.action.processHint")}>
            <Input className="mono" value={a.process} placeholder="chrome.exe" onChange={(e) => onChange({ ...a, process: e.target.value })} />
          </Field>
          <Field label={t("pads.action.fallback")} hint={t("pads.action.fallbackHint")}>
            <Input className="mono" value={fallbackText(a.fallback)} onChange={(e) => onChange({ ...a, fallback: fallbackAction(e.target.value) })} />
          </Field>
        </>
      );
    case "keys":
      return (
        <Group label={t("pads.action.keys")}>
          <KeyRecorder value={a.keys} onChange={(keys) => onChange({ ...a, keys })} />
        </Group>
      );
    case "appKeys":
      return (
        <>
          <Field label={t("pads.action.process")}>
            <Input className="mono" value={a.process} placeholder="Spotify.exe" onChange={(e) => onChange({ ...a, process: e.target.value })} />
          </Field>
          <Group label={t("pads.action.keys")} hint={t("pads.action.appKeysHint")}>
            <KeyRecorder value={a.keys} onChange={(keys) => onChange({ ...a, keys })} />
          </Group>
        </>
      );
    case "text":
      return (
        <Field label={t("pads.action.text")}>
          <TextArea rows={3} value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} />
        </Field>
      );
    case "media":
      return (
        <Segmented
          value={a.command}
          onChange={(command) => onChange({ ...a, command })}
          options={(["prev", "playPause", "next"] as const).map((v) => ({ value: v, label: t(`pads.action.media.${v}`) }))}
        />
      );
    case "volume": {
      const mode = a.mute ? "mute" : (a.step ?? 0) < 0 ? "down" : "up";
      const size = Math.abs(a.step ?? 0.1) || 0.1;
      return (
        <>
          <Field label={t("pads.action.app")} hint={t("pads.action.volumeHint")}>
            <Input className="mono" list={listId} value={a.process} onChange={(e) => onChange({ ...a, process: e.target.value })} />
          </Field>
          <datalist id={listId}>
            {["master", ...audio.map((x) => x.process)].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <Segmented
            value={mode}
            onChange={(m) => onChange(m === "mute" ? { type: "volume", process: a.process, mute: true } : { type: "volume", process: a.process, step: m === "down" ? -size : size })}
            options={(["down", "up", "mute"] as const).map((v) => ({ value: v, label: t(`pads.action.volume.${v}`) }))}
          />
          {mode !== "mute" && (
            <Field label={t("pads.action.step")}>
              <Select
                value={String(size)}
                onChange={(v) => onChange({ ...a, step: mode === "down" ? -Number(v) : Number(v) })}
                options={[...new Set(["0.05", "0.1", "0.2", String(size)])].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}%` }))}
              />
            </Field>
          )}
        </>
      );
    }
    case "notificationsSeen":
      return (
        <Field label={t("pads.action.rule")}>
          <Select
            value={a.ruleId ?? ""}
            onChange={(ruleId) => onChange({ ...a, ruleId: ruleId || undefined })}
            options={[{ value: "", label: t("pads.action.allRules") }, ...rules.map((r) => ({ value: r.id, label: r.name }))]}
          />
        </Field>
      );
    case "page":
      return (
        <Field label={t("pads.action.page")}>
          <Select value={a.page} onChange={(page) => onChange({ ...a, page })} options={pages.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
      );
    case "profile":
      return profiles.length ? (
        <Field label={t("pads.action.profile")}>
          <Select value={a.profileId} onChange={(profileId) => onChange({ ...a, profileId })} options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
      ) : (
        note("pads.action.noProfiles")
      );
    case "mic":
      return note("pads.action.micHint");
    case "map":
      return note("pads.action.mapHint");
  }
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

type StateType = PadState["type"];

const STATE_TYPES: StateType[] = ["claude", "mic", "media", "notification", "running"];

function StateEditor({ value, onChange }: { value: PadState | undefined; onChange: (s: PadState | undefined) => void }) {
  const t = useT();
  const rules = useIntegrations((s) => s.config.notifications.rules);
  const set = (type: StateType | "") => {
    if (!type) onChange(undefined);
    else if (type === "notification") onChange({ type, ruleId: rules[0]?.id ?? "" });
    else if (type === "running") onChange({ type, process: "" });
    else onChange({ type });
  };
  const ruleOptions = rules.map((r) => ({ value: r.id, label: r.name }));
  if (value?.type === "notification" && !rules.some((r) => r.id === value.ruleId)) ruleOptions.push({ value: value.ruleId, label: t("pads.state.missingRule", { id: value.ruleId }) });

  return (
    <>
      <Select<StateType | "">
        value={value?.type ?? ""}
        onChange={set}
        options={[{ value: "", label: t("pads.state.types.none") }, ...STATE_TYPES.map((v) => ({ value: v, label: t(`pads.state.types.${v}`) }))]}
      />
      {value?.type === "notification" && (
        <Field label={t("pads.state.rule")}>
          <Select value={value.ruleId} onChange={(ruleId) => onChange({ type: "notification", ruleId })} options={ruleOptions} />
        </Field>
      )}
      {value?.type === "running" && (
        <Field label={t("pads.action.process")}>
          <Input className="mono" value={value.process} placeholder="Discord.exe" onChange={(e) => onChange({ type: "running", process: e.target.value })} />
        </Field>
      )}
      <p className="pads-note">{t(`pads.state.hints.${value?.type ?? "none"}`)}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pages (right round buttons)
// ---------------------------------------------------------------------------

const EMPTY_MIXER = ["master", "", "", "", "", "", "", ""];

function PageEditor({ page, index }: { page: PadPage; index: number }) {
  const t = useT();
  const pages = usePads((s) => s.board.pages);
  const running = usePads((s) => s.running);
  const updatePage = usePads((s) => s.updatePage);
  const removePage = usePads((s) => s.removePage);
  const [confirm, setConfirm] = useState(false);
  const update = (p: Partial<PadPage>) => updatePage(page.id, p);

  return (
    <>
      <Head kicker={t("pads.page.kicker", { n: index + 1, name: RIGHT_NAMES[index] })} title={page.name || t("pads.pad.unnamed")} />
      <div className="pads-insp__section">
        <Field label={t("pads.page.name")}>
          <Input value={page.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Group label={t("pads.pad.color")}>
          <ColorField value={page.color} onChange={(color) => update({ color })} />
        </Group>
        <Group label={t("pads.page.kind")} hint={t(`pads.page.kindHint.${page.kind}`)}>
          <Segmented
            value={page.kind}
            onChange={(kind) => update(kind === "mixer" && !page.mixer ? { kind, mixer: EMPTY_MIXER } : { kind })}
            options={[
              { value: "grid", label: t("pads.page.kinds.grid") },
              { value: "mixer", label: t("pads.page.kinds.mixer") },
              { value: "agents", label: t("pads.page.kinds.agents") },
              { value: "windows", label: t("pads.page.kinds.windows") },
              { value: "tasks", label: t("pads.page.kinds.tasks") },
              { value: "app", label: t("pads.page.kinds.app") },
            ]}
          />
        </Group>
        <Group label={t("pads.page.apps")} hint={t("pads.page.appsHint")}>
          <ChipsInput value={page.apps ?? []} onChange={(apps) => update({ apps: apps.length ? apps : undefined })} suggestions={running} placeholder="photoshop.exe" />
        </Group>
      </div>
      <div className="pads-insp__section">
        <div>
          <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={pages.length <= 1} onClick={() => setConfirm(true)}>
            {t("pads.page.delete")}
          </Button>
        </div>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("pads.page.deleteTitle", { name: page.name })}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                removePage(page.id);
                setConfirm(false);
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="pads-note">{t("pads.page.deleteBody")}</p>
      </Modal>
    </>
  );
}

function MapButtonInfo() {
  const t = useT();
  const visible = usePads((s) => s.mapVisible);
  return (
    <>
      <Head kicker={t("pads.page.kicker", { n: 8, name: RIGHT_NAMES[7] })} title={t("pads.mapButton.title")} />
      <p className="pads-note">{t("pads.mapButton.body")}</p>
      <div>
        <Button size="sm" onClick={() => usePads.setState({ mapVisible: !visible })}>
          {t(visible ? "pads.hideMap" : "pads.showMap")}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mixer page
// ---------------------------------------------------------------------------

function MixerEditor({ page, column, onSelect }: { page: PadPage; column: number; onSelect: (id: string) => void }) {
  const t = useT();
  const listId = useId();
  const audio = usePads((s) => s.audio);
  const updatePage = usePads((s) => s.updatePage);
  const cols = Array.from({ length: 8 }, (_, i) => page.mixer?.[i] ?? "");
  const live = mixerColumns(page, audio);
  const setCol = (i: number, v: string) => updatePage(page.id, { mixer: cols.map((c, j) => (j === i ? v : c)) });
  const picks = ["master", ...audio.map((a) => a.process).filter((p) => p !== "master")];

  return (
    <>
      <Head kicker={t("pads.mixer.kicker")} title={page.name} />
      <p className="pads-note">{t("pads.mixer.body")}</p>
      <div className="pads-insp__section">
        <h4>{t("pads.mixer.columns")}</h4>
        <div className="pads-mixer">
          {cols.map((c, i) => (
            <label key={i} className={cx("pads-mixer__col", i === column && "is-active")}>
              <span className="pads-mixer__n">{i + 1}</span>
              <Input
                className="mono"
                list={listId}
                value={c}
                placeholder={!c && live[i] ? appName(live[i]!, t) : t("pads.mixer.auto")}
                onFocus={() => i !== column && onSelect(top(i))}
                onChange={(e) => setCol(i, e.target.value)}
              />
            </label>
          ))}
        </div>
        <datalist id={listId}>
          {picks.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <p className="pads-note">{t("pads.mixer.columnsHint")}</p>
      </div>
      <div className="pads-insp__section">
        <h4>{t("pads.mixer.playing")}</h4>
        {audio.length ? (
          <>
            <div className="pads-presets">
              {picks.map((p) => {
                const a = audio.find((x) => x.process === p);
                return (
                  <button key={p} type="button" className={cx("pads-chip", cols[column] === p && "is-active")} onClick={() => setCol(column, p)}>
                    {appName(p, t)}
                    {a && <span className="subtle">{a.muted ? t("pads.mixer.muted") : `${Math.round(a.volume * 100)}%`}</span>}
                  </button>
                );
              })}
            </div>
            <p className="pads-note">{t("pads.mixer.pickHint", { n: column + 1 })}</p>
          </>
        ) : (
          <p className="pads-note">{t("pads.mixer.noAudio")}</p>
        )}
      </div>
    </>
  );
}
