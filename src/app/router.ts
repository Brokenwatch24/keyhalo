import { useSyncExternalStore } from "react";

/** Hash router: "#/lighting/editor" → ["lighting", "editor"]. */
function read(): string[] {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h ? h.split("/").map(decodeURIComponent) : ["dashboard"];
}

let current = read();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = read();
  listeners.forEach((l) => l());
});

export function useRoute(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(path: string) {
  window.location.hash = `#/${path.replace(/^\/+/, "")}`;
}
