import { useSettings, applyTheme } from "./state/settings";
import { init as devices } from "./devices/init";
import { init as lighting } from "./lighting/init";
import { init as keymaps } from "./keymaps/init";
import { init as integrations } from "./integrations/init";
import { init as automation } from "./automation/init";
import { init as community } from "./community/init";
import { init as typing } from "./typing/init";
import { init as stats } from "./stats/init";

/**
 * Startup sequence. Order matters: settings → devices → lighting (needs devices) →
 * keymaps → stats → integrations/automation (need everything above) → community/typing.
 * A failing module logs and never blocks the rest of the app.
 */
export async function initApp() {
  await useSettings.getState().hydrate();
  applyTheme(useSettings.getState().settings.theme);
  useSettings.subscribe((s, prev) => s.settings.theme !== prev.settings.theme && applyTheme(s.settings.theme));

  for (const [name, fn] of [
    ["devices", devices],
    ["lighting", lighting],
    ["keymaps", keymaps],
    ["stats", stats],
    ["integrations", integrations],
    ["automation", automation],
    ["community", community],
    ["typing", typing],
  ] as const) {
    try {
      await fn();
    } catch (e) {
      console.error(`[init] ${name} failed`, e);
    }
  }
}
