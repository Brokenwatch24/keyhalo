import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Clock,
  Crosshair,
  Keyboard,
  Layers,
  ListOrdered,
  MousePointer2,
  Music,
  Palette,
  Plus,
  Rocket,
  Timer,
  Trash2,
  Type,
} from "lucide-react";
import { Button, Field, Input, Segmented, Select, Slider, TextArea } from "@/ui";
import { useT } from "@/i18n";
import type { KeyAction, KeymapLayer, MacroStep } from "@/core/types";
import { useProfiles } from "@/core/lighting/profiles";
import { KeyRecorder } from "./KeyRecorder";
import { ACTION_TYPES, cx } from "./util";

export const ACTION_ICONS: Record<KeyAction["type"], ReactNode> = {
  key: <Keyboard />,
  text: <Type />,
  macro: <ListOrdered />,
  launch: <Rocket />,
  layer: <Layers />,
  tapHold: <Timer />,
  mouse: <MousePointer2 />,
  dpi: <Crosshair />,
  profile: <Palette />,
  media: <Music />,
  disabled: <Ban />,
};

const MEDIA: Extract<KeyAction, { type: "media" }>["command"][] = ["playPause", "next", "prev", "volumeUp", "volumeDown", "mute", "micMute"];
const MOUSE: Extract<KeyAction, { type: "mouse" }>["button"][] = ["left", "right", "middle", "back", "forward"];

export function defaultAction(type: KeyAction["type"], layers: KeymapLayer[], profileId: string): KeyAction {
  const layer = layers[0]?.id ?? "";
  switch (type) {
    case "key":
      return { type, keys: [] };
    case "text":
      return { type, text: "" };
    case "macro":
      return { type, steps: [{ op: "tap", key: "KeyA" }] };
    case "launch":
      return { type, path: "" };
    case "layer":
      return { type, layer, mode: "hold" };
    case "tapHold":
      return {
        type,
        tap: { type: "key", keys: ["Escape"] },
        hold: layer ? { type: "layer", layer, mode: "hold" } : { type: "key", keys: ["ControlLeft"] },
        termMs: 200,
      };
    case "mouse":
      return { type, button: "back" };
    case "dpi":
      return { type, mode: "sniper", value: 400 };
    case "profile":
      return { type, profileId };
    case "media":
      return { type, command: "playPause" };
    case "disabled":
      return { type };
  }
}

