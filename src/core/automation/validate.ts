import type { Rule, RuleAction, Trigger } from "@/core/types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function checkTrigger(t: unknown, errors: string[]) {
  if (!isObj(t)) return errors.push("trigger must be an object");
  const tr = t as Trigger;
  switch (tr.type) {
    case "appFocus":
    case "appLaunch":
      if (!isStr(tr.process) || !tr.process.trim()) errors.push("trigger.process is required");
      break;
    case "time":
      if (!isStr(tr.at) || !/^\d{1,2}:\d{2}$/.test(tr.at)) errors.push("trigger.at must be HH:MM");
      if (tr.days !== undefined && (!Array.isArray(tr.days) || tr.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) errors.push("trigger.days must be 0..6");
      break;
    case "batteryBelow":
      if (!isNum(tr.percent)) errors.push("trigger.percent is required");
      break;
    case "idle":
      if (!isNum(tr.minutes) || tr.minutes <= 0) errors.push("trigger.minutes must be > 0");
      break;
    case "cpuAbove":
      if (!isNum(tr.percent)) errors.push("trigger.percent is required");
      break;
    case "gpuTempAbove":
      if (!isNum(tr.celsius)) errors.push("trigger.celsius is required");
      break;
    case "mqtt":
      if (!isStr(tr.topic) || !tr.topic) errors.push("trigger.topic is required");
      break;
    case "api":
      if (!isStr(tr.event) || !tr.event) errors.push("trigger.event is required");
      break;
    case "game":
      if (!["cs2", "dota2", "lol"].includes(tr.game) || !isStr(tr.event)) errors.push("trigger.game and trigger.event are required");
      break;
    case "hotkey":
      if (!isStr(tr.accelerator) || !tr.accelerator) errors.push("trigger.accelerator is required");
      break;
    default:
      errors.push(`unknown trigger type "${String((t as { type?: unknown }).type)}"`);
  }
}

function checkAction(a: unknown, i: number, errors: string[]) {
  const p = `actions[${i}]`;
  if (!isObj(a)) return errors.push(`${p} must be an object`);
  const act = a as RuleAction;
  switch (act.type) {
    case "profile":
      if (!isStr(act.profileId)) errors.push(`${p}.profileId is required`);
      break;
    case "flash":
      if (!isStr(act.color)) errors.push(`${p}.color is required`);
      break;
    case "notify":
      if (!isStr(act.text)) errors.push(`${p}.text is required`);
      break;
    case "dpi":
    case "brightness":
      if (!isNum(act.value)) errors.push(`${p}.value must be a number`);
      break;
    case "mqttPublish":
      if (!isStr(act.topic) || !isStr(act.payload)) errors.push(`${p}.topic and payload are required`);
      break;
    case "http":
      if (!isStr(act.url) || !/^https?:\/\//i.test(act.url)) errors.push(`${p}.url must be http(s)`);
      if (!isStr(act.method)) errors.push(`${p}.method is required`);
      break;
    case "pauseRemap":
      if (typeof act.paused !== "boolean") errors.push(`${p}.paused must be boolean`);
      break;
    default:
      errors.push(`${p}: unknown action type "${String((a as { type?: unknown }).type)}"`);
  }
}

/** Validate an unknown value as a Rule (errors list, empty = valid). */
export function validateRule(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(value)) return ["rule must be an object"];
  const r = value as unknown as Rule;
  if (!isStr(r.id) || !r.id) errors.push("id is required");
  if (!isStr(r.name)) errors.push("name is required");
  checkTrigger(r.trigger, errors);
  if (!Array.isArray(r.actions)) errors.push("actions must be an array");
  else r.actions.forEach((a, i) => checkAction(a, i, errors));
  if (r.cooldown !== undefined && (!isNum(r.cooldown) || r.cooldown < 0)) errors.push("cooldown must be ≥ 0 seconds");
  return errors;
}

/** Actions that reach the network and need review before imported rules are enabled. */
export function riskyRuleActions(rules: Rule[]): { rule: Rule; action: RuleAction; detail: string }[] {
  const out: { rule: Rule; action: RuleAction; detail: string }[] = [];
  for (const rule of rules)
    for (const action of rule.actions) {
      if (action.type === "http") out.push({ rule, action, detail: `${action.method} ${action.url}` });
      if (action.type === "mqttPublish") out.push({ rule, action, detail: `${action.topic} ← ${action.payload.slice(0, 120)}` });
    }
  return out;
}
