import type { CSSProperties } from "react";
import { GRID, grid, right, top, previewColor, RIGHT_NAMES, TOP_NAMES } from "@/core/pads/launchpad";
import "./pad-grid.css";

export interface PadCell {
  label?: string;
  color: string;
  /** LED brightness 0..1 (default: full). */
  b?: number;
}

/**
 * The Launchpad layout: 8 round buttons on top, the 8×8 grid, 8 round buttons on the right.
 * Colours are shown as the device can show them (red/green mixes).
 */
export function PadGrid({
  cells,
  selected,
  pressed,
  onSelect,
  onPress,
  compact = false,
  showNames = false,
}: {
  cells: Record<string, PadCell>;
  selected?: string | null;
  pressed?: Record<string, true>;
  onSelect?: (id: string) => void;
  /** Physical-like press/release (for testing pads from the screen). */
  onPress?: (id: string, down: boolean) => void;
  compact?: boolean;
  /** Show the printed names of empty round buttons. */
  showNames?: boolean;
}) {
  const btn = (id: string, round: boolean, name?: string) => {
    const c = cells[id];
    const lit = c && (c.b ?? 1) > 0;
    const style = { ["--pad" as string]: lit ? previewColor(c.color, c.b ?? 1) : undefined } as CSSProperties;
    return (
      <button
        key={id}
        type="button"
        className={["kh-pad", round ? "kh-pad--round" : "", lit ? "is-lit" : "", selected === id ? "is-selected" : "", pressed?.[id] ? "is-pressed" : ""].filter(Boolean).join(" ")}
        style={style}
        title={c?.label ?? name}
        onClick={onSelect ? () => onSelect(id) : undefined}
        onPointerDown={onPress ? () => onPress(id, true) : undefined}
        onPointerUp={onPress ? () => onPress(id, false) : undefined}
        onPointerLeave={onPress && pressed?.[id] ? () => onPress(id, false) : undefined}
        tabIndex={onSelect || onPress ? 0 : -1}
      >
        <span className="kh-pad__label">{c?.label ?? (showNames ? name : "")}</span>
      </button>
    );
  };
  return (
    <div className={`kh-padgrid ${compact ? "kh-padgrid--compact" : ""}`}>
      {Array.from({ length: GRID }, (_, i) => btn(top(i), true, TOP_NAMES[i]))}
      <span />
      {Array.from({ length: GRID }, (_, y) => [
        ...Array.from({ length: GRID }, (_, x) => btn(grid(x, y), false)),
        btn(right(y), true, RIGHT_NAMES[y]),
      ])}
    </div>
  );
}