/** Grid of action-type tiles. */
export function ActionTypePicker({
  value,
  onChange,
  exclude = [],
}: {
  value: KeyAction["type"];
  onChange: (t: KeyAction["type"]) => void;
  exclude?: KeyAction["type"][];
}) {
  const t = useT();
  return (
    <div className="keymaps-types" role="radiogroup">
      {ACTION_TYPES.filter((x) => !exclude.includes(x)).map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          className={cx("keymaps-types__tile", value === type && "is-active")}
          onClick={() => onChange(type)}
        >
          {ACTION_ICONS[type]}
          <span>{t(`keymaps.ui.actions.${type}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** Type-specific fields of an action (recursive for tap-hold). */
export function ActionFields({
  action,
  onChange,
  layers,
  nested,
}: {
  action: KeyAction;
  onChange: (a: KeyAction) => void;
  layers: KeymapLayer[];
  nested?: boolean;
}) {
  const t = useT();
  const profiles = useProfiles((s) => s.profiles);
  const firstProfile = profiles[0]?.id ?? "";

  switch (action.type) {
    case "key":
      return (
        <Field label={t("keymaps.ui.fields.sendChord")} hint={t("keymaps.ui.fields.sendChordHint")}>
          <KeyRecorder value={action.keys} onChange={(keys) => onChange({ ...action, keys })} />
        </Field>
      );
    case "text":
      return (
        <Field label={t("keymaps.ui.fields.text")} hint={t("keymaps.ui.fields.textHint")}>
          <TextArea
            rows={3}
            value={action.text}
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
            }}
          />
        </Field>
      );
    case "macro":
      return <MacroEditor steps={action.steps} onChange={(steps) => onChange({ ...action, steps })} />;
    case "launch":
      return (
        <div className="keymaps-form-grid">
          <Field label={t("keymaps.ui.fields.path")} hint={t("keymaps.ui.fields.pathHint")}>
            <Input
              value={action.path}
              placeholder="C:\\Program Files\\App\\app.exe"
              onChange={(e) => onChange({ ...action, path: e.target.value })}
              className="mono"
            />
          </Field>
          <Field label={t("keymaps.ui.fields.args")}>
            <Input
              value={(action.args ?? []).join(" ")}
              placeholder="--new-window"
              onChange={(e) => {
                const args = e.target.value.split(" ").filter(Boolean);
                onChange({ ...action, args: args.length ? args : undefined });
              }}
              className="mono"
            />
          </Field>
        </div>
      );
    case "layer":
      return (
        <div className="keymaps-form-grid">
          <Field label={t("keymaps.ui.fields.layer")}>
            {layers.length ? (
              <Select
                value={action.layer}
                onChange={(layer) => onChange({ ...action, layer })}
                options={[
                  ...(layers.some((l) => l.id === action.layer) ? [] : [{ value: action.layer, label: action.layer || "—" }]),
                  ...layers.map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            ) : (
              <Input value={action.layer} placeholder="nav" onChange={(e) => onChange({ ...action, layer: e.target.value })} />
            )}
          </Field>
          <Field label={t("keymaps.ui.fields.mode")}>
            <Segmented
              value={action.mode}
              onChange={(mode) => onChange({ ...action, mode })}
              options={[
                { value: "hold", label: t("keymaps.ui.fields.hold") },
                { value: "toggle", label: t("keymaps.ui.fields.toggle") },
              ]}
            />
          </Field>
          {!layers.length && <p className="keymaps-note">{t("keymaps.ui.fields.noLayers")}</p>}
        </div>
      );
    case "tapHold":
      if (nested) return null;
      return (
        <div className="col" style={{ gap: 14 }}>
          <div className="keymaps-sub">
            <div className="keymaps-sub__title">
              <Clock /> {t("keymaps.ui.fields.onTap")}
            </div>
            <NestedAction action={action.tap} onChange={(tap) => onChange({ ...action, tap })} layers={layers} profileId={firstProfile} />
          </div>
          <div className="keymaps-sub">
            <div className="keymaps-sub__title">
              <Timer /> {t("keymaps.ui.fields.onHold")}
            </div>
            <NestedAction action={action.hold} onChange={(hold) => onChange({ ...action, hold })} layers={layers} profileId={firstProfile} />
          </div>
          <Slider
            label={t("keymaps.ui.fields.term")}
            value={action.termMs ?? 200}
            min={100}
            max={600}
            step={10}
            unit="ms"
            onChange={(termMs) => onChange({ ...action, termMs })}
          />
        </div>
      );
    case "mouse":
      return (
        <Field label={t("keymaps.ui.fields.button")}>
          <Segmented
            value={action.button}
            onChange={(button) => onChange({ ...action, button })}
            options={MOUSE.map((b) => ({
              value: b,
              label: t(`keymaps.ui.mouse.${b}`),
            }))}
          />
        </Field>
      );
    case "dpi":
      return (
        <div className="col" style={{ gap: 14 }}>
          <Field label={t("keymaps.ui.fields.mode")}>
            <Segmented
              value={action.mode}
              onChange={(mode) =>
                onChange({
                  ...action,
                  mode,
                  value: mode === "cycle" ? undefined : (action.value ?? 400),
                })
              }
              options={[
                { value: "sniper", label: t("keymaps.ui.fields.dpiSniper") },
                { value: "cycle", label: t("keymaps.ui.fields.dpiCycle") },
                { value: "set", label: t("keymaps.ui.fields.dpiSet") },
              ]}
            />
          </Field>
          {action.mode !== "cycle" && (
            <Slider label="DPI" value={action.value ?? 400} min={100} max={26000} step={50} onChange={(value) => onChange({ ...action, value })} />
          )}
          <p className="keymaps-note">
            {t(
              action.mode === "sniper"
                ? "keymaps.ui.fields.dpiSniperHint"
                : action.mode === "cycle"
                  ? "keymaps.ui.fields.dpiCycleHint"
                  : "keymaps.ui.fields.dpiSetHint",
            )}
          </p>
        </div>
      );
    case "profile":
      return (
        <Field label={t("keymaps.ui.fields.profile")}>
          {profiles.length ? (
            <Select
              value={action.profileId}
              onChange={(profileId) => onChange({ ...action, profileId })}
              options={[
                ...(profiles.some((p) => p.id === action.profileId)
                  ? []
                  : [
                      {
                        value: action.profileId,
                        label: action.profileId || "—",
                      },
                    ]),
                ...profiles.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          ) : (
            <Input value={action.profileId} placeholder="neon" onChange={(e) => onChange({ ...action, profileId: e.target.value })} />
          )}
        </Field>
      );
    case "media":
      return (
        <Field label={t("keymaps.ui.fields.media")}>
          <Select
            value={action.command}
            onChange={(command) => onChange({ ...action, command })}
            options={MEDIA.map((m) => ({
              value: m,
              label: t(`keymaps.ui.media.${m}`),
            }))}
          />
        </Field>
      );
    case "disabled":
      return <p className="keymaps-note">{t("keymaps.ui.fields.disabledHint")}</p>;
  }
}

function NestedAction({
  action,
  onChange,
  layers,
  profileId,
}: {
  action: KeyAction;
  onChange: (a: KeyAction) => void;
  layers: KeymapLayer[];
  profileId: string;
}) {
  const t = useT();
  return (
    <div className="col" style={{ gap: 10 }}>
      <Select
        value={action.type}
        onChange={(type) => onChange(defaultAction(type, layers, profileId))}
        options={ACTION_TYPES.filter((x) => x !== "tapHold").map((x) => ({
          value: x,
          label: t(`keymaps.ui.actions.${x}`),
        }))}
      />
      <ActionFields action={action} onChange={onChange} layers={layers} nested />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Macro steps
// ---------------------------------------------------------------------------

function MacroEditor({ steps, onChange }: { steps: MacroStep[]; onChange: (s: MacroStep[]) => void }) {
  const t = useT();
  const set = (i: number, s: MacroStep) => onChange(steps.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const totalMs = steps.reduce((n, s) => n + (s.op === "delay" ? s.ms : 0), 0);
  return (
    <div className="keymaps-macro">
      <div className="keymaps-macro__head">
        <span>{t(steps.length === 1 ? "keymaps.ui.macro.stepsOne" : "keymaps.ui.macro.steps", { n: steps.length })}</span>
        <span className="subtle mono">{totalMs ? `${totalMs} ms` : ""}</span>
      </div>
      {steps.length === 0 && <div className="keymaps-macro__empty">{t("keymaps.ui.macro.empty")}</div>}
      <ol className="keymaps-macro__list">
        {steps.map((s, i) => (
          <li key={i} className="keymaps-macro__row">
            <span className="keymaps-macro__num">{i + 1}</span>
            <select
              className="kh-select keymaps-macro__op"
              value={s.op}
              onChange={(e) => {
                const op = e.target.value as MacroStep["op"];
                const key = "key" in s ? s.key : "KeyA";
                set(i, op === "delay" ? { op, ms: 50 } : op === "text" ? { op, text: "" } : { op, key });
              }}
            >
              {(["tap", "down", "up", "delay", "text"] as const).map((op) => (
                <option key={op} value={op}>
                  {t(`keymaps.ui.macro.ops.${op}`)}
                </option>
              ))}
            </select>
            <div className="grow">
              {s.op === "delay" ? (
                <div className="row">
                  <Input
                    type="number"
                    min={0}
                    max={60000}
                    step={10}
                    value={s.ms}
                    onChange={(e) =>
                      set(i, {
                        op: "delay",
                        ms: Math.max(0, Math.min(60000, Number(e.target.value) || 0)),
                      })
                    }
                    style={{ width: 110 }}
                  />
                  <span className="subtle">ms</span>
                </div>
              ) : s.op === "text" ? (
                <Input value={s.text} placeholder={t("keymaps.ui.macro.textPlaceholder")} onChange={(e) => set(i, { op: "text", text: e.target.value })} />
              ) : (
                <KeyRecorder single compact clearable={false} value={[s.key]} onChange={(k) => k[0] && set(i, { op: s.op, key: k[0] })} />
              )}
            </div>
            <div className="keymaps-macro__tools">
              <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} title={t("keymaps.ui.moveUp")} disabled={i === 0} onClick={() => move(i, -1)} />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<ArrowDown />}
                title={t("keymaps.ui.moveDown")}
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Trash2 />}
                title={t("common.delete")}
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <Button size="sm" icon={<Plus />} onClick={() => onChange([...steps, { op: "tap", key: "KeyA" }])}>
          {t("keymaps.ui.macro.addKey")}
        </Button>
        <Button size="sm" icon={<Clock />} onClick={() => onChange([...steps, { op: "delay", ms: 50 }])}>
          {t("keymaps.ui.macro.addDelay")}
        </Button>
        <Button size="sm" icon={<Type />} onClick={() => onChange([...steps, { op: "text", text: "" }])}>
          {t("keymaps.ui.macro.addText")}
        </Button>
      </div>
    </div>
  );
}
