import { useState, type ReactNode } from "react";
import { Activity, Bell, Bot, Braces, Check, Copy, Gamepad2, House, Mic, Printer, Timer } from "lucide-react";
import { Badge, Button } from "@/ui";
import { useT } from "@/i18n";
import { useIntegrations, usePomodoro, type IntegrationId } from "@/core/integrations";
import { useSettings } from "@/core/state/settings";
import { copyText } from "../keymaps/util";

export type PanelId = "system" | "bambu" | "claude" | "notifications" | "mic" | "games" | "homeAssistant" | "api" | "pomodoro";

export const PANELS: { id: PanelId; icon: ReactNode }[] = [
  { id: "system", icon: <Activity /> },
  { id: "bambu", icon: <Printer /> },
  { id: "claude", icon: <Bot /> },
  { id: "notifications", icon: <Bell /> },
  { id: "mic", icon: <Mic /> },
  { id: "games", icon: <Gamepad2 /> },
  { id: "homeAssistant", icon: <House /> },
  { id: "api", icon: <Braces /> },
  { id: "pomodoro", icon: <Timer /> },
];

export const isPanel = (id: string | undefined): id is PanelId => PANELS.some((p) => p.id === id);

/** Enabled flag of an integration and its setter (the Local API lives in settings, Pomodoro is start/stop). */
export function useEnabled(id: PanelId): [boolean, (on: boolean) => void] {
  const cfg = useIntegrations((s) => s.config);
  const update = useIntegrations((s) => s.update);
  const api = useSettings((s) => s.settings.api);
  const updateSettings = useSettings((s) => s.update);
  const phase = usePomodoro((s) => s.phase);
  if (id === "api") return [api.enabled, (enabled) => updateSettings({ api: { ...api, enabled } })];
  if (id === "pomodoro") return [phase !== "idle", (on) => (on ? usePomodoro.getState().start() : usePomodoro.getState().stop())];
  return [cfg[id].enabled, (enabled) => update(id, { enabled } as never)];
}

export type Tone = "success" | "warning" | "danger" | "info" | undefined;

/** Status badge text + tone for an integration. */
export function useStatus(id: PanelId): {
  label: string;
  tone: Tone;
  message?: string;
} {
  const t = useT();
  const [enabled] = useEnabled(id);
  const st = useIntegrations((s) => s.status[id as IntegrationId]);
  const phase = usePomodoro((s) => s.phase);
  const paused = usePomodoro((s) => s.pausedRemaining !== null);
  if (id === "pomodoro") {
    if (phase === "idle") return { label: t("integrations.ui.status.ready"), tone: undefined };
    if (paused) return { label: t("integrations.pomodoro.pause"), tone: "warning" };
    return {
      label: t(phase === "focus" ? "integrations.ui.pomodoro.focusing" : "integrations.ui.pomodoro.onBreak"),
      tone: "success",
    };
  }
  if (!enabled) return { label: t("integrations.status.idle"), tone: undefined };
  switch (st?.state) {
    case "connected":
      return {
        label: t("integrations.status.connected"),
        tone: "success",
        message: st.message,
      };
    case "connecting":
      return {
        label: t("integrations.status.connecting"),
        tone: "info",
        message: st.message,
      };
    case "error":
      return {
        label: t("integrations.status.error"),
        tone: "danger",
        message: st.message,
      };
    default:
      return {
        label: t("integrations.ui.status.ready"),
        tone: "info",
        message: st?.message,
      };
  }
}

export function StatusBadge({ id }: { id: PanelId }) {
  const s = useStatus(id);
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

/** Mono code block with a copy button. */
export function CodeBlock({ code, label }: { code: string; label?: ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="integrations-code">
      <div className="integrations-code__head">
        <span>{label}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? <Check /> : <Copy />}
          onClick={() => {
            void copyText(code, t("common.copied"));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

/** Label/value rows. */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="integrations-kv">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="integrations-section">
      <div className="integrations-section__head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function fmtMinutes(min: number | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? t("integrations.ui.hm", { h, m }) : t("integrations.ui.m", { m });
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
