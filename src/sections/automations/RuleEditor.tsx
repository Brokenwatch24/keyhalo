import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Info, Play, Trash2 } from "lucide-react";
import { Button, ColorInput, Field, Input, Modal, Segmented, Select, Slider, TextArea, toast } from "@/ui";
import { useT } from "@/i18n";
import type { Rule, RuleAction, Trigger } from "@/core/types";
import { useRules, validateRule } from "@/core/automation";
import { useDevices } from "@/core/devices";
import { useProfiles } from "@/core/lighting/profiles";
import { useSettings } from "@/core/state/settings";
import { useIntegrations, GAME_EVENTS } from "@/core/integrations";
import { KEY_CODES } from "@/core/keymaps";
import { KeyRecorder } from "../keymaps/KeyRecorder";
import { ChipsInput } from "../keymaps/ChipsInput";
import { useProcessSuggestions } from "../keymaps/Modals";
import { copyText } from "../keymaps/util";
import { ACTION_ICONS, ACTION_TYPES, TRIGGER_ICONS, TRIGGER_TYPES, WEEK, accelToCodes, codesToAccel, describe } from "./shared";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export type RuleDraft = Omit<Rule, "id"> & { id?: string };

function defaultTrigger(type: Trigger["type"]): Trigger {
  switch (type) {
    case "appFocus":
    case "appLaunch":
      return { type, process: "" };
    case "time":
      return { type, at: "09:00" };
    case "batteryBelow":
      return { type, percent: 20 };
    case "idle":
      return { type, minutes: 10 };
    case "cpuAbove":
      return { type, percent: 90 };
    case "gpuTempAbove":
      return { type, celsius: 80 };
    case "mqtt":
      return { type, topic: "home/doorbell" };
    case "api":
      return { type, event: "my-action" };
    case "game":
      return { type, game: "cs2", event: "bomb_planted" };
    case "hotkey":
      return { type, accelerator: "Ctrl+Alt+P" };
  }
}

function defaultAction(type: RuleAction["type"], profileId: string): RuleAction {
  switch (type) {
    case "profile":
      return { type, profileId };
    case "flash":
      return { type, color: "#5aa9ff", times: 3 };
    case "notify":
      return { type, text: "", color: "#ffffff" };
    case "dpi":
      return { type, value: 800 };
    case "brightness":
      return { type, value: 0.5 };
    case "mqttPublish":
      return { type, topic: "keyhalo/event", payload: "ON" };
    case "http":
      return { type, method: "POST", url: "https://", body: "" };
    case "pauseRemap":
      return { type, paused: true };
  }
}

