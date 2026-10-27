import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, FlaskConical, Mic, MicOff } from "lucide-react";
import { Button, Page, Progress, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { useRoute, navigate } from "@/app/router";
import { backend } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { useSettings } from "@/core/state/settings";
import { useIntegrations, useNotifications, usePomodoro, useSystemMetrics, type TestResult } from "@/core/integrations";
import { useThemeQuery } from "../keymaps/util";
import { PANELS, StatusBadge, fmtClock, fmtMinutes, isPanel, useEnabled, useStatus, type PanelId } from "./common";
import { useDemoLife, useMetricsHistory, useUnreadNow, useUnreadPolling, wireMetricsHistory } from "./live";
import { BambuPanel, CLAUDE_COLORS, ClaudePanel, DATA_COLORS, FluidSpark, PomodoroPanel, SystemPanel } from "./panels1";
import { ApiPanel, GamesPanel, HomeAssistantPanel, MicPanel } from "./panels2";
import { NotificationsPanel } from "./notifications";
import "./integrations.css";

wireMetricsHistory();

const TESTABLE: PanelId[] = ["system", "bambu", "notifications", "mic", "games", "homeAssistant"];

const PANEL_VIEWS: Record<PanelId, () => ReactNode> = {
  system: () => <SystemPanel />,
  bambu: () => <BambuPanel />,
  claude: () => <ClaudePanel />,
  notifications: () => <NotificationsPanel />,
  mic: () => <MicPanel />,
  games: () => <GamesPanel />,
  homeAssistant: () => <HomeAssistantPanel />,
  api: () => <ApiPanel />,
  pomodoro: () => <PomodoroPanel />,
};

export default function IntegrationsSection() {
  useThemeQuery();
  const t = useT();
  const route = useRoute();
  const selected = isPanel(route[1]) ? route[1] : null;
  // Metrics flow while this page is open (cards and the System panel show them live).
  useSystemMetrics(true);
  const source = useIntegrations((s) => s.config.notifications.source);
  useUnreadPolling(source === "titles");
  useDemoLife();

  return (
    <Page
      title={t("integrations.title")}
      description={t("integrations.ui.description")}
      actions={
        selected ? (
          <Button icon={<ArrowLeft />} onClick={() => navigate("integrations")}>
            {t("integrations.ui.all")}
          </Button>
        ) : undefined
      }
    >
      {selected ? <Detail id={selected} /> : <Grid />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function Grid() {
  return (
    <div className="integrations-grid">
      {PANELS.map((p) => (
        <IntegrationCard key={p.id} id={p.id} icon={p.icon} />
      ))}
    </div>
  );
}

function IntegrationCard({ id, icon }: { id: PanelId; icon: ReactNode }) {
  const t = useT();
  const [enabled, setEnabled] = useEnabled(id);
  return (
    <div
      className={`integrations-card${enabled ? "" : " is-off"}`}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`integrations/${id}`)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && navigate(`integrations/${id}`)}
    >
      <div className="integrations-card__head">
        <span className="integrations-icon">{icon}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="integrations-card__name">{t(`integrations.${id}.name`)}</div>
          <StatusBadge id={id} />
        </div>
        <span onClick={(e) => e.stopPropagation()} className="integrations-card__toggle">
          <Toggle checked={enabled} onChange={setEnabled} />
        </span>
      </div>
      <p className="integrations-card__desc">{t(`integrations.${id}.description`)}</p>
      <div className="integrations-card__live">
        <Readout id={id} />
        <ChevronRight className="integrations-card__chev" />
      </div>
    </div>
  );
}

/** One-line live readout on each card. */
function Readout({ id }: { id: PanelId }) {
  const t = useT();
  const cpu = useMetricsHistory((s) => s.cpu);
  const last = useMetricsHistory((s) => s.last);
  const bambu = useSignals((s) => s.bambu);
  const claude = useSignals((s) => s.claude);
  const mic = useSignals((s) => s.micMuted);
  const game = useSignals((s) => s.game);
  const pomo = useSignals((s) => s.pomodoro);
  const phase = usePomodoro((s) => s.phase);
  const counts = useUnreadNow((s) => s.counts);
  const notifSource = useIntegrations((s) => s.config.notifications.source);
  const pending = useNotifications((s) => s.pending);
  const ha = useIntegrations((s) => s.config.homeAssistant);
  const focusMin = useIntegrations((s) => s.config.pomodoro.focusMin);
  const api = useSettings((s) => s.settings.api);
  const [enabled] = useEnabled(id);

  switch (id) {
    case "system":
      return (
        <div className="integrations-readout integrations-readout--spark">
          <span>
            <b>{last ? Math.round(last.cpuLoad) : "—"}%</b> CPU
            {last?.gpu && (
              <>
                {" · "}
                <b>{Math.round(last.gpu.temp)}°C</b> GPU
              </>
            )}
            {last && (
              <>
                {" · "}
                <b>{Math.round((last.ramUsedMb / last.ramTotalMb) * 100)}%</b> RAM
              </>
            )}
          </span>
          <FluidSpark data={cpu.slice(-40)} color={DATA_COLORS.cpu} height={26} />
        </div>
      );
    case "bambu":
      return bambu ? (
        <div className="integrations-readout integrations-readout--col">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              <b>{Math.round(bambu.progress)}%</b> · {t(`integrations.ui.bambu.states.${bambu.state}`)}
            </span>
            <span className="subtle">
              {bambu.remainingMin
                ? t("integrations.ui.bambu.left", {
                    time: fmtMinutes(bambu.remainingMin, t),
                  })
                : ""}
            </span>
          </div>
          <Progress value={bambu.progress / 100} color={bambu.state === "FAILED" ? "var(--danger)" : bambu.state === "FINISH" ? "var(--success)" : undefined} />
        </div>
      ) : (
        <span className="integrations-readout subtle">{enabled ? t("integrations.ui.bambu.waiting") : t("integrations.ui.notConfigured")}</span>
      );
    case "claude": {
      const st = claude?.state ?? "idle";
      return (
        <span className="integrations-readout">
          <span className="integrations-ldot" style={{ background: CLAUDE_COLORS[st] }} />
          {t(`integrations.ui.claude.states.${st}`)}
        </span>
      );
    }
    case "notifications": {
      if (notifSource === "windows")
        return (
          <span className="integrations-readout">
            {pending.length ? (
              [...new Map(pending.map((p) => [p.app, p])).values()].map((p) => (
                <span key={p.app} className="integrations-unread" style={{ color: p.color }}>
                  {`${p.app} ${pending.filter((x) => x.app === p.app).length}`}
                </span>
              ))
            ) : (
              <span className="subtle">{t("integrations.ui.notifications.pendingNone")}</span>
            )}
          </span>
        );
      const found = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
      return (
        <span className="integrations-readout">
          {found.length ? (
            found.map(([app, n]) => <span key={app} className="integrations-unread">{`${app.charAt(0).toUpperCase()}${app.slice(1)} ${n}`}</span>)
          ) : (
            <span className="subtle">{t("integrations.ui.notifications.none")}</span>
          )}
        </span>
      );
    }
    case "mic":
      return (
        <span className="integrations-readout">
          {mic ? <MicOff className="integrations-readout__icon is-danger" /> : <Mic className="integrations-readout__icon" />}
          {mic === undefined ? t("integrations.ui.mic.unknown") : mic ? t("integrations.mic.muted") : t("integrations.mic.live")}
        </span>
      );
    case "games":
      return game ? (
        <span className="integrations-readout">
          <span
            className="integrations-ldot"
            style={{
              background: game.dead ? "var(--danger)" : "var(--success)",
            }}
          />
          <b>{game.game === "cs2" ? "CS2" : game.game === "dota2" ? "Dota 2" : "LoL"}</b>
          {game.health !== undefined && <span>· {Math.round(game.health)} HP</span>}
          {game.ammo !== undefined && (
            <span className="subtle">
              · {t("integrations.ui.games.ammo")} {Math.round(game.ammo * 100)}%
            </span>
          )}
        </span>
      ) : (
        <span className="integrations-readout subtle">{t("integrations.ui.games.noneShort")}</span>
      );
    case "homeAssistant":
      return ha.host ? (
        <span className="integrations-readout mono">{`${ha.host}:${ha.port}`}</span>
      ) : (
        <span className="integrations-readout subtle">{t("integrations.ui.notConfigured")}</span>
      );
    case "api":
      return (
        <span className="integrations-readout">
          <span className="mono">127.0.0.1:{api.port}</span>
          <span className="subtle">· {api.token ? t("integrations.ui.api.tokenOn") : t("integrations.ui.api.tokenOff")}</span>
        </span>
      );
    case "pomodoro":
      return phase === "idle" ? (
        <span className="integrations-readout subtle">{t("integrations.ui.pomodoro.readyFor", { min: focusMin })}</span>
      ) : (
        <span className="integrations-readout">
          <span className="integrations-ldot" style={{ background: phase === "focus" ? "#ff8a65" : "#7ee0a1" }} />
          <b className="mono">{fmtClock(pomo?.remainingMs ?? 0)}</b>
          {t(phase === "focus" ? "integrations.ui.pomodoro.focusing" : "integrations.ui.pomodoro.onBreak")}
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function Detail({ id }: { id: PanelId }) {
  const t = useT();
  const [enabled, setEnabled] = useEnabled(id);
  const status = useStatus(id);
  const [result, setResult] = useState<{ id: PanelId; res: TestResult } | null>(null);
  const [testing, setTesting] = useState(false);
  const icon = PANELS.find((p) => p.id === id)?.icon;

  const test = async () => {
    setTesting(true);
    const res = await useIntegrations.getState().test(id as never);
    setTesting(false);
    setResult({ id, res });
    if (!res.ok) toast(res.message, "danger");
  };

  return (
    <div className="integrations-detail">
      <nav className="integrations-nav">
        {PANELS.map((p) => (
          <NavItem key={p.id} id={p.id} icon={p.icon} active={p.id === id} />
        ))}
      </nav>
      <div className="integrations-main">
        <header className="integrations-head">
          <span className="integrations-icon integrations-icon--lg">{icon}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <h2>{t(`integrations.${id}.name`)}</h2>
            <p>{t(`integrations.${id}.description`)}</p>
          </div>
          <div className="integrations-head__actions">
            <StatusBadge id={id} />
            {TESTABLE.includes(id) && (
              <Button size="sm" icon={<FlaskConical />} onClick={test} disabled={testing}>
                {t("integrations.test")}
              </Button>
            )}
            <Toggle checked={enabled} onChange={setEnabled} label={id === "pomodoro" ? t("integrations.ui.running") : t("common.enabled")} />
          </div>
        </header>
        {status.tone === "danger" && status.message && (
          <div className="integrations-callout integrations-callout--danger">
            <AlertTriangle />
            <div>{status.message}</div>
          </div>
        )}
        {result && result.id === id && (
          <div className={`integrations-callout ${result.res.ok ? "integrations-callout--ok" : "integrations-callout--danger"}`}>
            {result.res.ok ? <CheckCircle2 /> : <AlertTriangle />}
            <div>{result.res.message}</div>
          </div>
        )}
        {backend.kind === "mock" && (id === "mic" || id === "notifications" || id === "games") && (
          <div className="integrations-demo-note">{t("integrations.ui.demoNote")}</div>
        )}
        {PANEL_VIEWS[id]()}
      </div>
    </div>
  );
}

function NavItem({ id, icon, active }: { id: PanelId; icon: ReactNode; active: boolean }) {
  const t = useT();
  const s = useStatus(id);
  return (
    <a
      href={`#/integrations/${id}`}
      className="integrations-nav__item"
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(`integrations/${id}`);
      }}
    >
      {icon}
      <span className="grow">{t(`integrations.${id}.name`)}</span>
      <span className={`integrations-ndot integrations-ndot--${s.tone ?? "none"}`} title={s.label} />
    </a>
  );
}
