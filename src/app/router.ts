import { useSyncExternalStore } from "react";

/** Hash router: "#/lighting/editor" → ["lighting", "editor"]. */
function read(): string[] {
  // Ignore an inline query after the route ("#/typing?demoResult=1").
  const h = window.location.hash.replace(/^#\/?/, "").split("?")[0];
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
