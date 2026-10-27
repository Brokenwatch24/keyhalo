import { describe, expect, it } from "vitest";
import type { Rule, Trigger } from "@/core/types";
import { normalizeAccelerator, payloadMatches, TriggerEvaluator } from "./triggers";
import { riskyRuleActions, validateRule } from "./validate";

const rule = (trigger: Trigger, id = "r"): Rule => ({ id, name: id, enabled: true, trigger, actions: [{ type: "flash", color: "#fff" }] });

describe("TriggerEvaluator", () => {
  it("notification matches app and text filters case-insensitively; empty filters match anything", () => {
    const ev = new TriggerEvaluator();
    const n = { type: "notification" as const, app: "Discord\ncom.squirrel.Discord.Discord", text: "Ana\nare you joining?" };
    expect(ev.evaluate(rule({ type: "notification" }), n)).toBe(true);
    expect(ev.evaluate(rule({ type: "notification", app: "discord", contains: "JOINING" }), n)).toBe(true);
    expect(ev.evaluate(rule({ type: "notification", app: "whatsapp" }), n)).toBe(false);
    expect(ev.evaluate(rule({ type: "notification", contains: "urgent" }), n)).toBe(false);
    expect(ev.evaluate(rule({ type: "notification" }), { type: "api", event: "x" })).toBe(false);
    expect(validateRule(rule({ type: "notification", app: "Discord" })).length).toBe(0);
  });

  it("appFocus / appLaunch match process names case-insensitively (with or without .exe)", () => {
    const ev = new TriggerEvaluator();
    expect(ev.evaluate(rule({ type: "appFocus", process: "resolve" }), { type: "focus", process: "Resolve.exe" })).toBe(true);
    expect(ev.evaluate(rule({ type: "appFocus", process: "Resolve.exe" }), { type: "focus", process: "Code.exe" })).toBe(false);
    expect(ev.evaluate(rule({ type: "appLaunch", process: "obs64.exe" }), { type: "launch", process: "OBS64.EXE" })).toBe(true);
    expect(ev.evaluate(rule({ type: "appLaunch", process: "obs64.exe" }), { type: "focus", process: "obs64.exe" })).toBe(false);
  });

  it("time fires once per matching minute and respects weekdays", () => {
    const ev = new TriggerEvaluator();
    const r = rule({ type: "time", at: "09:00", days: [1, 2, 3, 4, 5] });
    const monday = new Date(2026, 9, 26, 9, 0, 10); // Mon 26 Oct 2026
    expect(ev.evaluate(r, { type: "time", now: monday })).toBe(true);
    expect(ev.evaluate(r, { type: "time", now: new Date(2026, 9, 26, 9, 0, 40) })).toBe(false);
    expect(ev.evaluate(r, { type: "time", now: new Date(2026, 9, 26, 9, 1) })).toBe(false);
    expect(ev.evaluate(r, { type: "time", now: new Date(2026, 9, 27, 9, 0) })).toBe(true);
    expect(ev.evaluate(r, { type: "time", now: new Date(2026, 9, 25, 9, 0) })).toBe(false); // Sunday
  });

  it("batteryBelow fires once per crossing with hysteresis and device filter", () => {
    const ev = new TriggerEvaluator();
    const r = rule({ type: "batteryBelow", percent: 20, device: "viper" });
    const b = (percent: number, name = "Razer Viper V3") => ev.evaluate(r, { type: "battery", uid: "m1", name, percent });
    expect(b(50)).toBe(false);
    expect(b(19)).toBe(true);
    expect(b(18)).toBe(false);
    expect(b(21)).toBe(false); // within hysteresis: still disarmed
    expect(b(19)).toBe(false);
    expect(b(25)).toBe(false); // re-armed
    expect(b(15)).toBe(true);
    expect(b(5, "Other mouse")).toBe(false);
  });

  it("idle fires once until input resumes", () => {
    const ev = new TriggerEvaluator();
    const r = rule({ type: "idle", minutes: 5 });
    expect(ev.evaluate(r, { type: "idle", idleMs: 60_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "idle", idleMs: 5 * 60_000 })).toBe(true);
    expect(ev.evaluate(r, { type: "idle", idleMs: 6 * 60_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "idle", idleMs: 1_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "idle", idleMs: 5 * 60_000 })).toBe(true);
  });

  it("cpuAbove / gpuTempAbove need 10 s sustained", () => {
    const ev = new TriggerEvaluator();
    const r = rule({ type: "cpuAbove", percent: 90 });
    expect(ev.evaluate(r, { type: "cpu", percent: 95, t: 0 })).toBe(false);
    expect(ev.evaluate(r, { type: "cpu", percent: 96, t: 5_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "cpu", percent: 97, t: 10_000 })).toBe(true);
    expect(ev.evaluate(r, { type: "cpu", percent: 97, t: 12_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "cpu", percent: 50, t: 13_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "cpu", percent: 95, t: 14_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "cpu", percent: 95, t: 23_000 })).toBe(false);
    expect(ev.evaluate(r, { type: "cpu", percent: 95, t: 24_000 })).toBe(true);
    const g = rule({ type: "gpuTempAbove", celsius: 80 }, "g");
    expect(ev.evaluate(g, { type: "gpuTemp", celsius: 85, t: 0 })).toBe(false);
    expect(ev.evaluate(g, { type: "gpuTemp", celsius: 85, t: 10_000 })).toBe(true);
    expect(ev.evaluate(g, { type: "cpu", percent: 100, t: 20_000 })).toBe(false);
  });

  it("mqtt matches topic wildcards and optional substring / regex", () => {
    const ev = new TriggerEvaluator();
    expect(ev.evaluate(rule({ type: "mqtt", topic: "home/+/doorbell", match: "on" }), { type: "mqtt", topic: "home/front/doorbell", payload: "ON" })).toBe(true);
    expect(ev.evaluate(rule({ type: "mqtt", topic: "home/#" }), { type: "mqtt", topic: "home/a/b", payload: "" })).toBe(true);
    expect(ev.evaluate(rule({ type: "mqtt", topic: "home/doorbell", match: "/^\\d{2,}$/" }), { type: "mqtt", topic: "home/doorbell", payload: "42" })).toBe(true);
    expect(ev.evaluate(rule({ type: "mqtt", topic: "home/doorbell", match: "/^\\d{2,}$/" }), { type: "mqtt", topic: "home/doorbell", payload: "4" })).toBe(false);
    expect(payloadMatches("/[/", "x")).toBe(false);
  });

  it("api, game and hotkey triggers", () => {
    const ev = new TriggerEvaluator();
    expect(ev.evaluate(rule({ type: "api", event: "Deploy" }), { type: "api", event: "deploy" })).toBe(true);
    expect(ev.evaluate(rule({ type: "game", game: "cs2", event: "bomb_planted" }), { type: "game", game: "cs2", event: "bomb_planted" })).toBe(true);
    expect(ev.evaluate(rule({ type: "game", game: "cs2", event: "bomb_planted" }), { type: "game", game: "dota2", event: "bomb_planted" })).toBe(false);
    expect(ev.evaluate(rule({ type: "hotkey", accelerator: "Shift+Ctrl+M" }), { type: "hotkey", accelerator: "CommandOrControl+Shift+M" })).toBe(true);
    expect(normalizeAccelerator("Alt + Win + K")).toBe("alt+meta+k");
  });

  it("reset clears per-rule memory", () => {
    const ev = new TriggerEvaluator();
    const r = rule({ type: "idle", minutes: 1 });
    expect(ev.evaluate(r, { type: "idle", idleMs: 60_000 })).toBe(true);
    ev.reset(r.id);
    expect(ev.evaluate(r, { type: "idle", idleMs: 60_000 })).toBe(true);
  });
});

describe("rule validation", () => {
  it("accepts valid rules and rejects broken ones", () => {
    expect(validateRule(rule({ type: "time", at: "07:30" }))).toEqual([]);
    expect(validateRule({ ...rule({ type: "time", at: "7h" }) })).not.toEqual([]);
    expect(validateRule({ id: "x", name: "x", trigger: { type: "nope" }, actions: [] })).not.toEqual([]);
    expect(validateRule({ ...rule({ type: "api", event: "x" }), actions: [{ type: "http", method: "POST", url: "file:///etc" }] })).not.toEqual([]);
  });

  it("lists network actions for review", () => {
    const r = { ...rule({ type: "api", event: "x" }), actions: [{ type: "http" as const, method: "POST", url: "https://example.com" }, { type: "flash" as const, color: "#fff" }] };
    expect(riskyRuleActions([r]).map((x) => x.detail)).toEqual(["POST https://example.com"]);
  });
});
