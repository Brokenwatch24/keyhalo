import { useEffect, useState } from "react";
import { attention } from "@/core/util/attention";
import { toolName, useOpenWindows, windowLabel, WINDOW_TOOLS } from "@/core/pads/windows";
import { agentName, folderName, useAgents } from "@/core/agents";
import { Map as MapIcon, Plus, RotateCcw } from "lucide-react";
import { Badge, Button, Card, Field, Input, Modal, Page, Toggle } from "@/ui";
import { PadGrid, type PadCell } from "@/ui/PadGrid";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { activePage, computeLeds, describePadAction, grid, mixerColumns, parseButton, previewColor, right, top, usePads, type PadPage } from "@/core/pads";
import { KeyRecorder } from "../keymaps/KeyRecorder";
import { ChipsInput } from "../keymaps/ChipsInput";
import { useThemeQuery } from "../keymaps/util";
import { accelToCodes, codesToAccel } from "../automations/shared";
import { addBlankPage, appName, Group, Inspector } from "./Inspector";
import "./pads.css";

/** The board redraws this often while the page is open and focused (once a second otherwise). */
const LIVE_MS = 200;

export default function PadsSection() {
  useThemeQuery();
  const t = useT();
  const mapVisible = usePads((s) => s.mapVisible);
  const resetBoard = usePads((s) => s.resetBoard);
  const [selected, setSelected] = useState(grid(0, 0));
  const [confirmReset, setConfirmReset] = useState(false);
  const compact = useMedia("(max-width: 1260px)");
  useAudioApps();

  // A page button selects that page too, so the board shows what is being edited.
  const select = (id: string) => {
    setSelected(id);
    const b = parseButton(id);
    const st = usePads.getState();
    if (b?.kind === "r" && st.board.pages[b.y]) st.setPage(st.board.pages[b.y].id);
  };

  return (
    <Page
      title={t("pads.title")}
      description={t("pads.description")}
      actions={
        <>
          <ConnectionBadge />
          <Button icon={<MapIcon />} variant={mapVisible ? "primary" : "secondary"} aria-pressed={mapVisible} onClick={() => usePads.setState({ mapVisible: !mapVisible })}>
            {t(mapVisible ? "pads.hideMap" : "pads.showMap")}
          </Button>
          <Button icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
            {t("pads.reset")}
          </Button>
        </>
      }
    >
      <HowItWorks />
      <div className="pads-layout">
        <div className="pads-board">
          <PageTabs onAdded={(i) => setSelected(right(i))} />
          <LiveBoard selected={selected} onSelect={select} compact={compact} />
          <p className="pads-note">{t("pads.board.hint")}</p>
        </div>
        <Inspector selected={selected} onSelect={select} />
      </div>
      <SettingsCard />
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t("pads.resetTitle")}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                resetBoard();
                setSelected(grid(0, 0));
                setConfirmReset(false);
              }}
            >
              {t("pads.resetConfirm")}
            </Button>
          </>
        }
      >
        <p className="pads-note">{t("pads.resetBody")}</p>
      </Modal>
    </Page>
  );
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** The engine only reads audio apps while the Launchpad is connected; the mixer editor wants them anyway. */
function useAudioApps() {
  const mixer = usePads((s) => activePage(s)?.kind === "mixer");
  const connected = usePads((s) => s.connection.state === "connected");
  useEffect(() => {
    if (!mixer || connected) return;
    const load = () => void backend.audioApps().then((audio) => usePads.setState({ audio }), () => {});
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [mixer, connected]);
}

function ConnectionBadge() {
  const t = useT();
  const c = usePads((s) => s.connection);
  switch (c.state) {
    case "connected":
      return (
        <span title={c.port}>
          <Badge tone="success" dot>
            {t("pads.status.connected")}
          </Badge>
        </span>
      );
    case "released":
      return (
        <span title={c.port}>
          <Badge tone="info" dot>
            {t("pads.status.released", { app: c.app })}
          </Badge>
        </span>
      );
    case "busy":
      return (
        <span title={c.message}>
          <Badge tone="warning" dot>
            {t("pads.status.busy")}
          </Badge>
        </span>
      );
    case "searching":
      return <Badge dot>{t("pads.status.searching")}</Badge>;
    case "off":
      return <Badge>{t("pads.status.off")}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function PageTabs({ onAdded }: { onAdded: (index: number) => void }) {
  const t = useT();
  const pages = usePads((s) => s.board.pages);
  const active = usePads((s) => activePage(s)?.id);
  const setPage = usePads((s) => s.setPage);
  return (
    <div className="pads-tabs" role="tablist">
      {pages.map((p) => (
        <button key={p.id} type="button" role="tab" aria-selected={p.id === active} className="pads-tab" onClick={() => setPage(p.id)}>
          <span className="pads-tab__dot" style={{ ["--c" as string]: previewColor(p.color) }} />
          {p.name || t("pads.pad.unnamed")}
          {p.kind !== "grid" && <span className="pads-tab__kind">{t(`pads.page.kinds.${p.kind}`)}</span>}
        </button>
      ))}
      {pages.length < 7 && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus />}
          onClick={() => {
            const i = addBlankPage(t);
            if (i >= 0) onAdded(i);
          }}
        >
          {t("pads.board.addPage")}
        </Button>
      )}
    </div>
  );
}

/** Labels drawn on the board: pad names, page names, and app names on top of mixer columns. */
function boardLabels(page: PadPage | undefined, pages: PadPage[], audio: { process: string }[], t: ReturnType<typeof useT>) {
  const out: Record<string, string> = {};
  pages.slice(0, 7).forEach((p, i) => (out[right(i)] = p.name));
  out[right(7)] = t("pads.board.map");
  if (page?.kind === "agents") {
    out[top(0)] = "+ Claude";
    out[top(1)] = "+ Codex";
    out[top(2)] = t("pads.agents.resume");
    out[top(7)] = t("pads.agents.close");
    for (const s of useAgents.getState().sessions) out[grid(s.slot % 8, Math.floor(s.slot / 8))] = s.title || `${agentName(s.kind)} ${folderName(s.cwd || "~")}`;
  } else if (page?.kind === "tasks") {
    out[top(0)] = t("pads.tasks.add");
    out[top(1)] = t("pads.tasks.clearDone");
    for (const task of page.tasks ?? []) out[grid(task.slot % 8, Math.floor(task.slot / 8))] = (task.done ? "✓ " : "") + task.text;
  } else if (page?.kind === "windows") {
    WINDOW_TOOLS.forEach((tool, i) => (out[top(i)] = toolName(tool.key)));
    for (const w of useOpenWindows.getState().windows) out[grid(w.slot % 8, Math.floor(w.slot / 8))] = windowLabel(w);
  } else if (page?.kind === "mixer") mixerColumns(page, audio).forEach((proc, x) => proc && (out[top(x)] = appName(proc, t)));
  else if (page) for (const [id, def] of Object.entries(page.pads)) out[id] = def.label || describePadAction(def.action);
  return out;
}

/** The Launchpad as it looks right now (redrawn from computeLeds), with labels. */
function LiveBoard({ selected, onSelect, compact }: { selected: string; onSelect: (id: string) => void; compact: boolean }) {
  const t = useT();
  const [, setTick] = useState(0);
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      const seen = attention();
      if (seen === "hidden" || (seen === "background" && ++n % 5)) return;
      setTick((x) => x + 1);
    }, LIVE_MS);
    return () => clearInterval(id);
  }, []);
  const board = usePads((s) => s.board);
  const pageId = usePads((s) => s.pageId);
  const audio = usePads((s) => s.audio);
  const pressed = usePads((s) => s.pressed);
  const labels = boardLabels(activePage({ board, pageId }), board.pages, audio, t);
  const cells: Record<string, PadCell> = {};
  for (const [id, led] of computeLeds()) cells[id] = { color: led.hex, b: led.b, label: labels[id] };
  return <PadGrid cells={cells} selected={selected} pressed={pressed} onSelect={onSelect} compact={compact} />;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsCard() {
  const t = useT();
  const board = usePads((s) => s.board);
  const update = usePads((s) => s.updateBoard);
  const [ports, setPorts] = useState<string[]>([]);
  useEffect(() => {
    void backend.midiList().then((l) => setPorts(l.inputs), () => {});
  }, []);
  return (
    <Card title={t("pads.settings.title")}>
      <div className="pads-form">
        <Field label={t("pads.settings.port")} hint={t("pads.settings.portHint")}>
          <Input className="mono" list="pads-ports" value={board.port} placeholder={t("pads.settings.portAuto")} onChange={(e) => update({ port: e.target.value })} />
          <datalist id="pads-ports">
            {ports.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <Group label={t("pads.settings.mapHotkey")} hint={t("pads.settings.mapHotkeyHint")}>
          <KeyRecorder value={accelToCodes(board.mapHotkey)} onChange={(codes) => update({ mapHotkey: codesToAccel(codes) })} placeholder={t("pads.settings.noHotkey")} />
        </Group>
        <Group label={t("pads.settings.releaseFor")} hint={t("pads.settings.releaseForHint")}>
          <ChipsInput value={board.releaseFor} onChange={(releaseFor) => update({ releaseFor })} placeholder="Ableton Live*" />
        </Group>
        <div className="pads-form__toggle">
          <Toggle checked={board.hud} onChange={(hud) => update({ hud })} label={t("pads.settings.hud")} />
          <span className="kh-field__hint">{t("pads.settings.hudHint")}</span>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

function HowItWorks() {
  const t = useT();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("kh.pads.howto") === "hidden";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem("kh.pads.howto", "hidden");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="pads-howto">
      <div className="pads-howto__head">
        <b>{t("pads.howto.title")}</b>
        <Button size="sm" variant="ghost" onClick={hide}>
          {t("pads.howto.hide")}
        </Button>
      </div>
      <ol className="pads-howto__steps">
        {(["pages", "map", "hold", "presets"] as const).map((k, i) => (
          <li key={k}>
            <span className="pads-howto__n">{i + 1}</span>
            <div>
              <div className="pads-howto__t">{t(`pads.howto.${k}Title`)}</div>
              <div className="pads-howto__d">{t(`pads.howto.${k}`)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
