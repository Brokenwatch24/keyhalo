import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/ui";
import { useT } from "@/i18n";

/** One-line explanation of a test + its actions (reset…), shown above every test. */
export function TestHeader({ hint, children, onReset }: { hint: ReactNode; children?: ReactNode; onReset?: () => void }) {
  const t = useT();
  return (
    <div className="tb-head">
      <p className="tb-head__hint">{hint}</p>
      <div className="row wrap">
        {children}
        {onReset && (
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={onReset}>
            {t("testbench.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Small label/value pair used in the stats panels. */
export function Metric({ label, value, unit, tone, hint }: { label: ReactNode; value: ReactNode; unit?: ReactNode; tone?: "success" | "warning" | "danger"; hint?: ReactNode }) {
  return (
    <div className="tb-metric">
      <div className="tb-metric__label">{label}</div>
      <div className={`tb-metric__value${tone ? ` tb-tone--${tone}` : ""}`}>
        {value}
        {unit && value !== "—" && <span className="tb-metric__unit">{unit}</span>}
      </div>
      {hint && <div className="tb-metric__hint">{hint}</div>}
    </div>
  );
}

export type LockMode = "raw" | "adjusted";

type Lockable = { requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void };

/**
 * Lock the pointer to `el`, asking for raw sensor counts (`unadjustedMovement`: no OS pointer
 * speed or acceleration). Falls back to a normal lock where raw input is unsupported.
 */
export async function lockPointer(el: HTMLElement): Promise<LockMode | null> {
  const target = el as unknown as Lockable;
  try {
    await target.requestPointerLock({ unadjustedMovement: true });
    return "raw";
  } catch {
    try {
      await target.requestPointerLock();
      return "adjusted";
    } catch {
      return null;
    }
  }
}

/** True while `ref` owns the pointer lock. Releases the lock on unmount. */
export function usePointerLocked(ref: RefObject<HTMLElement | null>) {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(!!ref.current && document.pointerLockElement === ref.current);
    document.addEventListener("pointerlockchange", onChange);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      if (ref.current && document.pointerLockElement === ref.current) document.exitPointerLock();
    };
  }, [ref]);
  return locked;
}

/** Reads a CSS custom property of the document (canvas drawing follows the theme). */
export function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Resize a canvas to its CSS box × devicePixelRatio; returns the 2D context scaled to CSS px. */
export function fitCanvas(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

export const fmt = (v: number, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : "—");
