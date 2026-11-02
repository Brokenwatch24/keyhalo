import { create } from "zustand";
import type { AudioApp, MediaState } from "@/core/backend";
import { loadJson, saveJsonDebounced } from "@/core/state/persist";
import { agentsPage, defaultBoard, DEFAULT_RELEASE_FOR, tasksPage, windowsPage } from "./defaults";
import type { PadBoard, PadButtonId, PadConnection, PadDef, PadPage } from "./types";

const FILE = "pads.json";

export interface PadsState {
  board: PadBoard;
  loaded: boolean;
  connection: PadConnection;
  /** Active page id. */
  pageId: string;
  /** Buttons held right now (physical or on-screen). */
  pressed: Record<PadButtonId, true>;
  /** Live data for mixer / media / "running" pads. */
  audio: AudioApp[];
  media: MediaState | null;
  /** Lower-case names of running processes. */
  running: string[];
  mapVisible: boolean;

  hydrate(): Promise<void>;
  setBoard(board: PadBoard): void;
  updateBoard(patch: Partial<PadBoard>): void;
  setPage(id: string): void;
  updatePage(id: string, patch: Partial<PadPage>): void;
  addPage(page: PadPage): void;
  removePage(id: string): void;
  /** Set (or clear with null) one button on a page. */
  setPad(pageId: string, button: PadButtonId, def: PadDef | null): void;
  resetBoard(): void;
}

function normalise(saved: Partial<PadBoard> | null): PadBoard {
  const d = defaultBoard();
  if (!saved || !Array.isArray(saved.pages) || saved.pages.length === 0) return d;
  // 1.2 betas shipped an empty "Work" page where the Agents page now lives.
  const pages = saved.pages.slice(0, 7).map((p) => {
    if (p.id === "work" && p.kind === "grid" && !Object.keys(p.pads ?? {}).length) return agentsPage();
    // The default "Explorer" pad opened File Explorer too easily; it is no longer a default.
    const ex = p.pads?.["g:6,0"];
    if (p.id === "home" && ex?.label === "Explorer" && ex.action?.type === "app" && ex.action.path === "explorer.exe") {
      const pads = { ...p.pads };
      delete pads["g:6,0"];
      return { ...p, pads };
    }
    return p;
  });
  // Boards from before the Windows page get it once (if there is room); deleting it sticks.
  if ((saved.version ?? 1) < 2 && pages.length < 7 && !pages.some((p) => p.kind === "windows" || p.id === "windows")) pages.push(windowsPage());
  if ((saved.version ?? 1) < 3 && pages.length < 7 && !pages.some((p) => p.kind === "tasks" || p.id === "tasks")) pages.push(tasksPage());
  return {
    version: 3,
    pages,
    port: typeof saved.port === "string" ? saved.port : "",
    releaseFor: Array.isArray(saved.releaseFor) ? saved.releaseFor : DEFAULT_RELEASE_FOR,
    mapHotkey: typeof saved.mapHotkey === "string" ? saved.mapHotkey : "",
    hud: typeof saved.hud === "boolean" ? saved.hud : true,
    agentFolder: typeof saved.agentFolder === "string" ? saved.agentFolder : "",
  };
}

export const usePads = create<PadsState>((set, get) => {
  const save = (board: PadBoard) => {
    set({ board });
    saveJsonDebounced(FILE, board);
  };
  return {
    board: defaultBoard(),
    loaded: false,
    connection: { state: "searching" },
    pageId: "home",
    pressed: {},
    audio: [],
    media: null,
    running: [],
    mapVisible: false,

    async hydrate() {
      const board = normalise(await loadJson<Partial<PadBoard>>(FILE));
      set({ board, loaded: true, pageId: board.pages[0]?.id ?? "home" });
    },
    setBoard: (board) => save(normalise(board)),
    updateBoard: (patch) => save({ ...get().board, ...patch }),
    setPage(id) {
      if (get().board.pages.some((p) => p.id === id)) set({ pageId: id });
    },
    updatePage(id, patch) {
      save({ ...get().board, pages: get().board.pages.map((p) => (p.id === id ? { ...p, ...patch, id } : p)) });
    },
    addPage(page) {
      if (get().board.pages.length >= 7) return;
      save({ ...get().board, pages: [...get().board.pages, page] });
    },
    removePage(id) {
      const pages = get().board.pages.filter((p) => p.id !== id);
      if (!pages.length) return;
      save({ ...get().board, pages });
      if (get().pageId === id) set({ pageId: pages[0].id });
    },
    setPad(pageId, button, def) {
      const pages = get().board.pages.map((p) => {
        if (p.id !== pageId) return p;
        const pads = { ...p.pads };
        if (def) pads[button] = def;
        else delete pads[button];
        return { ...p, pads };
      });
      save({ ...get().board, pages });
    },
    resetBoard() {
      const board = defaultBoard();
      save(board);
      set({ pageId: board.pages[0].id });
    },
  };
});

export const activePage = (s: Pick<PadsState, "board" | "pageId"> = usePads.getState()): PadPage | undefined =>
  s.board.pages.find((p) => p.id === s.pageId) ?? s.board.pages[0];
