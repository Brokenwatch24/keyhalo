import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Copy, Download, FileDown, Play, Plus, ShieldAlert, Sparkles, Trash2, Workflow } from "lucide-react";
import { Badge, Button, Card, EmptyState, Modal, Page, Segmented, TextArea, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import type { Rule } from "@/core/types";
import { useRules, type RuleImportResult, type RunLogEntry } from "@/core/automation";
import { backend } from "@/core/backend";
import { useDevices } from "@/core/devices";
import { useProfiles } from "@/core/lighting/profiles";
import { useSettings } from "@/core/state/settings";
import { ConfirmModal } from "../keymaps/Modals";
import { downloadText, pickTextFile, useThemeQuery } from "../keymaps/util";
import { RuleEditor, type RuleDraft } from "./RuleEditor";
import { TEMPLATES } from "./templates";
import { ACTION_ICONS, TRIGGER_ICONS, actionLabel, describe, relativeTime, ruleColor } from "./shared";
import "./automations.css";

let demoSeeded = false;

/** Browser demo: a few plausible past runs so the activity log isn't empty. In-memory only. */
function seedDemoLog() {
  if (demoSeeded || backend.kind !== "mock") return;
  const s = useRules.getState();
  if (!s.loaded || s.log.length || !s.rules.length) return;
  demoSeeded = true;
  // First visit of the demo: switch a few harmless example rules on so the list shows both states.
  try {
    if (!localStorage.getItem("kh-demo-rules") && s.rules.every((r) => !r.enabled)) {
      for (const id of ["example-morning", "example-bomb-planted", "example-cpu-hot"]) if (s.rules.some((r) => r.id === id)) s.setEnabled(id, true);
    }
    localStorage.setItem("kh-demo-rules", "1");
  } catch {
    /* storage unavailable */
  }
  const now = Date.now();
  const pick = (id: string) => s.rules.find((r) => r.id === id) ?? s.rules[0];
  const entries: [Rule, number, boolean, string?][] = [
    [pick("example-morning"), 7.2 * 3600_000, true],
    [pick("example-bomb-planted"), 2.4 * 3600_000, true],
    [pick("example-bomb-planted"), 2.1 * 3600_000, true],
    [pick("example-doorbell"), 54 * 60_000, false, "MQTT broker not connected"],
    [pick("example-cpu-hot"), 23 * 60_000, true],
    [pick("example-idle-dim"), 6 * 60_000, true],
  ];
  for (const [rule, ago, ok, error] of entries)
    s.pushLog({
      ruleId: rule.id,
      ruleName: rule.name,
      at: now - ago,
      reason: "demo",
      manual: false,
      ok,
      error,
    });
}

export default function AutomationsSection() {
  useThemeQuery();
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const rules = useRules((s) => s.rules);
  const log = useRules((s) => s.log);
  const loaded = useRules((s) => s.loaded);
  const profiles = useProfiles((s) => s.profiles);
  const devices = useDevices((s) => s.devices);
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Rule | null>(null);
  const [importing, setImporting] = useState(false);
  const [, tick] = useState(0);

  useEffect(seedDemoLog, [loaded, rules.length]);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name;
  const deviceName = (id: string) => devices.find((d) => d.uid === id || d.definition.id === id)?.definition.name;
  const lastRun = useMemo(() => {
    const out: Record<string, RunLogEntry> = {};
    for (const e of log) if (!out[e.ruleId]) out[e.ruleId] = e;
    return out;
  }, [log]);
  const enabledCount = rules.filter((r) => r.enabled).length;

  const run = async (r: Rule) => {
    const res = await useRules.getState().testRule(r.id);
    if (!res) toast(t("automation.ui.testUnavailable"), "danger");
    else if (res.ok) toast(t("automation.ui.testOk", { name: r.name }));
    else toast(`${t("automation.ui.testFailed")}: ${res.error ?? ""}`, "danger");
  };

  const fromTemplate = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (tpl) setEditing(tpl.build({ t, profiles, devices }));
  };

  return (
    <Page
      title={t("automation.title")}
      description={t("automation.ui.description")}
      actions={
        <>
          <Button icon={<FileDown />} onClick={() => setImporting(true)}>
            {t("common.import")}
          </Button>
          <Button
            icon={<Download />}
            disabled={!rules.length}
            onClick={() => downloadText("keyhalo-rules.json", useRules.getState().exportRules(), "application/json")}
          >
            {t("common.export")}
          </Button>
          <Button
            variant="primary"
            icon={<Plus />}
            onClick={() =>
              setEditing({
                name: "",
                enabled: true,
                trigger: { type: "appFocus", process: "" },
                actions: [{ type: "flash", color: "#5aa9ff", times: 3 }],
              })
            }
          >
            {t("automation.newRule")}
          </Button>
        </>
      }
    >
      <section className="automations-templates">
        <div className="automations-section-head">
          <Sparkles />
          <span>{t("automation.ui.quickStart")}</span>
        </div>
        <div className="automations-template-grid">
          {TEMPLATES.map((tpl) => {
            const sample = tpl.build({ t, profiles, devices });
            return (
              <button key={tpl.id} type="button" className="automations-template" onClick={() => fromTemplate(tpl.id)}>
                <div className="automations-template__flow">
                  <span className="automations-glyph">{TRIGGER_ICONS[sample.trigger.type]}</span>
                  <ArrowRight className="automations-template__arrow" />
                  <span className="automations-glyph" style={glyphStyle(ruleColor({ ...sample, id: "" }))}>
                    {ACTION_ICONS[sample.actions[0].type]}
                  </span>
                </div>
                <div className="automations-template__title">{t(`automation.ui.templates.${tpl.id}.title`)}</div>
                <div className="automations-template__text">{t(`automation.ui.templates.${tpl.id}.text`)}</div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="automations-layout">
        <Card
          flush
          title={
            <span className="row">
              {t("automation.ui.rules")}
              <span className="subtle" style={{ fontWeight: 400 }}>
                {t("automation.ui.enabledOf", {
                  n: enabledCount,
                  total: rules.length,
                })}
              </span>
            </span>
          }
        >
          {rules.length === 0 ? (
            <EmptyState
              icon={<Workflow />}
              title={t("automation.ui.emptyTitle")}
              action={
                <Button variant="primary" icon={<Plus />} onClick={() => fromTemplate("dimNight")}>
                  {t("automation.ui.startTemplate")}
                </Button>
              }
            >
              {t("automation.ui.emptyText")}
            </EmptyState>
          ) : (
            <div className="automations-rules">
              {rules.map((r) => {
                const last = lastRun[r.id];
                return (
                  <div
                    key={r.id}
                    className={`automations-rule${r.enabled ? "" : " is-off"}`}
                    onClick={() => setEditing(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setEditing(r)}
                  >
                    <span onClick={(e) => e.stopPropagation()} className="automations-rule__toggle">
                      <Toggle checked={r.enabled} onChange={(on) => useRules.getState().setEnabled(r.id, on)} />
                    </span>
                    <span className="automations-glyph" style={glyphStyle(r.enabled ? ruleColor(r) : undefined)}>
                      {TRIGGER_ICONS[r.trigger.type]}
                    </span>
                    <div className="automations-rule__main">
                      <div className="automations-rule__name">{r.name}</div>
                      <div className="automations-rule__when">{describe(t, r.trigger, deviceName)}</div>
                    </div>
                    <div className="automations-rule__actions">
                      {r.actions.slice(0, 3).map((a, i) => (
                        <span key={i} className="automations-chip" title={t(`automation.actions.${a.type}`)}>
                          {ACTION_ICONS[a.type]}
                          {"color" in a && a.color && <span className="automations-chip__dot" style={{ background: a.color }} />}
                          <span className="automations-chip__text">{actionLabel(t, a, profileName)}</span>
                        </span>
                      ))}
                      {r.actions.length > 3 && <span className="automations-chip">+{r.actions.length - 3}</span>}
                    </div>
                    <div className="automations-rule__last">
                      {last ? (
                        <span className={last.ok ? "" : "automations-err"} title={new Date(last.at).toLocaleString(lang)}>
                          {relativeTime(lang, last.at)}
                        </span>
                      ) : (
                        <span className="subtle">{t("automation.ui.never")}</span>
                      )}
                    </div>
                    <div className="automations-rule__tools" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" iconOnly icon={<Play />} title={t("automation.test")} onClick={() => run(r)} />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<Copy />}
                        title={t("common.duplicate")}
                        onClick={() => {
                          const c = useRules.getState().duplicate(r.id);
                          if (c) toast(t("automation.ui.duplicated", { name: c.name }));
                        }}
                      />
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title={t("common.delete")} onClick={() => setConfirmDelete(r)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <RunLog log={log} rules={rules} />
      </div>

      {editing && (
        <RuleEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onDelete={(id) => {
            const r = rules.find((x) => x.id === id);
            if (r) setConfirmDelete(r);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={t("automation.ui.deleteTitle")}
          body={t("automation.ui.deleteBody", { name: confirmDelete.name })}
          confirm={t("common.delete")}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            useRules.getState().remove(confirmDelete.id);
            setEditing(null);
          }}
        />
      )}
      {importing && <ImportRulesModal onClose={() => setImporting(false)} />}
    </Page>
  );
}

const glyphStyle = (color?: string) =>
  color
    ? {
        color,
        background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
        borderColor: `color-mix(in srgb, ${color} 30%, var(--border))`,
      }
    : undefined;

function RunLog({ log, rules }: { log: RunLogEntry[]; rules: Rule[] }) {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const devices = useDevices((s) => s.devices);
  const deviceName = (id: string) => devices.find((d) => d.uid === id)?.definition.name;
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" });
  const today = new Date().toDateString();
  const when = (at: number) => (new Date(at).toDateString() === today ? time.format(at) : `${day.format(at)} ${time.format(at)}`);
  return (
    <Card
      flush
      className="automations-log"
      title={t("automation.log")}
      subtitle={t("automation.ui.logHint")}
      actions={
        log.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => useRules.getState().clearLog()}>
            {t("automation.ui.clear")}
          </Button>
        )
      }
    >
      {log.length === 0 ? (
        <div className="automations-log__empty">{t("automation.logEmpty")}</div>
      ) : (
        <ol className="automations-log__list">
          {log.map((e) => {
            const rule = rules.find((r) => r.id === e.ruleId);
            const why = e.manual ? t("automation.manual") : rule ? describe(t, rule.trigger, deviceName) : e.reason;
            return (
              <li key={e.id} className="automations-log__item">
                <span className={`automations-log__dot${e.ok ? "" : " is-err"}`} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="automations-log__row">
                    <span className="automations-log__name">{e.ruleName}</span>
                    <time className="automations-log__time" title={new Date(e.at).toLocaleString(lang)}>{when(e.at)}</time>
                  </div>
                  <div className="automations-log__why">
                    {e.manual && <Badge>{t("automation.manual")}</Badge>}
                    {!e.manual && <span>{why}</span>}
                    {!e.ok && <span className="automations-err"> · {e.error ?? t("automation.ui.failed")}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function ImportRulesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [result, setResult] = useState<RuleImportResult | null>(null);
  const doImport = () => {
    const r = useRules.getState().importRules(text);
    setResult(r);
    if (r.ok && r.risky.length === 0) {
      toast(t("automation.ui.imported", { n: r.rules.length }));
      onClose();
    }
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("automation.ui.importTitle")}
      footer={
        result?.ok ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!text.trim()} onClick={doImport}>
              {t("common.import")}
            </Button>
          </>
        )
      }
    >
      {result?.ok ? (
        <div className="col" style={{ gap: 12 }}>
          <p>{t("automation.ui.imported", { n: result.rules.length })}</p>
          <div className="automations-callout automations-callout--warn">
            <ShieldAlert />
            <div>
              <div>{t("automation.reviewImport")}</div>
              <ul>
                {result.risky.map((r, i) => (
                  <li key={i}>
                    <strong>{r.rule.name}</strong> — {t(`automation.actions.${r.action.type}`)} <code>{r.detail}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "file", label: t("keymaps.ui.import.file") },
              { value: "paste", label: t("keymaps.ui.import.paste") },
            ]}
          />
          <p className="muted">{t("automation.ui.importHint")}</p>
          {mode === "file" && (
            <div className="automations-drop">
              <FileDown />
              <span className="grow">{name ?? t("keymaps.ui.import.noFile")}</span>
              <Button
                onClick={async () => {
                  const f = await pickTextFile(".json,application/json");
                  if (f) {
                    setName(f.name);
                    setText(f.text);
                  }
                }}
              >
                {t("keymaps.ui.import.choose")}
              </Button>
            </div>
          )}
          {(mode === "paste" || text) && (
            <TextArea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "version": 1, "rules": [ … ] }' spellCheck={false} />
          )}
          {result && !result.ok && (
            <div className="automations-callout automations-callout--warn">
              <ShieldAlert />
              <ul>
                {result.errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
