import { bus } from "../util/bus";

/**
 * Called once at startup (see src/core/init.ts). Deliberately light: nothing is loaded here.
 * Packs (word lists, quotes, snippets) are pulled in with the Typing section, and history
 * loads lazily the first time the section opens. Packs installed from the community gallery
 * are registered as they arrive.
 */
export async function init(): Promise<void> {
  bus.on("community:installed", ({ kind, data }) => {
    if (kind !== "typing") return;
    void import("./packs").then(({ isTypingPack, useTypingPacks }) => {
      if (isTypingPack(data)) useTypingPacks.getState().add(data);
      else console.warn("[typing] ignored invalid typing pack", data);
    });
  });
  bus.on("community:removed", ({ kind, id }) => {
    if (kind !== "typing") return;
    void import("./packs").then(({ useTypingPacks }) => useTypingPacks.getState().remove(id));
  });
}
