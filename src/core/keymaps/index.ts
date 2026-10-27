/** Public API of the keymaps feature (see README.md). */
export { useKeymaps, BUNDLED_PACKS, defaultEnabledIds, isKeyRemapped, type KeymapsState, type PackSource, type ImportResult } from "./store";
export { compileRemapConfig, packsForProcess, packHasRemaps, type CompileOptions } from "./compile";
export { findConflicts, isCompactLayout, OS_RESERVED, type Conflict, type ConflictKind, type ConflictOptions } from "./conflicts";
export { legendColorsFor, layerColorsFor, countLit, type LegendColorOptions } from "./legends";
export { validatePack, riskyActions, type RiskItem, type RiskKind } from "./validate";
export { importVsCodeKeybindings, parseJsonc, parseVsCodeStroke, type VsCodeImportResult } from "./vscode";
export { exportKanata, kanataKey, type KanataExport } from "./kanata";
export { exportAutoHotkey } from "./ahk";
export { CHEATSHEET_OVERLAY, CHEATSHEET_PRIORITY } from "./cheatsheet";
export * from "./codes";
