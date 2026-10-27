import type { ReactNode } from "react";

/** One labelled setting row: title + explanation on the left, control on the right. */
export function Row({ title, hint, children, stack }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`settings-row${stack ? " settings-row--stack" : ""}`}>
      <div className="settings-row__text">
        <div className="settings-row__title">{title}</div>
        {hint && <div className="settings-row__hint">{hint}</div>}
      </div>
      {children && <div className="settings-row__control">{children}</div>}
    </div>
  );
}

/** A settings section: anchor target + heading + card body. */
export function Section({ id, icon, title, desc, children, actions }: { id: string; icon: ReactNode; title: ReactNode; desc?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section id={`settings-${id}`} className="settings-section" data-section={id}>
      <header className="settings-section__head">
        <span className="settings-section__icon">{icon}</span>
        <div className="grow">
          <h2 className="settings-section__title">{title}</h2>
          {desc && <p className="settings-section__desc">{desc}</p>}
        </div>
        {actions}
      </header>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function Note({ icon, children, tone }: { icon?: ReactNode; children: ReactNode; tone?: "ok" | "warn" | "info" }) {
  return (
    <div className={`settings-note${tone ? ` settings-note--${tone}` : ""}`}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

/** Compare dotted versions ("1.2.10" > "1.2.9"); ignores a leading "v" and pre-release suffixes. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
