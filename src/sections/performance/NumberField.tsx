import { useEffect, useState } from "react";
import { snap } from "./util";

/**
 * Compact numeric input that only reports a value on Enter / blur (hardware-friendly),
 * snapped to `step` and clamped to [min, max].
 */
export function NumberField({
  value,
  min,
  max,
  step = 1,
  onCommit,
  suffix,
  width = 84,
  ariaLabel,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
  suffix?: string;
  width?: number;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n)) return setText(String(value));
    const v = Number(snap(n, min, max, step).toFixed(6));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <span className="perf-num" style={{ width }}>
      <input
        className="kh-input"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(String(value));
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = snap((Number(text) || value) + (e.key === "ArrowUp" ? step : -step), min, max, step);
            setText(String(Number(n.toFixed(6))));
          }
        }}
      />
      {suffix && <span className="perf-num__suffix">{suffix}</span>}
    </span>
  );
}
