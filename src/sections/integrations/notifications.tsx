import { useState } from "react";
import { ArrowDown, ArrowUp, BellOff, CheckCheck, ExternalLink, Plus, ShieldCheck, ShieldAlert, Trash2, Zap } from "lucide-react";
import { Badge, Button, ColorInput, Field, Input, Segmented, Toggle } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { KEY_CODES } from "@/core/keymaps";
import { clearNotifications, flash, requestNotificationAccess, UNREAD_APPS, useIntegrations, useNotifications, type NotificationRule } from "@/core/integrations";
import { KeyRecorder } from "../keymaps/KeyRecorder";
import { ChipsInput } from "../keymaps/ChipsInput";
import { accelToCodes, codesToAccel } from "../automations/shared";
import { useUnreadNow } from "./live";
import { Section } from "./common";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function NotificationsPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.notifications);
  const update = useIntegrations((s) => s.update);
  return (
    <div className="integrations-panel">
      <Field label={t("integrations.ui.notifications.source")}>
        <Segmented
          value={cfg.source}
          onChange={(source) => update("notifications", { source })}
          options={[
            { value: "windows", label: t("integrations.ui.notifications.sourceWindows") },
            { value: "titles", label: t("integrations.ui.notifications.sourceTitles") },
          ]}
        />
      </Field>
      {cfg.source === "windows" ? <WindowsSource /> : <TitlesSource />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Windows notifications (Action Center)
// ---------------------------------------------------------------------------

function WindowsSource() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.notifications);
  const update = useIntegrations((s) => s.update);
  const access = useNotifications((s) => s.access);
  const pending = useNotifications((s) => s.pending);
  const recent = useNotifications((s) => s.recent);
  const [open, setOpen] = useState<string | null>(null);

  const setRules = (rules: NotificationRule[]) => update("notifications", { rules });
  const setRule = (id: string, patch: Partial<NotificationRule>) => setRules(cfg.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const rules = [...cfg.rules];
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    [rules[i], rules[j]] = [rules[j], rules[i]];
    setRules(rules);
  };
  const addRule = (seed: Partial<NotificationRule> = {}) => {
    const id = `rule-${Date.now().toString(36)}`;
    const rule: NotificationRule = { id, name: t("integrations.ui.notifications.newRule"), enabled: true, apps: [], contains: [], color: "#5aa9ff", keys: [], hud: false, keepLit: true, ...seed };
    // New rules go first so they win over the defaults and the catch-all.
    setRules([rule, ...cfg.rules]);
    setOpen(id);
  };
  const ruleName = (id: string | null) => cfg.rules.find((r) => r.id === id)?.name;

  return (
    <>
      {access && access !== "allowed" ? (
        <div className="integrations-callout integrations-callout--danger">
          <ShieldAlert />
          <div className="col" style={{ gap: 8 }}>
            <div>{access === "unsupported" ? t("integrations.ui.notifications.unsupported") : t("integrations.ui.notifications.denied")}</div>
            {access !== "unsupported" && (
              <div className="row">
                <Button size="sm" variant="primary" onClick={() => void requestNotificationAccess()}>
                  {t("integrations.ui.notifications.grant")}
                </Button>
                <Button size="sm" icon={<ExternalLink />} onClick={() => void backend.openPath("ms-settings:privacy-notifications")}>
                  {t("integrations.ui.notifications.openSettings")}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="integrations-callout">
          <ShieldCheck />
          <div>{t("integrations.ui.notifications.privacy")}</div>
        </div>
      )}

      <Section
        title={t("integrations.ui.notifications.pending")}
        aside={
          pending.length > 0 && (
            <Button size="sm" icon={<CheckCheck />} onClick={clearNotifications}>
              {t("integrations.ui.notifications.markSeen")}
            </Button>
          )
        }
      >
        {pending.length ? (
          <div className="notif-pending">
            {pending.map((p) => (
              <span key={p.id} className="notif-chip" style={{ ["--c" as string]: p.color }}>
                <span className="notif-chip__dot" />
                <b>{p.app}</b>
                {p.title && <span className="notif-chip__title">{p.title}</span>}
              </span>
            ))}
          </div>
        ) : (
          <p className="integrations-note">{t("integrations.ui.notifications.pendingNone")}</p>
        )}
      </Section>

      <Section
        title={t("integrations.ui.notifications.rules")}
        aside={
          <Button size="sm" icon={<Plus />} onClick={() => addRule()}>
            {t("integrations.ui.notifications.addRule")}
          </Button>
        }
      >
        <p className="integrations-note" style={{ marginTop: 0 }}>
          {t("integrations.ui.notifications.rulesHint")}
        </p>
        <div className="integrations-apps">
          {cfg.rules.map((r, i) => (
            <div key={r.id} className={cx("integrations-app", !r.enabled && "is-off")}>
              <div className="integrations-app__main">
                <span className="integrations-app__icon" style={{ ["--c" as string]: r.mute ? "var(--text-3)" : r.color }}>
                  {r.mute ? <BellOff size={14} /> : (r.name || "?").slice(0, 1)}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="integrations-app__name">
                    {r.name}
                    {r.mute && <Badge>{t("integrations.ui.notifications.muteBadge")}</Badge>}
                    {!r.mute && r.keepLit && <Badge tone="info">{t("integrations.ui.notifications.keepLitBadge")}</Badge>}
                  </div>
                  <div className="integrations-app__proc">
                    {r.apps.length ? r.apps.join(", ") : t("integrations.ui.notifications.anyApp")}
                    {r.contains.length > 0 && ` · ${t("integrations.ui.notifications.containsShort", { words: r.contains.join(", ") })}`}
                  </div>
                </div>
                {!r.mute && <ColorInput value={r.color} onChange={(color) => setRule(r.id, { color })} />}
                <Button size="sm" variant={open === r.id ? "secondary" : "ghost"} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                  {t("integrations.ui.notifications.edit")}
                </Button>
                {!r.mute && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<Zap />}
                    title={t("integrations.ui.notifications.preview")}
                    onClick={() => flash(r.color, r.keys.length ? r.keys : undefined, 2)}
                  />
                )}
                <Toggle checked={r.enabled} onChange={(enabled) => setRule(r.id, { enabled })} />
              </div>
              {open === r.id && (
                <div className="notif-rule">
                  <div className="integrations-form integrations-form--2">
                    <Field label={t("integrations.ui.notifications.name")}>
                      <Input value={r.name} onChange={(e) => setRule(r.id, { name: e.target.value })} />
                    </Field>
                    <Field label={t("integrations.ui.notifications.apps")} hint={t("integrations.ui.notifications.appsHint")}>
                      <ChipsInput value={r.apps} onChange={(apps) => setRule(r.id, { apps })} placeholder="discord, yourphone…" />
                    </Field>
                    <Field label={t("integrations.ui.notifications.contains")} hint={t("integrations.ui.notifications.containsHint")}>
                      <ChipsInput value={r.contains} onChange={(contains) => setRule(r.id, { contains })} placeholder="@you, urgent…" />
                    </Field>
                    {!r.mute && (
                      <Field label={t("integrations.ui.notifications.keys")} hint={t("integrations.ui.notifications.keysHint")}>
                        <ChipsInput value={r.keys} onChange={(keys) => setRule(r.id, { keys })} suggestions={[...KEY_CODES]} placeholder="F1, Escape…" />
                      </Field>
                    )}
                  </div>
                  <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
                    {!r.mute && <Toggle checked={r.keepLit} onChange={(keepLit) => setRule(r.id, { keepLit })} label={t("integrations.ui.notifications.keepLit")} />}
                    {!r.mute && <Toggle checked={r.hud} onChange={(hud) => setRule(r.id, { hud })} label={t("integrations.ui.hud")} />}
                    <Toggle checked={Boolean(r.mute)} onChange={(mute) => setRule(r.id, { mute })} label={t("integrations.ui.notifications.mute")} />
                    <div className="grow" />
                    <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} title={t("integrations.ui.notifications.up")} disabled={i === 0} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} title={t("integrations.ui.notifications.down")} disabled={i === cfg.rules.length - 1} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setRules(cfg.rules.filter((x) => x.id !== r.id))}>
                      {t("integrations.ui.notifications.delete")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-form integrations-form--2">
          <Field label={t("integrations.ui.notifications.indicatorKeys")} hint={t("integrations.ui.notifications.indicatorKeysHint")}>
            <ChipsInput value={cfg.indicatorKeys} onChange={(indicatorKeys) => update("notifications", { indicatorKeys })} suggestions={[...KEY_CODES]} placeholder="Escape" />
          </Field>
          <Field label={t("integrations.ui.notifications.clearHotkey")} hint={t("integrations.ui.notifications.clearHotkeyHint")}>
            <KeyRecorder
              value={accelToCodes(cfg.clearHotkey)}
              onChange={(codes) => update("notifications", { clearHotkey: codesToAccel(codes) })}
              placeholder={t("integrations.ui.mic.noHotkey")}
            />
          </Field>
        </div>
      </Section>

      <Section title={t("integrations.ui.notifications.recent")}>
        {recent.length ? (
          <div className="integrations-apps">
            {recent.map((n) => (
              <div key={n.id} className="integrations-app">
                <div className="integrations-app__main">
                  <span className="mono subtle" style={{ fontSize: 11, width: 40 }}>
                    {time(n.time)}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="integrations-app__name">{n.app}</div>
                    <div className="integrations-app__proc">{n.title}</div>
                  </div>
                  {n.ruleId ? (
                    <Badge tone={n.muted ? undefined : "info"}>{ruleName(n.ruleId) ?? n.ruleId}</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => addRule({ name: n.app, apps: [n.app.toLowerCase()] })}>
                      {t("integrations.ui.notifications.ruleFor", { app: n.app })}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="integrations-note">{t("integrations.ui.notifications.recentNone")}</p>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Legacy: unread badges in window titles
// ---------------------------------------------------------------------------

function TitlesSource() {
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
    <>
      <div className="integrations-callout">
        <ShieldCheck />
        <div>{t("integrations.notifications.bestEffort")}</div>
      </div>
      <div className="integrations-apps">
        {UNREAD_APPS.map((app) => {
          const c = cfg.apps[app.id] ?? { enabled: false, color: "#ffffff", keys: [], hud: false };
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
                  {c.keys.length ? t("integrations.ui.notifications.keysN", { n: c.keys.length }) : t("integrations.ui.notifications.allKeys")}
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
    </>
  );
}
