import { backend, isTauri } from "@/core/backend";

let seq = 0;

/**
 * Ask for a line of text in the small always-on-top box (window "prompt"), e.g. when a pad needs
 * words. Resolves with the text, or null when cancelled (Esc). Only one question at a time.
 */
export async function askText(opts: { title: string; value?: string; placeholder?: string; hint?: string }): Promise<string | null> {
  if (!isTauri) return null;
  const id = `q${++seq}`;
  return new Promise<string | null>((resolve) => {
    let un: (() => void) | undefined;
    backend
      .on("prompt-result", (r) => {
        if (r.id !== id) return;
        un?.();
        resolve(r.value);
      })
      .then((f) => {
        un = f;
        return backend.promptOpen({ id, ...opts });
      })
      .catch(() => {
        un?.();
        resolve(null);
      });
  });
}
