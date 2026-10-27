import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, EyeOff, KeyRound, Mic, MicOff, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { Badge, Button, ColorInput, Field, Input, Progress, Slider, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { useSettings } from "@/core/state/settings";
import { BUILTIN_API_ACTIONS, UNREAD_APPS, flash, haTopics, installGsi, toggleMic, useIntegrations, type GsiInstallResult } from "@/core/integrations";
import { KeyRecorder } from "../keymaps/KeyRecorder";
import { ChipsInput } from "../keymaps/ChipsInput";
import { KEY_CODES } from "@/core/keymaps";
import { accelToCodes, codesToAccel } from "../automations/shared";
import { useUnreadNow } from "./live";
import { CodeBlock, KV, Section } from "./common";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function NotificationsPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.notifications);
  const update = useIntegrations((s) => s.update);
  const counts = useUnreadNow((s) => s.counts);
  const [keysFor, setKeysFor] = useState<string | null>(null);
  const setApp = (id: string, patch: Partial<(typeof cfg.apps)[string]>) =>
    update("notifications", {
      apps: { ...cfg.apps, [id]: { ...cfg.apps[id], ...patch } },
    });

  return (
    <div className="integrations-panel">
      <div className="integrations-callout">
        <ShieldCheck />
        <div>{t("integrations.notifications.bestEffort")}</div>
      </div>
      <div className="integrations-apps">
        {UNREAD_APPS.map((app) => {
          const c = cfg.apps[app.id] ?? {
            enabled: false,
            color: "#ffffff",
            keys: [],
            hud: false,
          };
          const n = counts?.[app.id];
          return (
            <div key={app.id} className={cx("integrations-app", !c.enabled && "is-off")}>
              <div className="integrations-app__main">
                <span className="integrations-app__icon" style={{ ["--c" as string]: c.color }}>
                  {app.name.slice(0, 1)}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="integrations-app__name">
                    {app.name}
                    {n !== undefined && n > 0 && <Badge tone="info">{t("integrations.notifications.unread", { count: n })}</Badge>}
                  </div>
                  <div className="integrations-app__proc mono">{app.processes.join(", ")}</div>
                </div>
                <ColorInput value={c.color} onChange={(color) => setApp(app.id, { color })} />
                <Button size="sm" variant={keysFor === app.id ? "secondary" : "ghost"} onClick={() => setKeysFor((k) => (k === app.id ? null : app.id))}>
                  {c.keys.length
                    ? t("integrations.ui.notifications.keysN", {
                        n: c.keys.length,
                      })
                    : t("integrations.ui.notifications.allKeys")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={<Zap />}
                  title={t("integrations.ui.notifications.preview")}
                  onClick={() => flash(c.color, c.keys.length ? c.keys : undefined, 2)}
                />
                <Toggle checked={c.enabled} onChange={(enabled) => setApp(app.id, { enabled })} />
              </div>
              {keysFor === app.id && (
                <div className="integrations-app__keys">
                  <ChipsInput value={c.keys} onChange={(keys) => setApp(app.id, { keys })} suggestions={[...KEY_CODES]} placeholder="F1, Escape…" />
                  <Toggle checked={c.hud} onChange={(hud) => setApp(app.id, { hud })} label={t("integrations.ui.hud")} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="integrations-note">{counts ? t("integrations.ui.notifications.detected") : t("integrations.ui.notifications.detecting")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Microphone
// ---------------------------------------------------------------------------

export function MicPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.mic);
  const update = useIntegrations((s) => s.update);
  const muted = useSignals((s) => s.micMuted);
  const conflict = /^ctrl\+shift\+m$/i.test(cfg.hotkey.replace(/\s/g, ""));
  return (
    <div className="integrations-panel">
      <div className="integrations-mic">
        <div className={cx("integrations-mic__orb", muted ? "is-muted" : muted === false && "is-live")}>{muted ? <MicOff /> : <Mic />}</div>
        <div className="col" style={{ gap: 6 }}>
          <div className="integrations-mic__state">
            {muted === undefined ? t("integrations.ui.mic.unknown") : muted ? t("integrations.mic.muted") : t("integrations.mic.live")}
          </div>
          <div className="row">
            <Button
              variant="primary"
              icon={muted ? <Mic /> : <MicOff />}
              onClick={() => toggleMic().catch((e) => toast(String((e as Error)?.message ?? e), "danger"))}
            >
              {muted ? t("integrations.ui.mic.unmute") : t("integrations.ui.mic.mute")}
            </Button>
          </div>
        </div>
      </div>
      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-form integrations-form--2">
          <Field label={t("integrations.mic.hotkey")} hint={t("integrations.ui.mic.hotkeyHint")}>
            <KeyRecorder
              value={accelToCodes(cfg.hotkey)}
              onChange={(codes) => update("mic", { hotkey: codesToAccel(codes) })}
              placeholder={t("integrations.ui.mic.noHotkey")}
            />
          </Field>
          <div style={{ paddingTop: 22 }}>
            <Toggle checked={cfg.hud} onChange={(hud) => update("mic", { hud })} label={t("integrations.ui.hud")} />
          </div>
        </div>
        {conflict && (
          <div className="integrations-callout integrations-callout--warn">
            <AlertTriangle />
            <div>{t("integrations.mic.hotkeyConflict")}</div>
          </div>
        )}
        <p className="integrations-note">{t("integrations.ui.mic.keymapHint")}</p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

function Meter({ label, value, color, suffix = "" }: { label: string; value?: number; color: string; suffix?: string }) {
  return (
    <div className="integrations-meter">
      <div className="integrations-meter__top">
        <span>{label}</span>
        <span className="mono">{value === undefined ? "—" : `${Math.round(value)}${suffix}`}</span>
      </div>
      <Progress value={(value ?? 0) / 100} color={color} />
    </div>
  );
}

export function GamesPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.games);
  const update = useIntegrations((s) => s.update);
  const game = useSignals((s) => s.game);
  const [results, setResults] = useState<Partial<Record<"cs2" | "dota2", GsiInstallResult & { busy?: boolean }>>>({});

  const install = async (g: "cs2" | "dota2") => {
    setResults((r) => ({ ...r, [g]: { ok: false, message: "", busy: true } }));
    try {
      const res = await installGsi(g);
      setResults((r) => ({ ...r, [g]: res }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [g]: { ok: false, message: String((e as Error)?.message ?? e) },
      }));
    }
  };

  const games: { id: "cs2" | "dota2" | "lol"; name: string; text: string }[] = [
    {
      id: "cs2",
      name: "Counter-Strike 2",
      text: t("integrations.ui.games.gsi"),
    },
    { id: "dota2", name: "Dota 2", text: t("integrations.ui.games.gsi") },
    {
      id: "lol",
      name: "League of Legends",
      text: t("integrations.ui.games.lol"),
    },
  ];

  return (
    <div className="integrations-panel">
      <div className="integrations-games">
        {games.map((g) => {
          const r = g.id !== "lol" ? results[g.id] : undefined;
          return (
            <div key={g.id} className={cx("integrations-game", !cfg[g.id] && "is-off")}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div className="integrations-game__name">{g.name}</div>
                  <div className="integrations-note">{g.text}</div>
                </div>
                <Toggle checked={cfg[g.id]} onChange={(on) => update("games", { [g.id]: on })} />
              </div>
              {g.id !== "lol" ? (
                <>
                  <Button size="sm" icon={<Download />} onClick={() => install(g.id as "cs2" | "dota2")} disabled={r?.busy || !cfg[g.id]}>
                    {t("integrations.games.install", {
                      game: g.id === "cs2" ? "CS2" : "Dota 2",
                    })}
                  </Button>
                  {r && !r.busy && (
                    <div className={cx("integrations-result", r.ok ? "is-ok" : "is-err")}>
                      {r.ok ? <CheckCircle2 /> : <AlertTriangle />}
                      <div>
                        <div>{r.ok ? t("integrations.games.installed") : r.message.includes("not found") ? t("integrations.games.notFound") : r.message}</div>
                        {r.path && <code>{r.path}</code>}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <Badge>{t("integrations.ui.games.automatic")}</Badge>
              )}
            </div>
          );
        })}
      </div>

      <Section
        title={t("integrations.ui.games.live")}
        aside={
          game && (
            <Badge tone={game.dead ? "danger" : "success"} dot>
              {game.dead
                ? t("integrations.ui.games.dead")
                : t("integrations.ui.games.inGame", {
                    game: game.game === "cs2" ? "CS2" : game.game === "dota2" ? "Dota 2" : "LoL",
                  })}
            </Badge>
          )
        }
      >
        {game ? (
          <div className="integrations-live">
            <div className="integrations-meters">
              <Meter label={t("integrations.ui.games.health")} value={game.health} color="#ef4444" />
              {game.armor !== undefined && <Meter label={t("integrations.ui.games.armor")} value={game.armor} color="#5aa9ff" />}
              {game.ammo !== undefined && <Meter label={t("integrations.ui.games.ammo")} value={game.ammo * 100} color="#f59e0b" suffix="%" />}
              {game.mana !== undefined && <Meter label={t("integrations.ui.games.mana")} value={game.mana} color="#6366f1" />}
            </div>
            <KV
              rows={[
                [t("integrations.ui.games.phase"), game.phase ?? "—"],
                [t("integrations.ui.games.bomb"), game.bomb ? t(`integrations.ui.games.bombState.${game.bomb}`) : "—"],
                [
                  t("integrations.ui.games.effects"),
                  [(game.flashed ?? 0) > 0 && t("integrations.ui.games.flashed"), (game.burning ?? 0) > 0 && t("integrations.ui.games.burning")]
                    .filter(Boolean)
                    .join(", ") || "—",
                ],
              ]}
            />
          </div>
        ) : (
          <div className="integrations-empty">{t("integrations.ui.games.none")}</div>
        )}
        {backend.kind === "mock" && game && <p className="integrations-note">{t("integrations.ui.games.demo")}</p>}
      </Section>

      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-form integrations-form--2">
          <Slider
            label={t("integrations.games.lowHealth")}
            value={cfg.lowHealth}
            min={5}
            max={60}
            unit="%"
            onChange={(lowHealth) => update("games", { lowHealth })}
          />
        </div>
        <div className="integrations-callout">
          <ShieldCheck />
          <div>{t("integrations.games.antiCheat")}</div>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home Assistant / MQTT
// ---------------------------------------------------------------------------

export function HomeAssistantPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.homeAssistant);
  const update = useIntegrations((s) => s.update);
  const [show, setShow] = useState(false);
  const topics = haTopics(cfg);
  return (
    <div className="integrations-panel">
      <Section title={t("integrations.ui.connection")}>
        <div className="integrations-form integrations-form--3">
          <Field label={t("integrations.homeAssistant.host")}>
            <Input
              className="mono"
              value={cfg.host}
              placeholder="homeassistant.local"
              onChange={(e) => update("homeAssistant", { host: e.target.value.trim() })}
            />
          </Field>
          <Field label={t("integrations.homeAssistant.port")}>
            <Input
              className="mono"
              type="number"
              value={cfg.port}
              onChange={(e) =>
                update("homeAssistant", {
                  port: Number(e.target.value) || 1883,
                })
              }
            />
          </Field>
          <Field label={t("integrations.homeAssistant.nodeId")}>
            <Input className="mono" value={cfg.nodeId} placeholder="desk" onChange={(e) => update("homeAssistant", { nodeId: e.target.value })} />
          </Field>
          <Field label={t("integrations.homeAssistant.username")}>
            <Input value={cfg.username} autoComplete="off" onChange={(e) => update("homeAssistant", { username: e.target.value })} />
          </Field>
          <Field label={t("integrations.homeAssistant.password")}>
            <div className="integrations-secret">
              <Input
                type={show ? "text" : "password"}
                value={cfg.password}
                autoComplete="new-password"
                onChange={(e) => update("homeAssistant", { password: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={show ? <EyeOff /> : <Eye />}
                title={t("integrations.ui.reveal")}
                onClick={() => setShow((s) => !s)}
              />
            </div>
          </Field>
        </div>
        <div className="integrations-toggles">
          <Toggle
            checked={cfg.tls}
            onChange={(tls) =>
              update("homeAssistant", {
                tls,
                port: tls && cfg.port === 1883 ? 8883 : !tls && cfg.port === 8883 ? 1883 : cfg.port,
              })
            }
            label={t("integrations.homeAssistant.tls")}
          />
          <Toggle checked={cfg.discovery} onChange={(discovery) => update("homeAssistant", { discovery })} label={t("integrations.homeAssistant.discovery")} />
        </div>
      </Section>
      <Section title={t("integrations.ui.ha.topics")}>
        <KV
          rows={[
            [t("integrations.ui.ha.state"), <code key="s">{topics.state}</code>],
            [t("integrations.ui.ha.set"), <code key="l">{topics.lightSet}</code>],
            [t("integrations.ui.ha.availability"), <code key="a">{topics.availability}</code>],
            ...(cfg.discovery ? ([[t("integrations.ui.ha.discovery"), <code key="d">{topics.discoveryLight}</code>]] as [string, ReactNode][]) : []),
          ]}
        />
      </Section>
      <Section title={t("integrations.ui.setup")}>
        <ol className="integrations-steps">
          <li>{t("integrations.ui.ha.step1")}</li>
          <li>{t("integrations.ui.ha.step2")}</li>
          <li>{t("integrations.ui.ha.step3")}</li>
        </ol>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local API
// ---------------------------------------------------------------------------

function newToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ApiPanel() {
  const t = useT();
  const api = useSettings((s) => s.settings.api);
  const updateSettings = useSettings((s) => s.update);
  const [show, setShow] = useState(false);
  const [port, setPort] = useState(String(api.port));
  const set = (patch: Partial<typeof api>) => updateSettings({ api: { ...api, ...patch } });
  const base = `http://127.0.0.1:${api.port}`;
  const auth = api.token ? ` \\\n  -H "Authorization: Bearer ${api.token}"` : "";
  const endpoints: [string, string, string][] = [
    ["GET", "/api/v1/status", t("integrations.ui.api.ep.status")],
    ["POST", "/api/v1/action", t("integrations.ui.api.ep.action")],
    ["POST", "/api/v1/notify", t("integrations.ui.api.ep.notify")],
    ["WS", "/api/v1/ws", t("integrations.ui.api.ep.ws")],
    ["POST", "/gsi/{game}", t("integrations.ui.api.ep.gsi")],
  ];
  return (
    <div className="integrations-panel">
      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-form integrations-form--api">
          <Field label={t("integrations.ui.port")}>
            <Input
              className="mono"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={() => {
                const n = Number(port);
                if (n >= 1024 && n <= 65535) set({ port: n });
                else setPort(String(api.port));
              }}
            />
          </Field>
          <Field label={t("integrations.ui.api.token")} hint={api.token ? t("integrations.ui.api.tokenHint") : t("integrations.ui.api.noToken")}>
            <div className="integrations-secret">
              <Input className="mono" readOnly type={show || !api.token ? "text" : "password"} value={api.token || t("integrations.ui.api.none")} />
              {api.token && (
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={show ? <EyeOff /> : <Eye />}
                  title={t("integrations.ui.reveal")}
                  onClick={() => setShow((s) => !s)}
                />
              )}
              <Button size="sm" icon={api.token ? <RefreshCw /> : <KeyRound />} onClick={() => set({ token: newToken() })}>
                {api.token ? t("integrations.ui.api.regenerate") : t("integrations.ui.api.generate")}
              </Button>
              {api.token && (
                <Button size="sm" variant="ghost" onClick={() => set({ token: "" })}>
                  {t("integrations.ui.api.remove")}
                </Button>
              )}
            </div>
          </Field>
        </div>
      </Section>
      <Section title={t("integrations.ui.api.endpoints")}>
        <div className="integrations-endpoints">
          {endpoints.map(([m, p, d]) => (
            <div key={p} className="integrations-endpoint">
              <span className={`integrations-method integrations-method--${m.toLowerCase()}`}>{m}</span>
              <code>{p}</code>
              <span className="subtle">{d}</span>
            </div>
          ))}
        </div>
        <div className="integrations-actions-list">
          <span className="integrations-mini-label">{t("integrations.ui.api.actions")}</span>
          {[...BUILTIN_API_ACTIONS, "rule"].map((a) => (
            <code key={a}>{a}</code>
          ))}
          <span className="subtle" style={{ fontSize: 12 }}>
            {t("integrations.ui.api.custom")}
          </span>
        </div>
      </Section>
      <Section title={t("integrations.ui.api.examples")}>
        <div className="integrations-code-grid">
          <CodeBlock
            label="curl"
            code={`curl -X POST ${base}/api/v1/action${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"action":"notify","params":{"text":"Build finished","color":"#7ee0a1"}}'`}
          />
          <CodeBlock
            label="WebSocket"
            code={`ws://127.0.0.1:${api.port}/api/v1/ws${api.token ? `?token=${api.token}` : ""}\n\n// ${t("integrations.ui.api.wsHint")}`}
          />
        </div>
      </Section>
    </div>
  );
}
