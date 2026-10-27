import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Kbd } from "@/ui";
import { useT } from "@/i18n";
import { KEY_CODES, MODIFIER_ORDER, isModifierCode, isValidKeyCode, keyLabel, modifierCode, modifierOf } from "@/core/keymaps";
import { cx, keysParts } from "./util";
import "./keymaps.css";

/**
 * "Press keys to record" field. Produces a chord as KeyboardEvent.code names: modifiers first
 * (normalised to the left-hand code), then one main key. `single` records one key only.
 * A select offers keys that are hard to press (F13–F24, media keys…).
 */
export function KeyRecorder({
  value,
  onChange,
  single,
  placeholder,
  autoFocus,
  compact,
  clearable = true,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  single?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  clearable?: boolean;
}) {
  const t = useT();
  const [recording, setRecording] = useState(Boolean(autoFocus));
  const [live, setLive] = useState<string[]>([]);
  const btn = useRef<HTMLButtonElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!recording) return;
    const held = new Set<string>();
    const seen: string[] = [];
    const finish = () => {
      const mods = MODIFIER_ORDER.filter((m) => seen.some((c) => modifierOf(c) === m)).map(modifierCode);
      const main = [...seen].reverse().find((c) => !isModifierCode(c));
      setRecording(false);
      setLive([]);
      if (!seen.length) return;
      if (single) cb.current([main ?? seen[seen.length - 1]]);
      else cb.current(main ? [...mods, main] : mods);
    };
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.code || !isValidKeyCode(e.code)) return;
      held.add(e.code);
      if (!seen.includes(e.code)) seen.push(e.code);
      setLive([...seen]);
      if (single && !isModifierCode(e.code)) finish();
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      held.delete(e.code);
      if (held.size === 0 && seen.length) finish();
    };
    document.addEventListener("keydown", down, true);
    document.addEventListener("keyup", up, true);
    return () => {
      document.removeEventListener("keydown", down, true);
      document.removeEventListener("keyup", up, true);
    };
  }, [recording, single]);

  useEffect(() => {
    if (autoFocus) btn.current?.focus();
  }, [autoFocus]);

  const parts = single ? value.map(keyLabel) : keysParts(value);
  const liveParts = live.map(keyLabel);

  const pick = (code: string) => {
    if (!code) return;
    if (single) return onChange([code]);
    const mods = value.filter(isModifierCode);
    onChange(isModifierCode(code) ? [...new Set([...mods, code])] : [...mods, code]);
  };

  return (
    <div className={cx("keymaps-rec", compact && "keymaps-rec--compact")}>
      <button
        ref={btn}
        type="button"
        className={cx("keymaps-rec__field", recording && "is-recording")}
        onClick={() => setRecording((r) => !r)}
        onBlur={() => setRecording(false)}
      >
        {recording ? (
          liveParts.length ? (
            <span className="keymaps-combo">
              {liveParts.map((p, i) => (
                <Kbd key={i}>{p}</Kbd>
              ))}
            </span>
          ) : (
            <span className="keymaps-rec__hint">
              <span className="keymaps-rec__pulse" />
              {t("keymaps.ui.recorder.listening")}
            </span>
          )
        ) : parts.length ? (
          <span className="keymaps-combo">
            {parts.map((p, i) => (
              <Kbd key={i}>{p}</Kbd>
            ))}
          </span>
        ) : (
          <span className="keymaps-rec__hint subtle">{placeholder ?? t("keymaps.ui.recorder.placeholder")}</span>
        )}
      </button>
      <select
        className="keymaps-rec__pick"
        value=""
        title={t("keymaps.ui.recorder.pick")}
        aria-label={t("keymaps.ui.recorder.pick")}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">{t("keymaps.ui.recorder.pickShort")}</option>
        {KEY_CODES.map((c) => (
          <option key={c} value={c}>
            {keyLabel(c) === c ? c : `${keyLabel(c)} — ${c}`}
          </option>
        ))}
      </select>
      {clearable && value.length > 0 && !recording && (
        <button
          type="button"
          className="keymaps-rec__clear"
          title={t("keymaps.ui.recorder.clear")}
          aria-label={t("keymaps.ui.recorder.clear")}
          onClick={() => onChange([])}
        >
          <X />
        </button>
      )}
    </div>
  );
}

/** Kbd chips for a list of display parts. */
export function Combo({ parts, dim }: { parts: string[]; dim?: boolean }) {
  return (
    <span className={cx("keymaps-combo", dim && "keymaps-combo--dim")}>
      {parts.map((p, i) => (
        <Kbd key={i}>{p}</Kbd>
      ))}
    </span>
  );
}
