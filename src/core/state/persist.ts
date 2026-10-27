import { backend } from "@/core/backend";

/** Read a JSON document from the app data folder (null when missing or invalid). */
export async function loadJson<T>(name: string): Promise<T | null> {
  try {
    const raw = await backend.storageRead(name);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn(`[persist] could not read ${name}`, e);
    return null;
  }
}

/** Write a JSON document to the app data folder. */
export async function saveJson(name: string, value: unknown) {
  await backend.storageWrite(name, JSON.stringify(value, null, 2));
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced save, for state that changes often (sliders, stats). */
export function saveJsonDebounced(name: string, value: unknown, ms = 600) {
  clearTimeout(timers.get(name));
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name);
      saveJson(name, value).catch((e) => console.warn(`[persist] could not write ${name}`, e));
    }, ms),
  );
}
