import { backend } from "@/core/backend";
import { useSettings } from "@/core/state/settings";
import { importParamFromLocation } from "./deeplinks";
import { loadRegistry, reemitInstalled, saveRegistry } from "./install";
import { setReportAppVersion } from "./reports";
import { useCommunity } from "./store";

/**
 * Called once at startup (see src/core/init.ts). Never blocks on the network:
 *  1. re-emits installed items so features (devices, lighting, keymaps, typing) register them;
 *  2. restores the GitHub session from settings;
 *  3. listens for keyhalo:// deep links (desktop) and `?import=` (browser demo);
 *  4. refreshes the catalog in the background.
 */
export async function init(): Promise<void> {
  const store = useCommunity;

  const registry = await reemitInstalled(await loadRegistry());
  store.setState({ installed: registry });
  saveRegistry(registry).catch((e) => console.warn("[community] could not save registry", e));

  const gh = useSettings.getState().settings.github;
  if (gh.token) store.setState({ auth: { status: "signedIn", login: gh.user ?? "" } });

  backend.appVersion().then(setReportAppVersion, () => {});

  await backend.on("deep-link", ({ url }) => {
    store.getState().handleDeepLink(url);
  });
  const param = importParamFromLocation();
  if (param) {
    store.getState().handleDeepLink(param);
    // Drop the param so a reload doesn't import twice.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("import");
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* ignore */
    }
  }

  store.getState().refresh().catch((e) => console.warn("[community] catalog refresh failed", e));
}
