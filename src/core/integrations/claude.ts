import { useSignals, type Signals } from "@/core/lighting/signals";
import { t } from "@/i18n";
import type { ClaudeConfig } from "./config";
import { flash, hud } from "./feedback";
import { useIntegrations, watchConfig } from "./store";

/**
 * Claude Code status. Hooks call `keyhalo claude <state>` (or POST /api/v1/action
 * {"action":"claude","params":{"state":"waiting"}}); the API forwards it here as an `api-action`.
 */
export type ClaudeState = NonNullable<Signals["claude"]>["state"];
export const CLAUDE_STATES: ClaudeState[] = ["idle", "working", "waiting", "done", "error"];

let cfg: ClaudeConfig | null = null;

export function isClaudeState(v: unknown): v is ClaudeState {
  return typeof v === "string" && (CLAUDE_STATES as string[]).includes(v);
}

/** Apply a Claude Code state change (from the API or the UI's test buttons). */
export function setClaudeState(state: ClaudeState) {
  if (cfg && !cfg.enabled) return;
  const prev = useSignals.getState().claude?.state;
  useSignals.getState().set({ claude: { state, since: Date.now() } });
  useIntegrations.getState().setStatus("claude", "connected", state);
  if (prev === state || !cfg) return;
  if (state === "waiting") {
    if (cfg.hudOnWaiting) hud({ title: t("integrations.claude.waiting"), icon: "info", color: cfg.flashColor, durationMs: 3500 });
    if (cfg.flashOnWaiting) flash(cfg.flashColor, undefined, 3);
  } else if (state === "error") {
    if (cfg.hudOnWaiting) hud({ title: t("integrations.claude.error"), icon: "info", color: "#ff6b6b" });
  } else if (state === "done" && cfg.hudOnWaiting) {
    hud({ title: t("integrations.claude.done"), icon: "info", color: "#7ee0a1" });
  }
}

export function startClaude() {
  watchConfig("claude", (next) => {
    cfg = next;
    if (!next.enabled) {
      useSignals.getState().set({ claude: undefined });
      useIntegrations.getState().setStatus("claude", "idle");
    }
  });
}