export function RuleEditor({ initial, onClose, onDelete }: { initial: RuleDraft; onClose: () => void; onDelete?: (id: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<RuleDraft>(() => JSON.parse(JSON.stringify(initial)));
  const [busy, setBusy] = useState(false);
  const profiles = useProfiles((s) => s.profiles);
  const devices = useDevices((s) => s.devices);
  const deviceName = (id: string) => devices.find((d) => d.uid === id || d.definition.id === id)?.definition.name;
  const isNew = !draft.id || !useRules.getState().rules.some((r) => r.id === draft.id);

  const errors = useMemo(() => validateRule({ ...draft, id: draft.id ?? "draft" }), [draft]);
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTrigger = (trigger: Trigger) => set({ trigger });
  const setAction = (i: number, a: RuleAction) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.actions.length) return;
    const next = [...draft.actions];
    [next[i], next[j]] = [next[j], next[i]];
    set({ actions: next });
  };

  /** Save and return the stored id. */
  const persist = (): string | null => {
    if (errors.length) return null;
    const store = useRules.getState();
    const clean: RuleDraft = {
      ...draft,
      name: draft.name.trim() || describe(t, draft.trigger, deviceName),
    };
    if (!clean.cooldown) delete clean.cooldown;
    if (!isNew && draft.id) {
      const { id, ...rest } = clean;
      store.update(id!, rest);
      return id!;
    }
    const r = store.add(clean);
    setDraft((d) => ({ ...d, id: r.id }));
    return r.id;
  };

  const save = () => {
    if (persist()) onClose();
  };
  const test = async () => {
    const id = persist();
    if (!id) return;
    setBusy(true);
    const res = await useRules.getState().testRule(id);
    setBusy(false);
    if (!res) toast(t("automation.ui.testUnavailable"), "danger");
    else if (res.ok) toast(t("automation.ui.testOk", { name: res.ruleName }));
    else toast(`${t("automation.ui.testFailed")}: ${res.error ?? ""}`, "danger");
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? t("automation.newRule") : t("automation.ui.editRule")}
      footer={
        <>
          {!isNew && draft.id && (
            <>
              <Button variant="danger" icon={<Trash2 />} onClick={() => onDelete?.(draft.id!)}>
                {t("common.delete")}
              </Button>
              <Button
                icon={<Copy />}
                onClick={() => {
                  const r = useRules.getState().duplicate(draft.id!);
                  if (r) toast(t("automation.ui.duplicated", { name: r.name }));
                  onClose();
                }}
              >
                {t("common.duplicate")}
              </Button>
              <Button variant="ghost" onClick={() => copyText(useRules.getState().exportRules([draft.id!]), t("automation.ui.exportCopied"))}>
                {t("common.export")}
              </Button>
            </>
          )}
          <span style={{ flex: 1 }} />
          <Button icon={<Play />} onClick={test} disabled={busy || errors.length > 0}>
            {t("automation.test")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={errors.length > 0}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="automations-editor">
        <div className="automations-editor__name">
          <Field label={t("common.name")}>
            <Input value={draft.name} placeholder={describe(t, draft.trigger, deviceName)} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
        </div>

        <section className="automations-step">
          <div className="automations-step__rail">
            <span className="automations-step__dot">1</span>
          </div>
          <div className="automations-step__body">
            <h3 className="automations-step__h">{t("automation.when")}</h3>
            <div className="automations-tiles">
              {TRIGGER_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={cx("automations-tile", draft.trigger.type === type && "is-active")}
                  onClick={() => type !== draft.trigger.type && setTrigger(defaultTrigger(type))}
                >
                  {TRIGGER_ICONS[type]}
                  <span>{t(`automation.ui.triggerShort.${type}`)}</span>
                </button>
              ))}
            </div>
            <div className="automations-panel">
              <TriggerFields trigger={draft.trigger} onChange={setTrigger} />
            </div>
          </div>
        </section>

        <section className="automations-step">
          <div className="automations-step__rail">
            <span className="automations-step__dot">2</span>
          </div>
          <div className="automations-step__body">
            <h3 className="automations-step__h">{t("automation.then")}</h3>
            <div className="col" style={{ gap: 8 }}>
              {draft.actions.map((a, i) => (
                <div key={i} className="automations-action">
                  <div className="automations-action__head">
                    <span className="automations-action__icon">{ACTION_ICONS[a.type]}</span>
                    <select
                      className="kh-select automations-action__type"
                      value={a.type}
                      onChange={(e) => setAction(i, defaultAction(e.target.value as RuleAction["type"], profiles[0]?.id ?? ""))}
                    >
                      {ACTION_TYPES.map((x) => (
                        <option key={x} value={x}>
                          {t(`automation.actions.${x}`)}
                        </option>
                      ))}
                    </select>
                    <span style={{ flex: 1 }} />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<ArrowUp />}
                      title={t("keymaps.ui.moveUp")}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<ArrowDown />}
                      title={t("keymaps.ui.moveDown")}
                      disabled={i === draft.actions.length - 1}
                      onClick={() => move(i, 1)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<Trash2 />}
                      title={t("common.delete")}
                      onClick={() =>
                        set({
                          actions: draft.actions.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </div>
                  <ActionFields action={a} onChange={(x) => setAction(i, x)} />
                </div>
              ))}
              {draft.actions.length === 0 && <div className="automations-empty-actions">{t("automation.ui.noActions")}</div>}
              <div className="automations-add">
                <span className="automations-add__label">{t("automation.ui.addAction")}</span>
                {ACTION_TYPES.map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="ghost"
                    icon={ACTION_ICONS[type]}
                    onClick={() =>
                      set({
                        actions: [...draft.actions, defaultAction(type, profiles[0]?.id ?? "")],
                      })
                    }
                  >
                    {t(`automation.actions.${type}`)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="automations-step automations-step--last">
          <div className="automations-step__rail">
            <span className="automations-step__dot">3</span>
          </div>
          <div className="automations-step__body">
            <h3 className="automations-step__h">{t("automation.ui.options")}</h3>
            <div className="automations-grid2">
              <Field label={t("automation.cooldown")} hint={t("automation.ui.cooldownHint")}>
                <Input
                  type="number"
                  min={0}
                  step={5}
                  value={draft.cooldown ?? 0}
                  onChange={(e) => set({ cooldown: Math.max(0, Number(e.target.value) || 0) })}
                />
              </Field>
              <Field label={t("common.enabled")}>
                <Segmented
                  value={draft.enabled ? "on" : "off"}
                  onChange={(v) => set({ enabled: v === "on" })}
                  options={[
                    { value: "on", label: t("common.on") },
                    { value: "off", label: t("common.off") },
                  ]}
                />
              </Field>
            </div>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="automations-callout automations-callout--warn">
            <AlertTriangle />
            <ul>
              {errors.slice(0, 4).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Trigger fields
// ---------------------------------------------------------------------------

function TriggerFields({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const t = useT();
  const procs = useProcessSuggestions();
  const devices = useDevices((s) => s.devices);
  const live = useDevices((s) => s.live);
  const port = useSettings((s) => s.settings.api.port);
  const mqttStatus = useIntegrations((s) => s.status.homeAssistant?.state ?? "idle");
  const listId = "automations-procs";

  switch (trigger.type) {
    case "appFocus":
    case "appLaunch":
      return (
        <Field label={t("automation.ui.fields.process")} hint={t("automation.ui.fields.processHint")}>
          <Input
            list={listId}
            className="mono"
            value={trigger.process}
            placeholder="cs2.exe"
            onChange={(e) => onChange({ ...trigger, process: e.target.value })}
          />
          <datalist id={listId}>
            {procs.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {procs.length > 0 && (
            <div className="automations-suggest">
              <span className="subtle">{t("automation.ui.fields.running")}</span>
              {procs.slice(0, 8).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={cx("automations-pill", trigger.process.toLowerCase() === p.toLowerCase() && "is-on")}
                  onClick={() => onChange({ ...trigger, process: p })}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </Field>
      );
    case "time": {
      const days = trigger.days ?? [];
      const toggle = (d: number) => {
        const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
        onChange({
          ...trigger,
          days: next.length && next.length < 7 ? next.sort() : undefined,
        });
      };
      return (
        <div className="automations-grid2">
          <Field label={t("automation.ui.fields.at")}>
            <Input type="time" value={trigger.at} onChange={(e) => onChange({ ...trigger, at: e.target.value })} />
          </Field>
          <Field label={t("automation.ui.fields.days")} hint={days.length ? undefined : t("automation.ui.desc.everyDay")}>
            <div className="automations-days">
              {WEEK.map((d) => (
                <button key={d} type="button" className={cx("automations-day", days.includes(d) && "is-on")} onClick={() => toggle(d)}>
                  {t(`automation.ui.days.${d}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      );
    }
    case "batteryBelow": {
      const withBattery = devices.filter((d) => d.definition.capabilities.battery || live[d.uid]?.battery);
      return (
        <div className="automations-grid2">
          <Slider
            label={t("automation.ui.fields.percent")}
            value={trigger.percent}
            min={5}
            max={60}
            unit="%"
            onChange={(percent) => onChange({ ...trigger, percent })}
          />
          <Field label={t("automation.ui.fields.device")}>
            <Select
              value={trigger.device ?? ""}
              onChange={(device) => onChange({ ...trigger, device: device || undefined })}
              options={[
                { value: "", label: t("automation.ui.fields.anyDevice") },
                ...withBattery.map((d) => ({
                  value: d.uid,
                  label: `${d.definition.name}${live[d.uid]?.battery ? ` · ${live[d.uid]!.battery!.percent}%` : ""}`,
                })),
                ...(trigger.device && !withBattery.some((d) => d.uid === trigger.device) ? [{ value: trigger.device, label: trigger.device }] : []),
              ]}
            />
          </Field>
        </div>
      );
    }
    case "idle":
      return (
        <Slider
          label={t("automation.ui.fields.minutes")}
          value={trigger.minutes}
          min={1}
          max={120}
          unit="min"
          onChange={(minutes) => onChange({ ...trigger, minutes })}
        />
      );
    case "cpuAbove":
      return (
        <div className="col" style={{ gap: 8 }}>
          <Slider
            label={t("automation.ui.fields.cpu")}
            value={trigger.percent}
            min={10}
            max={100}
            unit="%"
            onChange={(percent) => onChange({ ...trigger, percent })}
          />
          <p className="automations-note">{t("automation.ui.fields.sustained")}</p>
        </div>
      );
    case "gpuTempAbove":
      return (
        <div className="col" style={{ gap: 8 }}>
          <Slider
            label={t("automation.ui.fields.gpu")}
            value={trigger.celsius}
            min={40}
            max={100}
            unit="°C"
            onChange={(celsius) => onChange({ ...trigger, celsius })}
          />
          <p className="automations-note">{t("automation.ui.fields.sustained")}</p>
        </div>
      );
    case "mqtt":
      return (
        <div className="col" style={{ gap: 10 }}>
          <div className="automations-grid2">
            <Field label={t("automation.ui.fields.topic")} hint={t("automation.ui.fields.topicHint")}>
              <Input className="mono" value={trigger.topic} onChange={(e) => onChange({ ...trigger, topic: e.target.value })} />
            </Field>
            <Field label={t("automation.ui.fields.match")} hint={t("automation.ui.fields.matchHint")}>
              <Input
                className="mono"
                value={trigger.match ?? ""}
                placeholder="ON"
                onChange={(e) => onChange({ ...trigger, match: e.target.value || undefined })}
              />
            </Field>
          </div>
          {mqttStatus !== "connected" && (
            <div className="automations-callout">
              <Info />
              <div>
                {t("automation.ui.fields.mqttOff")}{" "}
                <a href="#/integrations/homeAssistant" className="automations-link">
                  {t("automation.ui.fields.openIntegrations")}
                </a>
              </div>
            </div>
          )}
        </div>
      );
    case "api":
      return (
        <div className="col" style={{ gap: 10 }}>
          <Field label={t("automation.ui.fields.event")} hint={t("automation.ui.fields.eventHint")}>
            <Input
              className="mono"
              value={trigger.event}
              onChange={(e) =>
                onChange({
                  ...trigger,
                  event: e.target.value.replace(/\s+/g, "-"),
                })
              }
            />
          </Field>
          <pre className="automations-code">{`keyhalo action ${trigger.event || "<name>"}\n\ncurl -X POST http://127.0.0.1:${port}/api/v1/action \\\n  -H "Content-Type: application/json" \\\n  -d '{"action":"${trigger.event || "<name>"}"}'`}</pre>
        </div>
      );
    case "game":
      return (
        <div className="automations-grid2">
          <Field label={t("automation.ui.fields.game")}>
            <Segmented
              value={trigger.game}
              onChange={(game) => onChange({ ...trigger, game })}
              options={[
                { value: "cs2", label: "CS2" },
                { value: "dota2", label: "Dota 2" },
                { value: "lol", label: "LoL" },
              ]}
            />
          </Field>
          <Field label={t("automation.ui.fields.gameEvent")}>
            <Select
              value={trigger.event}
              onChange={(event) => onChange({ ...trigger, event })}
              options={GAME_EVENTS.map((e) => ({
                value: e,
                label: t(`automation.gameEvents.${e}`),
              }))}
            />
          </Field>
        </div>
      );
    case "hotkey":
      return (
        <div className="automations-grid2">
          <Field label={t("automation.ui.fields.hotkey")} hint={t("automation.ui.fields.hotkeyHint")}>
            <KeyRecorder value={accelToCodes(trigger.accelerator)} onChange={(codes) => onChange({ ...trigger, accelerator: codesToAccel(codes) })} />
          </Field>
          <Field label={t("automation.ui.fields.accelerator")}>
            <Input className="mono" value={trigger.accelerator} onChange={(e) => onChange({ ...trigger, accelerator: e.target.value })} />
          </Field>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Action fields
// ---------------------------------------------------------------------------

function ActionFields({ action, onChange }: { action: RuleAction; onChange: (a: RuleAction) => void }) {
  const t = useT();
  const profiles = useProfiles((s) => s.profiles);
  switch (action.type) {
    case "profile":
      return profiles.length ? (
        <Select
          value={action.profileId}
          onChange={(profileId) => onChange({ ...action, profileId })}
          options={[
            ...(profiles.some((p) => p.id === action.profileId) ? [] : [{ value: action.profileId, label: action.profileId || "—" }]),
            ...profiles.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      ) : (
        <Input value={action.profileId} placeholder="neon" onChange={(e) => onChange({ ...action, profileId: e.target.value })} />
      );
    case "flash":
      return (
        <div className="col" style={{ gap: 10 }}>
          <div className="automations-grid2">
            <Field label={t("common.color")}>
              <ColorInput value={action.color} onChange={(color) => onChange({ ...action, color })} />
            </Field>
            <Slider label={t("automation.ui.fields.times")} value={action.times ?? 2} min={1} max={10} onChange={(times) => onChange({ ...action, times })} />
          </div>
          <Field label={t("automation.ui.fields.keys")} hint={t("automation.ui.fields.keysHint")}>
            <ChipsInput
              value={action.keys ?? []}
              onChange={(keys) => onChange({ ...action, keys: keys.length ? keys : undefined })}
              suggestions={[...KEY_CODES]}
              placeholder="Escape, F1"
            />
          </Field>
        </div>
      );
    case "notify":
      return (
        <div className="automations-grid2 automations-grid2--wide">
          <Field label={t("automation.ui.fields.message")}>
            <Input value={action.text} onChange={(e) => onChange({ ...action, text: e.target.value })} />
          </Field>
          <Field label={t("common.color")}>
            <ColorInput value={action.color ?? "#ffffff"} onChange={(color) => onChange({ ...action, color })} />
          </Field>
        </div>
      );
    case "dpi":
      return <Slider label="DPI" value={action.value} min={100} max={26000} step={50} onChange={(value) => onChange({ ...action, value })} />;
    case "brightness":
      return (
        <Slider
          label={t("common.brightness")}
          value={Math.round((action.value > 1 ? action.value / 100 : action.value) * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => onChange({ ...action, value: v / 100 })}
        />
      );
    case "mqttPublish":
      return (
        <div className="automations-grid2">
          <Field label={t("automation.ui.fields.topic")}>
            <Input className="mono" value={action.topic} onChange={(e) => onChange({ ...action, topic: e.target.value })} />
          </Field>
          <Field label={t("automation.ui.fields.payload")}>
            <Input className="mono" value={action.payload} onChange={(e) => onChange({ ...action, payload: e.target.value })} />
          </Field>
        </div>
      );
    case "http":
      return (
        <div className="col" style={{ gap: 10 }}>
          <div className="automations-http">
            <Select
              value={action.method.toUpperCase()}
              onChange={(method) => onChange({ ...action, method })}
              options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({
                value: m,
                label: m,
              }))}
            />
            <Input className="mono" value={action.url} onChange={(e) => onChange({ ...action, url: e.target.value })} />
          </div>
          {action.method.toUpperCase() !== "GET" && (
            <TextArea
              rows={3}
              value={action.body ?? ""}
              placeholder='{"text":"Hello"}'
              onChange={(e) => onChange({ ...action, body: e.target.value || undefined })}
            />
          )}
        </div>
      );
    case "pauseRemap":
      return (
        <Segmented
          value={action.paused ? "pause" : "resume"}
          onChange={(v) => onChange({ ...action, paused: v === "pause" })}
          options={[
            { value: "pause", label: t("keymaps.pause") },
            { value: "resume", label: t("keymaps.resume") },
          ]}
        />
      );
  }
}
