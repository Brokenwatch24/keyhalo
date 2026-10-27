import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Badge, Card, KeyboardView, Kbd, Progress } from "@/ui";
import { useT } from "@/i18n";
import { getTemplate, layoutOf, primaryKeyboard, useDevices } from "@/core/devices";
import type { RGB } from "@/core/types";
import { Metric, TestHeader, fmt } from "./shared";

/** A key pressed again sooner than this after its release is flagged as chatter (switch bounce). */
const CHATTER_MS = 30;
const PRESSED: RGB = [110, 231, 214];
const TESTED: RGB = [34, 84, 78];
const BAD: RGB = [239, 68, 68];
/** The OS never sees Fn: draw it dimmed. */
const UNTESTABLE = new Set(["Fn"]);

interface LogEntry {
  n: number;
  code: string;
  key: string;
  keyCode: number;
  down: boolean;
  /** Hold time on key-up, gap since release on chatter. */
  ms?: number;
  chatter?: boolean;
}

export function KeyTest() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const board = primaryKeyboard(devices);
  const { layout, size } = useMemo(() => {
    const l = board && layoutOf(board);
    if (board && l) return { layout: l, size: board.definition.size };
    const tpl = getTemplate("ansi-60");
    return { layout: tpl.layout, size: tpl.size };
  }, [board]);
  const layoutCodes = useMemo(() => new Set(layout.keys.map((k) => k.code).filter((c) => c !== "Fn")), [layout]);

  const areaRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [tested, setTested] = useState<Set<string>>(new Set());
  const [chatter, setChatter] = useState<Record<string, number>>({});
  const [maxSimul, setMaxSimul] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const downAt = useRef<Record<string, number>>({});
  const upAt = useRef<Record<string, number>>({});
  const seq = useRef(0);
  /** Source of truth for held keys (several events can arrive before React re-renders). */
  const held = useRef<Set<string>>(new Set());

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const push = (e: LogEntry) => setLog((l) => [e, ...l].slice(0, 10));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.preventDefault();
    if (e.repeat) return;
    const code = e.code || e.key;
    const now = e.timeStamp;
    if (held.current.has(code)) return;
    const gap = upAt.current[code] !== undefined ? now - upAt.current[code] : Infinity;
    const isChatter = gap < CHATTER_MS;
    if (isChatter) setChatter((c) => ({ ...c, [code]: (c[code] ?? 0) + 1 }));
    downAt.current[code] = now;
    held.current.add(code);
    setPressed(new Set(held.current));
    const count = held.current.size;
    setMaxSimul((m) => Math.max(m, count));
    setTested((s) => (s.has(code) ? s : new Set(s).add(code)));
    push({ n: ++seq.current, code, key: e.key, keyCode: e.keyCode, down: true, ms: isChatter ? gap : undefined, chatter: isChatter });
  };

  const onKeyUp = (e: ReactKeyboardEvent) => {
    e.preventDefault();
    const code = e.code || e.key;
    const now = e.timeStamp;
    upAt.current[code] = now;
    const holdMs = downAt.current[code] !== undefined ? now - downAt.current[code] : undefined;
    // PrintScreen only reports key-up on Windows: count it as tested.
    setTested((s) => (s.has(code) ? s : new Set(s).add(code)));
    held.current.delete(code);
    setPressed(new Set(held.current));
    push({ n: ++seq.current, code, key: e.key, keyCode: e.keyCode, down: false, ms: holdMs });
  };

  const reset = () => {
    held.current.clear();
    setPressed(new Set());
    setTested(new Set());
    setChatter({});
    setMaxSimul(0);
    setLog([]);
    downAt.current = {};
    upAt.current = {};
    areaRef.current?.focus();
  };

  const colors = useMemo(() => {
    const c: Record<string, RGB> = {};
    for (const code of tested) c[code] = TESTED;
    for (const code of Object.keys(chatter)) c[code] = BAD;
    for (const code of pressed) c[code] = PRESSED;
    return c;
  }, [tested, pressed, chatter]);

  const testedOnLayout = [...tested].filter((c) => layoutCodes.has(c)).length;
  const offLayout = [...tested].filter((c) => !layoutCodes.has(c));
  const chatterKeys = Object.entries(chatter);
  const chatterTotal = chatterKeys.reduce((a, [, n]) => a + n, 0);

  return (
    <div className="tb-stack">
      <TestHeader hint={t("testbench.keys.hint", { ms: CHATTER_MS })} onReset={reset}>
        <Badge tone={focused ? "success" : undefined} dot>
          {focused ? t("testbench.keys.listening") : t("testbench.keys.paused")}
        </Badge>
      </TestHeader>

      <div className="tb-metrics tb-metrics--row">
        <Metric
          label={t("testbench.keys.tested")}
          value={testedOnLayout}
          unit={`/ ${layoutCodes.size}`}
          hint={<Progress value={layoutCodes.size ? testedOnLayout / layoutCodes.size : 0} />}
        />
        <Metric label={t("testbench.keys.rollover")} value={maxSimul} unit={t("testbench.keys.keysUnit")} hint={t("testbench.keys.rolloverHint")} />
        <Metric label={t("testbench.keys.held")} value={pressed.size} hint={[...pressed].slice(0, 6).join(" + ") || " "} />
        <Metric
          label={t("testbench.keys.chatter")}
          value={chatterTotal}
          tone={chatterTotal ? "danger" : undefined}
          hint={chatterKeys.length ? chatterKeys.map(([c, n]) => `${c} ×${n}`).join(", ") : t("testbench.keys.noChatter")}
        />
      </div>

      <div
        ref={areaRef}
        tabIndex={0}
        className={`tb-keys${focused ? " tb-keys--focused" : ""}`}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          held.current.clear();
          setPressed(new Set());
        }}
        onMouseDown={() => areaRef.current?.focus()}
        aria-label={t("testbench.keys.areaLabel")}
      >
        <KeyboardView keys={layout.keys} size={size} colors={colors} pressed={pressed} dim={UNTESTABLE} maxWidth={1040} glow={0.9} />
        {!focused && (
          <div className="tb-keys__veil">
            <span>{t("testbench.keys.clickToFocus")}</span>
          </div>
        )}
      </div>

      <div className="tb-grid-2">
        <Card title={t("testbench.keys.log")} subtitle={t("testbench.keys.logSub")} flush>
          {log.length === 0 ? (
            <div className="tb-chart-empty">{t("testbench.keys.noKeys")}</div>
          ) : (
            <div className="tb-log">
              {log.map((l) => (
                <div key={l.n} className="tb-log__row tb-log__row--keys">
                  <span className={l.down ? "tb-arrow tb-arrow--down" : "tb-arrow"}>{l.down ? "↓" : "↑"}</span>
                  <span className="mono">{l.code}</span>
                  <span>
                    <Kbd>{l.key === " " ? "Space" : l.key}</Kbd>
                  </span>
                  <span className="mono subtle tabular">{l.keyCode}</span>
                  <span className="mono tabular">
                    {l.chatter ? (
                      <Badge tone="danger">{t("testbench.keys.chatterAfter", { ms: fmt(l.ms ?? 0, 1) })}</Badge>
                    ) : l.ms !== undefined ? (
                      <span className="subtle">{t("testbench.keys.heldFor", { ms: fmt(l.ms) })}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={t("testbench.keys.notesTitle")}>
          <ul className="tb-notes">
            <li>{t("testbench.keys.noteFn")}</li>
            <li>{t("testbench.keys.noteOs")}</li>
            <li>{t("testbench.keys.noteNkro")}</li>
          </ul>
          {offLayout.length > 0 && (
            <div className="tb-offlayout">
              <div className="tb-metric__label">{t("testbench.keys.offLayout")}</div>
              <div className="row wrap">
                {offLayout.map((c) => (
                  <Kbd key={c}>{c}</Kbd>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
