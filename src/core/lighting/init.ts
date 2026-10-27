import { backend } from "@/core/backend";
import { loadJson, saveJson } from "@/core/state/persist";
import { useSettings } from "@/core/state/settings";
import { bus } from "@/core/util/bus";
import { effectRegistry } from "./effects/registry";
import { engine } from "./engine";
import { DEFAULT_PROFILE_ID, startProfiles, useProfiles } from "./profiles";
import { DEFAULT_SCENE, newLayerId, useLighting } from "./store";

/** Community effects shipped with the app (community/effects/*.js), as source text. */
const bundledEffects = import.meta.glob<string>("/community/effects/*.js", { query: "?raw", import: "default", eager: true });

const INSTALLED_EFFECTS = "effects/installed";

async function registerSource(source: string, persistAs?: string) {
  try {
    const meta = await effectRegistry.registerCommunity(source);
    if (persistAs !== undefined) await saveJson(`${INSTALLED_EFFECTS}/${meta.id}.json`, { source });
    return meta;
  } catch (e) {
    console.warn("[lighting] community effect rejected", e);
    return null;
  }
}

async function loadCommunityEffects() {
  await Promise.all(Object.values(bundledEffects).map((src) => registerSource(src)));
  let names: string[] = [];
  try {
    names = await backend.storageList(INSTALLED_EFFECTS);
  } catch {
    /* ignore */
  }
  for (const n of names.filter((n) => n.endsWith(".json"))) {
    const doc = await loadJson<{ source: string }>(`${INSTALLED_EFFECTS}/${n}`);
    if (doc?.source) await registerSource(doc.source);
  }
}

/** Called once at startup (see src/core/init.ts), after devices. */
export async function init(): Promise<void> {
  bus.on("lighting:flash", (f) => engine.flash(f));
  bus.on("lighting:brightness", ({ value }) => useLighting.getState().setBrightness(value > 1 ? value / 100 : value));
  bus.on("lighting:effect", ({ effect, params }) => {
    const { scene } = useLighting.getState();
    if (scene.layers.length) useLighting.getState().updateLayer(scene.layers[0].id, { effect, params: params ?? {}, enabled: true });
    else useLighting.getState().addLayer({ id: newLayerId(), effect, params: params ?? {} });
  });
  bus.on("community:installed", ({ kind, data }) => {
    if (kind !== "effect") return;
    const source = typeof data === "string" ? data : (data as { source?: string })?.source;
    if (source) void registerSource(source, "persist");
  });
  bus.on("community:removed", ({ kind, id }) => {
    if (kind !== "effect") return;
    effectRegistry.unregister(id);
    void backend.storageDelete(`${INSTALLED_EFFECTS}/${id}.json`).catch(() => {});
  });

  await startProfiles();
  const wanted = useSettings.getState().settings.activeProfileId ?? DEFAULT_PROFILE_ID;
  const { profiles } = useProfiles.getState();
  const id = profiles.some((p) => p.id === wanted) ? wanted : profiles.some((p) => p.id === DEFAULT_PROFILE_ID) ? DEFAULT_PROFILE_ID : undefined;
  if (id) await useProfiles.getState().apply(id, "app", { silent: true }).catch((e) => console.warn("[lighting] profile apply failed", e));
  else useLighting.getState().setScene(DEFAULT_SCENE);

  await engine.start();
  // Workers may be slow to boot: never block startup on community effects.
  void loadCommunityEffects();
}
