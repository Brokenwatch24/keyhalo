import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw, Trash2, X } from "lucide-react";
import { Badge, Button, toast } from "@/ui";
import { useT } from "@/i18n";
import { backend, type RecentSession } from "@/core/backend";
import { AGENT_COLORS, agentName, closeAgent, forgetAgent, launchAgent, openAgent, sessionName, useAgents, type AgentKind } from "@/core/agents";
import { GRID, parseButton, previewColor, recentName, resumeNow, usePads } from "@/core/pads";
import { useSettings } from "@/core/state/settings";
import { FolderInput, Group, Head } from "./Inspector";

type T = ReturnType<typeof useT>;

/** Inspector for the Agents page: the selected session (or empty pad) and how agents connect. */
export function AgentsEditor({ selected }: { selected: string }) {
  const t = useT();
  const b = parseButton(selected);
  const slot = b && b.kind === "g" ? b.y * GRID + b.x : -1;
  const session = useAgents((s) => s.sessions.find((x) => x.slot === slot));
  const folder = usePads((s) => s.board.agentFolder);
  const updateBoard = usePads((s) => s.updateBoard);
  const open = (kind: AgentKind) => launchAgent(kind, folder, slot >= 0 ? slot : undefined).catch((e) => toast(String((e as Error)?.message ?? e), "danger"));

  return (
    <>
      {session ? (
        <>
          <Head kicker={t("pads.agents.session", { n: slot + 1 })} title={`${agentName(session.kind)} · ${sessionName(session)}`}>
            <Badge tone={session.state === "waiting" ? "warning" : session.state === "working" ? "info" : undefined} dot>
              {t(`pads.agents.states.${session.state}`)}
            </Badge>
          </Head>
          <div className="pads-insp__section">
            {session.cwd && <div className="mono pads-note">{session.cwd}</div>}
            {session.message && <p className="pads-agent-msg">{session.message}</p>}
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" variant="primary" icon={<ExternalLink />} onClick={() => void openAgent(session.key)}>
                {t("pads.agents.open")}
              </Button>
              <Button size="sm" variant="ghost" icon={<X />} onClick={() => void closeAgent(session.key)}>
                {t("pads.agents.closeIt")}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => forgetAgent(session.key)}>
                {t("pads.agents.forget")}
              </Button>
            </div>
            <p className="pads-note">{t("pads.agents.sessionHint")}</p>
          </div>
        </>
      ) : (
        <>
          <Head kicker={slot >= 0 ? t("pads.agents.emptyKicker", { n: slot + 1 }) : t("pads.agents.page")} title={t("pads.agents.emptyTitle")} />
          <div className="pads-insp__section">
            <p className="pads-note">{t("pads.agents.emptyHint")}</p>
            <div className="row" style={{ gap: 8 }}>
              {(["claude", "codex"] as const).map((k) => (
                <Button key={k} size="sm" onClick={() => void open(k)}>
                  <span className="pads-agent-dot" style={{ ["--c" as string]: previewColor(AGENT_COLORS[k]) }} />
                  {t("pads.agents.openNew", { agent: agentName(k) })}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="pads-insp__section">
        <Group label={t("pads.agents.folder")} hint={t("pads.agents.folderHint")}>
          <FolderInput value={folder} onChange={(agentFolder) => updateBoard({ agentFolder })} />
        </Group>
      </div>
      <Recent t={t} />
      <Connections t={t} />
    </>
  );
}

/** Recent sessions to resume (◀ on the Launchpad does the same, with a pad picker). */
function Recent({ t }: { t: T }) {
  const live = useAgents((s) => s.sessions);
  const [recent, setRecent] = useState<RecentSession[]>([]);
  useEffect(() => {
    backend.agentsRecent(12).then(setRecent, () => setRecent([]));
  }, [live.length]);
  const ids = new Set(live.map((s) => s.id));
  const list = recent.filter((r) => !ids.has(r.sessionId)).slice(0, 8);
  if (!list.length) return null;
  return (
    <div className="pads-insp__section">
      <h4>{t("pads.agents.recent")}</h4>
      {list.map((r) => (
        <div key={r.sessionId} className="pads-agent-conn">
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{recentName(r)}</div>
            <div className="pads-note mono" style={{ margin: 0 }}>
              {r.cwd}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => resumeNow(r)}>
            {t("pads.agents.resumeIt")}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Claude Code hooks and Codex notify: both are needed for pads that blink when an agent needs you. */
function Connections({ t }: { t: T }) {
  const api = useSettings((s) => s.settings.api);
  const [claude, setClaude] = useState<{ installed: boolean; outdated?: boolean } | null>(null);
  const [codex, setCodex] = useState<{ installed: boolean; other?: string | null } | null>(null);
  const refresh = () => {
    backend.claudeHooks("status", api.port).then(setClaude, () => setClaude(null));
    backend.codexNotify("status", api.port).then(setCodex, () => setCodex(null));
  };
  useEffect(refresh, [api.port]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "danger");
    }
  };
  const row = (name: string, ok: boolean | undefined, hint: string, action: React.ReactNode) => (
    <div className="pads-agent-conn">
      <span className="pads-agent-dot" style={{ ["--c" as string]: ok ? "var(--success)" : "var(--text-3)" }} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div>{name}</div>
        <div className="pads-note" style={{ margin: 0 }}>
          {hint}
        </div>
      </div>
      {action}
    </div>
  );
  return (
    <div className="pads-insp__section">
      <h4>{t("pads.agents.connections")}</h4>
      {row(
        "Claude Code",
        claude?.installed,
        claude?.installed ? t("pads.agents.connected") : claude?.outdated ? t("pads.agents.outdated") : t("pads.agents.claudeHint"),
        !claude?.installed && (
          <Button size="sm" onClick={() => void run(() => backend.claudeHooks("install", api.port, api.token))}>
            {t("pads.agents.connect")}
          </Button>
        ),
      )}
      {row(
        "Codex",
        codex?.installed,
        codex?.installed ? t("pads.agents.connected") : codex?.other ? t("pads.agents.codexOther") : t("pads.agents.codexHint"),
        codex?.installed ? (
          <Button size="sm" variant="ghost" onClick={() => void run(() => backend.codexNotify("remove", api.port))}>
            {t("pads.agents.disconnect")}
          </Button>
        ) : (
          !codex?.other && (
            <Button size="sm" onClick={() => void run(() => backend.codexNotify("install", api.port, api.token))}>
              {t("pads.agents.connect")}
            </Button>
          )
        ),
      )}
      {!api.enabled && <p className="pads-note">{t("pads.agents.apiOff")}</p>}
    </div>
  );
}
