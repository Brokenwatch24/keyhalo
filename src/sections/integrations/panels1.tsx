import { useLayoutEffect, useRef, useState } from "react";
import { Eye, EyeOff, Pause, Play, SkipForward, Square } from "lucide-react";
import { Button, ColorInput, Field, Input, Progress, Segmented, Slider, Sparkline, Toggle } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { useSettings } from "@/core/state/settings";
import { CLAUDE_STATES, DEMO_PRINTER, setClaudeState, useIntegrations, usePomodoro, type ClaudeState } from "@/core/integrations";
import { useMetricsHistory } from "./live";
import { CodeBlock, KV, Section, fmtClock, fmtMinutes } from "./common";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Sparkline that fills its container's width. */
export function FluidSpark({ data, color, height = 44 }: { data: number[]; color: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    setW(Math.floor(ref.current.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="integrations-spark" style={{ height }}>
      {w > 0 && <Sparkline data={data.length > 1 ? data : [0, 0]} width={w} height={height} color={color} />}
    </div>
  );
}

export const DATA_COLORS = {
  cpu: "#4f8ff7",
  gpu: "#22b07d",
  temp: "#f59e0b",
  ram: "#a78bfa",
  vram: "#ec6fa5",
};

// ---------------------------------------------------------------------------
// System monitor
// ---------------------------------------------------------------------------

export function SystemPanel() {
  const t = useT();
  const h = useMetricsHistory();
  const cfg = useIntegrations((s) => s.config.system);
  const update = useIntegrations((s) => s.update);
  const m = h.last;
  const gb = (mb: number) => (mb / 1024).toFixed(1);
  const last = (a: number[]) => (a.length ? a[a.length - 1] : undefined);
  const tiles = [
    {
      key: "cpu",
      label: t("integrations.ui.system.cpu"),
      value: last(h.cpu),
      unit: "%",
      hint: m?.cpuTemp !== undefined ? `${Math.round(m.cpuTemp)} °C` : t("integrations.ui.system.noTemp"),
      data: h.cpu,
      color: DATA_COLORS.cpu,
    },
    {
      key: "gpu",
      label: t("integrations.ui.system.gpu"),
      value: last(h.gpu),
      unit: "%",
      hint: m?.gpu?.name ?? t("integrations.ui.system.noGpu"),
      data: h.gpu,
      color: DATA_COLORS.gpu,
    },
    {
      key: "temp",
      label: t("integrations.ui.system.gpuTemp"),
      value: last(h.gpuTemp),
      unit: "°C",
      hint: m?.gpu
        ? t("integrations.ui.system.vram", {
            used: gb(m.gpu.vramUsedMb),
            total: gb(m.gpu.vramTotalMb),
          })
        : "—",
      data: h.gpuTemp,
      color: DATA_COLORS.temp,
    },
    {
      key: "ram",
      label: t("integrations.ui.system.ram"),
      value: last(h.ram),
      unit: "%",
      hint: m
        ? t("integrations.ui.system.ramOf", {
            used: gb(m.ramUsedMb),
            total: gb(m.ramTotalMb),
          })
        : "—",
      data: h.ram,
      color: DATA_COLORS.ram,
    },
  ];
  return (
    <div className="integrations-panel">
      <div className="integrations-metrics">
        {tiles.map((x) => (
          <div key={x.key} className="integrations-metric">
            <div className="integrations-metric__label">
              <span className="integrations-swatch" style={{ background: x.color }} />
              {x.label}
            </div>
            <div className="integrations-metric__value">
              {x.value === undefined ? "—" : Math.round(x.value)}
              <span>{x.unit}</span>
            </div>
            <div className="integrations-metric__hint" title={x.hint}>
              {x.hint}
            </div>
            <FluidSpark data={x.data} color={x.color} />
          </div>
        ))}
      </div>
      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-form">
          <Field label={t("integrations.ui.system.interval")} hint={t("integrations.ui.system.intervalHint")}>
            <Segmented
              value={String(cfg.intervalMs)}
              onChange={(v) => update("system", { intervalMs: Number(v) })}
              options={["500", "1000", "2000", "5000"].map((v) => ({
                value: v,
                label: Number(v) < 1000 ? `${v} ms` : `${Number(v) / 1000} s`,
              }))}
            />
          </Field>
        </div>
        <p className="integrations-note">{t("integrations.ui.system.note")}</p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bambu Lab
// ---------------------------------------------------------------------------

export function BambuPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.bambu);
  const update = useIntegrations((s) => s.update);
  const bambu = useSignals((s) => s.bambu);
  const [show, setShow] = useState(false);
  const state = bambu?.state ?? "IDLE";
  const stateLabel =
    t(`integrations.ui.bambu.states.${state}`) === `integrations.ui.bambu.states.${state}` ? state : t(`integrations.ui.bambu.states.${state}`);
  const tone =
    state === "FAILED" ? "danger" : state === "FINISH" ? "success" : state === "PAUSE" ? "warning" : state === "RUNNING" || state === "PREPARE" ? "info" : "";

  return (
    <div className="integrations-panel">
      <div className="integrations-split">
        <div className="integrations-print">
          {bambu ? (
            <>
              <div className="integrations-print__top">
                <span className={cx("integrations-state", tone && `integrations-state--${tone}`)}>
                  <span className="kh-dot" />
                  {stateLabel}
                </span>
                {backend.kind === "mock" && cfg.serial === DEMO_PRINTER.serial && <span className="integrations-demo">{t("integrations.ui.demoPrinter")}</span>}
              </div>
              <div className="integrations-print__pct">
                {Math.round(bambu.progress)}
                <span>%</span>
              </div>
              <Progress value={bambu.progress / 100} color={state === "FAILED" ? "var(--danger)" : state === "FINISH" ? "var(--success)" : undefined} />
              <KV
                rows={[
                  [t("integrations.ui.bambu.remaining"), fmtMinutes(bambu.remainingMin, t)],
                  [t("integrations.ui.bambu.layer"), bambu.layer !== undefined ? `${bambu.layer} / ${bambu.totalLayers ?? "—"}` : "—"],
                ]}
              />
            </>
          ) : (
            <div className="integrations-print__empty">
              <div className="integrations-print__pct integrations-print__pct--muted">—</div>
              <p>{cfg.enabled ? t("integrations.ui.bambu.waiting") : t("integrations.ui.bambu.off")}</p>
            </div>
          )}
        </div>
        <Section title={t("integrations.ui.connection")}>
          <div className="integrations-form integrations-form--2">
            <Field label={t("integrations.bambu.host")}>
              <Input className="mono" value={cfg.host} placeholder="192.168.1.42" onChange={(e) => update("bambu", { host: e.target.value.trim() })} />
            </Field>
            <Field label={t("integrations.ui.port")}>
              <Input className="mono" type="number" value={cfg.port} onChange={(e) => update("bambu", { port: Number(e.target.value) || 8883 })} />
            </Field>
            <Field label={t("integrations.bambu.serial")}>
              <Input className="mono" value={cfg.serial} placeholder="01P00A000000000" onChange={(e) => update("bambu", { serial: e.target.value.trim() })} />
            </Field>
            <Field label={t("integrations.bambu.accessCode")}>
              <div className="integrations-secret">
                <Input
                  className="mono"
                  type={show ? "text" : "password"}
                  value={cfg.accessCode}
                  placeholder="12345678"
                  onChange={(e) => update("bambu", { accessCode: e.target.value.trim() })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={show ? <EyeOff /> : <Eye />}
                  title={t("integrations.ui.reveal")}
                  onClick={() => setShow((s) => !s)}
                />
              </div>
            </Field>
          </div>
          <div className="integrations-toggles">
            <Toggle
              checked={cfg.flashOnFinish}
              onChange={(flashOnFinish) => update("bambu", { flashOnFinish })}
              label={t("integrations.bambu.flashOnFinish")}
            />
            <Toggle checked={cfg.hud} onChange={(hud) => update("bambu", { hud })} label={t("integrations.ui.hud")} />
          </div>
        </Section>
      </div>
      <Section title={t("integrations.ui.setup")}>
        <ol className="integrations-steps">
          <li>{t("integrations.ui.bambu.step1")}</li>
          <li>{t("integrations.ui.bambu.step2")}</li>
          <li>{t("integrations.ui.bambu.step3")}</li>
        </ol>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

export const CLAUDE_COLORS: Record<ClaudeState, string> = {
  idle: "#71717a",
  working: "#5aa9ff",
  waiting: "#d97757",
  done: "#22c55e",
  error: "#ef4444",
};

const HOOKS = `{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "keyhalo claude working" }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "keyhalo claude working" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "keyhalo claude waiting" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "keyhalo claude done" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "keyhalo claude idle" }] }]
  }
}`;

export function ClaudePanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.claude);
  const update = useIntegrations((s) => s.update);
  const claude = useSignals((s) => s.claude);
  const api = useSettings((s) => s.settings.api);
  const state = claude?.state ?? "idle";
  const auth = api.token ? `\n  -H "Authorization: Bearer ${api.token}"` : "";
  const curl = `curl -s -X POST http://127.0.0.1:${api.port}/api/v1/action \\${auth ? `${auth} \\` : ""}\n  -H "Content-Type: application/json" \\\n  -d '{"action":"claude","params":{"state":"waiting"}}'`;
  const ps = `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:${api.port}/api/v1/action \`${api.token ? `\n  -Headers @{ Authorization = "Bearer ${api.token}" } \`` : ""}\n  -ContentType "application/json" \`\n  -Body '{"action":"claude","params":{"state":"working"}}'`;

  return (
    <div className="integrations-panel">
      <div className="integrations-claude">
        <div className="integrations-claude__now" style={{ ["--c" as string]: CLAUDE_COLORS[state] }}>
          <span className={cx("integrations-pulse", (state === "working" || state === "waiting") && "is-live")} />
          <div>
            <div className="integrations-claude__state">{t(`integrations.ui.claude.states.${state}`)}</div>
            <div className="subtle" style={{ fontSize: 12 }}>
              {claude
                ? t("integrations.ui.since", {
                    time: new Date(claude.since).toLocaleTimeString(),
                  })
                : t("integrations.ui.claude.noEvents")}
            </div>
          </div>
        </div>
        <div className="integrations-claude__states">
          <span className="integrations-mini-label">{t("integrations.ui.claude.simulate")}</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {CLAUDE_STATES.map((s) => (
              <button
                key={s}
                type="button"
                className={cx("integrations-statechip", s === state && "is-on")}
                style={{ ["--c" as string]: CLAUDE_COLORS[s] }}
                onClick={() => setClaudeState(s)}
                disabled={!cfg.enabled}
              >
                <span className="kh-dot" />
                {t(`integrations.ui.claude.states.${s}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-toggles">
          <Toggle checked={cfg.hudOnWaiting} onChange={(hudOnWaiting) => update("claude", { hudOnWaiting })} label={t("integrations.claude.hudOnWaiting")} />
          <Toggle
            checked={cfg.flashOnWaiting}
            onChange={(flashOnWaiting) => update("claude", { flashOnWaiting })}
            label={t("integrations.claude.flashOnWaiting")}
          />
          <div className="row">
            <span className="integrations-mini-label">{t("integrations.ui.claude.flashColor")}</span>
            <ColorInput value={cfg.flashColor} onChange={(flashColor) => update("claude", { flashColor })} />
          </div>
        </div>
      </Section>
      <Section title={t("integrations.ui.claude.hooks")}>
        <p className="integrations-note">{t("integrations.ui.claude.hooksHint")}</p>
        <CodeBlock code={HOOKS} label="~/.claude/settings.json" />
      </Section>
      <Section title={t("integrations.ui.claude.cli")}>
        <p className="integrations-note">{t("integrations.ui.claude.cliHint")}</p>
        <div className="integrations-code-grid">
          <CodeBlock code={curl} label="bash · curl" />
          <CodeBlock code={ps} label="PowerShell" />
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pomodoro
// ---------------------------------------------------------------------------

export function PomodoroRing({ size = 168, stroke = 10 }: { size?: number; stroke?: number }) {
  const t = useT();
  const sig = useSignals((s) => s.pomodoro);
  const phase = usePomodoro((s) => s.phase);
  const paused = usePomodoro((s) => s.pausedRemaining !== null);
  const cfg = useIntegrations((s) => s.config.pomodoro);
  const remaining = sig?.remainingMs ?? cfg.focusMin * 60_000;
  const total = sig?.totalMs || cfg.focusMin * 60_000;
  const f = phase === "idle" ? 0 : 1 - remaining / total;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = phase === "focus" ? "#ff8a65" : phase === "break" ? "#7ee0a1" : "var(--text-3)";
  return (
    <div className="integrations-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        {f > 0.002 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * f} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray 300ms linear" }}
          />
        )}
      </svg>
      <div className="integrations-ring__center">
        <div className="integrations-ring__time">{fmtClock(remaining)}</div>
        <div className="integrations-ring__phase">
          {phase === "idle"
            ? t("integrations.ui.status.ready")
            : paused
              ? t("integrations.pomodoro.pause")
              : t(phase === "focus" ? "integrations.ui.pomodoro.focusing" : "integrations.ui.pomodoro.onBreak")}
        </div>
      </div>
    </div>
  );
}

export function PomodoroPanel() {
  const t = useT();
  const cfg = useIntegrations((s) => s.config.pomodoro);
  const update = useIntegrations((s) => s.update);
  const p = usePomodoro();
  const running = p.phase !== "idle";
  const paused = p.pausedRemaining !== null;
  return (
    <div className="integrations-panel">
      <div className="integrations-pomo">
        <PomodoroRing />
        <div className="col" style={{ gap: 14 }}>
          <div className="row wrap">
            {!running ? (
              <Button variant="primary" icon={<Play />} onClick={() => p.start()}>
                {t("integrations.pomodoro.start")}
              </Button>
            ) : (
              <>
                <Button variant="primary" icon={paused ? <Play /> : <Pause />} onClick={() => (paused ? p.resume() : p.pause())}>
                  {paused ? t("integrations.pomodoro.resume") : t("integrations.pomodoro.pause")}
                </Button>
                <Button icon={<SkipForward />} onClick={() => p.skip()}>
                  {t("integrations.pomodoro.skip")}
                </Button>
                <Button icon={<Square />} onClick={() => p.stop()}>
                  {t("integrations.pomodoro.stop")}
                </Button>
              </>
            )}
          </div>
          <div className="integrations-dots" title={t("integrations.ui.pomodoro.sessions")}>
            {Array.from({ length: Math.max(1, cfg.cyclesBeforeLong) }, (_, i) => (
              <span key={i} className={cx("integrations-dot", i < p.completed % Math.max(1, cfg.cyclesBeforeLong) && "is-done")} />
            ))}
            <span className="subtle" style={{ fontSize: 12 }}>
              {t("integrations.ui.pomodoro.completed", { n: p.completed })}
            </span>
          </div>
          <p className="integrations-note">{t("integrations.ui.pomodoro.hint")}</p>
        </div>
      </div>
      <Section title={t("integrations.ui.settings")}>
        <div className="integrations-form integrations-form--2">
          <Slider
            label={t("integrations.pomodoro.focus")}
            value={cfg.focusMin}
            min={5}
            max={90}
            step={5}
            unit="min"
            onChange={(focusMin) => update("pomodoro", { focusMin })}
          />
          <Slider
            label={t("integrations.pomodoro.break")}
            value={cfg.breakMin}
            min={1}
            max={30}
            unit="min"
            onChange={(breakMin) => update("pomodoro", { breakMin })}
          />
          <Slider
            label={t("integrations.pomodoro.longBreak")}
            value={cfg.longBreakMin}
            min={5}
            max={60}
            step={5}
            unit="min"
            onChange={(longBreakMin) => update("pomodoro", { longBreakMin })}
          />
          <Slider
            label={t("integrations.ui.pomodoro.cycles")}
            value={cfg.cyclesBeforeLong}
            min={2}
            max={8}
            onChange={(cyclesBeforeLong) => update("pomodoro", { cyclesBeforeLong })}
          />
        </div>
        <div className="integrations-toggles">
          <Toggle checked={cfg.autoContinue} onChange={(autoContinue) => update("pomodoro", { autoContinue })} label={t("integrations.ui.pomodoro.auto")} />
          <Toggle checked={cfg.flash} onChange={(flash) => update("pomodoro", { flash })} label={t("integrations.ui.pomodoro.flash")} />
          <Toggle checked={cfg.hud} onChange={(hud) => update("pomodoro", { hud })} label={t("integrations.ui.hud")} />
        </div>
      </Section>
    </div>
  );
}
