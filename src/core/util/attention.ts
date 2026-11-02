/**
 * Whether you are looking at this window. Live previews and animations slow down or stop when
 * you aren't: KeyHalo mostly runs in the background, and redrawing an unseen window costs CPU and
 * GPU for nothing.
 */
export type Attention = "focused" | "background" | "hidden";

export function attention(): Attention {
  if (typeof document === "undefined") return "focused";
  if (document.hidden) return "hidden";
  return document.hasFocus() ? "focused" : "background";
}

/** Keeps `kh-idle` on <html> while the window isn't focused (CSS pauses animations with it). */
export function watchAttention() {
  const apply = () => document.documentElement.classList.toggle("kh-idle", attention() !== "focused");
  window.addEventListener("focus", apply);
  window.addEventListener("blur", apply);
  document.addEventListener("visibilitychange", apply);
  apply();
}
