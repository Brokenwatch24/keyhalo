import type { RuleAction } from "@/core/types";
import { backend } from "@/core/backend";
import { bus } from "@/core/util/bus";
import { mqttPublish } from "@/core/integrations/mqtt";

/** Execute one rule action. Throws on failure (the engine logs it). */
export async function executeAction(a: RuleAction): Promise<void> {
  switch (a.type) {
    case "profile":
      bus.emit("profile:apply", { id: a.profileId, reason: "rule" });
      return;
    case "flash":
      bus.emit("lighting:flash", { color: a.color, keys: a.keys?.length ? a.keys : undefined, times: a.times ?? 3 });
      return;
    case "notify":
      bus.emit("notify", { text: a.text, color: a.color });
      return;
    case "dpi":
      bus.emit("dpi:set", { value: a.value });
      return;
    case "brightness":
      bus.emit("lighting:brightness", { value: Math.max(0, Math.min(1, a.value > 1 ? a.value / 100 : a.value)) });
      return;
    case "mqttPublish":
      await mqttPublish(a.topic, a.payload);
      return;
    case "http": {
      const res = await backend.httpRequest({ method: a.method.toUpperCase(), url: a.url, body: a.body, timeoutMs: 10_000, headers: a.body ? { "Content-Type": a.body.trim().startsWith("{") ? "application/json" : "text/plain" } : undefined });
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      return;
    }
    case "pauseRemap":
      bus.emit("keymaps:pause", { paused: a.paused });
      return;
  }
}
