import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { create } from "zustand";
import { X, Inbox } from "lucide-react";
import "./ui.css";

export { KeyboardView, MouseView } from "./DeviceView";
export { LineChart, BarChart, Sparkline, Gauge } from "./charts";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
  /** Render as a square icon-only button (provide `title` for accessibility). */
  iconOnly?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon, iconOnly, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "kh-btn",
        variant !== "secondary" && `kh-btn--${variant}`,
        size === "sm" && "kh-btn--sm",
        iconOnly && "kh-btn--icon",
        className,
      )}
      aria-label={iconOnly ? rest.title : undefined}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Page({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="kh-page">
      <header className="kh-page__head">
        <div>
          <h1 className="kh-page__title">{title}</h1>
          {description && <p className="kh-page__desc">{description}</p>}
        </div>
        {actions && <div className="row wrap">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  flush,
  className,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cx("kh-card", flush && "kh-card--flush", className)} style={style}>
      {(title || actions) && (
        <div className="kh-card__head">
          <div className="grow">
            {title && <div className="kh-card__title">{title}</div>}
            {subtitle && <div className="kh-card__sub">{subtitle}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className="kh-card__body">{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="kh-empty">
      {icon ?? <Inbox />}
      <div className="kh-empty__title">{title}</div>
      {children && <div style={{ maxWidth: 420, fontSize: "var(--text-md)" }}>{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({ label, hint, aside, children }: { label?: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <label className="kh-field">
      {(label || aside) && (
        <span className="kh-field__label">
          <span>{label}</span>
          {aside}
        </span>
      )}
      {children}
      {hint && <span className="kh-field__hint">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("kh-input", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("kh-textarea", props.className)} />;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <select {...rest} className={cx("kh-select", rest.className)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label as string}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  format,
  onChange,
  onCommit,
  disabled,
}: {
  label?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  /** Called on pointer release — use it for hardware writes. */
  onCommit?: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="kh-slider">
      {label !== undefined && (
        <div className="kh-slider__top">
          <span className="kh-slider__label">{label}</span>
          <span className="kh-slider__value">
            {format ? format(value) : value}
            {unit && <span className="subtle"> {unit}</span>}
          </span>
        </div>
      )}
      <input
        type="range"
        className="kh-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="kh-toggle" style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="kh-toggle__track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <div className="kh-seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <div className="kh-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <span className="kh-color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Color" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (/^#[0-9a-f]{6}$/i.test(text) ? onChange(text.toLowerCase()) : setText(value))}
        spellCheck={false}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function Badge({ tone, children, dot }: { tone?: "success" | "warning" | "danger" | "info"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("kh-badge", tone && `kh-badge--${tone}`)}>
      {dot && <span className="kh-dot" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, unit, hint, icon }: { label: ReactNode; value: ReactNode; unit?: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="kh-stat">
      <div className="kh-stat__label">
        {icon}
        {label}
      </div>
      <div className="kh-stat__value">
        {value}
        {unit && <span className="kh-stat__unit">{unit}</span>}
      </div>
      {hint && <div className="kh-stat__hint">{hint}</div>}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="kh-progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kh-kbd">{children}</kbd>;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="kh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("kh-modal", wide && "kh-modal--wide")} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="kh-modal__head">
          <div className="kh-modal__title" id={id}>
            {title}
          </div>
          <Button variant="ghost" size="sm" iconOnly icon={<X />} title="Close" onClick={onClose} />
        </div>
        <div className="kh-modal__body">{children}</div>
        {footer && <div className="kh-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  tone?: "danger";
}

const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; drop: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 3800);
  },
  drop: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Show a short message in the bottom-right corner. Usable outside React. */
export function toast(text: string, tone?: "danger") {
  useToasts.getState().push({ text, tone });
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const drop = useToasts((s) => s.drop);
  return (
    <div className="kh-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("kh-toast", t.tone && `kh-toast--${t.tone}`)} onClick={() => drop(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
