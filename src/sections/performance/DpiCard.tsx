import { useEffect, useState } from "react";
import { Link2, Link2Off, Plus, Trash2 } from "lucide-react";
import { useDevices } from "@/core/devices";
import type { ConnectedDevice, DpiStage } from "@/core/types";
import { Badge, Button, Card, Slider } from "@/ui";
import { useT } from "@/i18n";
import { NumberField } from "./NumberField";
import { snap, write } from "./util";

/** Log-scale position (0..1) of a DPI value along min..max. */
function pos(v: number, min: number, max: number) {
  const lo = Math.log(min);
  const hi = Math.log(max);
  return Math.min(1, Math.max(0, (Math.log(Math.max(min, v)) - lo) / (hi - lo || 1)));
}

/** Stage sliders use the same log scale as the bar (0..1000 ⇄ min..max). */
const LOG_STEPS = 1000;
const toLog = (v: number, min: number, max: number) => Math.round(pos(v, min, max) * LOG_STEPS);
const fromLog = (p: number, min: number, max: number) => Math.exp(Math.log(min) + (p / LOG_STEPS) * (Math.log(max) - Math.log(min)));

const fmt = (v: number) => v.toLocaleString("en-US");
const NO_STAGES: DpiStage[] = [];

export function DpiBar({ stages, active, current, sniper, min, max }: { stages: DpiStage[]; active: number; current?: number; sniper?: number; min: number; max: number }) {
  const t = useT();
  const ticks = [min, 400, 800, 1600, 3200, 6400, 12800, max].filter((v, i, a) => v >= min && v <= max && a.indexOf(v) === i && (v === max || pos(max, min, max) - pos(v, min, max) > 0.06));
  return (
    <div className="perf-dpibar" aria-hidden>
      <div className="perf-dpibar__track">
        <div className="perf-dpibar__fill" style={{ width: `${pos(stages[active]?.x ?? min, min, max) * 100}%` }} />
        {sniper !== undefined && (
          <div className="perf-dpibar__sniper" style={{ left: `${pos(sniper, min, max) * 100}%` }} title={t("performance.sniper.title")}>
            <span>{t("performance.sniper.short")}</span>
          </div>
        )}
        {stages.map((s, i) => (
          <div key={i} className={`perf-dpibar__pin${i === active ? " is-active" : ""}`} style={{ left: `${pos(s.x, min, max) * 100}%` }}>
            <span>{i + 1}</span>
          </div>
        ))}
        {current !== undefined && current !== stages[active]?.x && <div className="perf-dpibar__now" style={{ left: `${pos(current, min, max) * 100}%` }} />}
      </div>
      <div className="perf-dpibar__ticks">
        {ticks.map((v) => (
          <span key={v} style={{ left: `${pos(v, min, max) * 100}%` }}>
            {v >= 1000 ? `${v / 1000}k` : v}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DpiCard({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const cap = device.definition.capabilities.dpi!;
  const live = useDevices((s) => s.live[device.uid]);
  const setMouseSettings = useDevices((s) => s.setMouseSettings);
  const mouse = live?.mouse;
  const storeStages = mouse?.dpiStages ?? NO_STAGES;
  const active = Math.min(mouse?.activeStage ?? 0, Math.max(0, storeStages.length - 1));
  const [draft, setDraft] = useState<DpiStage[]>(storeStages);
  const [locks, setLocks] = useState<boolean[]>([]);

  useEffect(() => setDraft(storeStages), [storeStages]);

  const isLocked = (i: number) => !cap.independentXY || (locks[i] ?? draft[i]?.x === draft[i]?.y);
  const sn = (v: number) => snap(v, cap.min, cap.max, cap.step);

  const commit = async (stages: DpiStage[], activeStage = active) => {
    const ok = await write(() => setMouseSettings(device.uid, { dpiStages: stages, activeStage }));
    if (!ok) setDraft(useDevices.getState().live[device.uid]?.mouse?.dpiStages ?? storeStages);
  };

  const change = (i: number, axis: "x" | "y", v: number, doCommit: boolean) => {
    const next = draft.map((s, j) => (j !== i ? s : isLocked(i) ? { x: sn(v), y: sn(v) } : { ...s, [axis]: sn(v) }));
    setDraft(next);
    if (doCommit) void commit(next);
  };

  const addStage = () => {
    if (draft.length >= cap.stages) return;
    const last = draft[draft.length - 1]?.x ?? 800;
    const v = sn(last * 2 <= cap.max ? last * 2 : Math.min(cap.max, last + 400));
    setLocks((l) => [...l.slice(0, draft.length), true]);
    void commit([...draft, { x: v, y: v }]);
  };

  const removeStage = (i: number) => {
    if (draft.length <= 1) return;
    const next = draft.filter((_, j) => j !== i);
    setLocks((l) => l.filter((_, j) => j !== i));
    const nextActive = i < active ? active - 1 : Math.min(active, next.length - 1);
    void commit(next, nextActive);
  };

  const toggleLock = (i: number) => {
    const locked = isLocked(i);
    setLocks((l) => {
      const n = [...l];
      n[i] = !locked;
      return n;
    });
    if (!locked && draft[i].x !== draft[i].y) {
      const next = draft.map((s, j) => (j === i ? { x: s.x, y: s.x } : s));
      setDraft(next);
      void commit(next);
    }
  };

  const current = live?.dpi?.x;
  const sniperActive = current !== undefined && draft[active] && current !== draft[active].x;

  return (
    <Card
      className="perf-dpi"
      title={t("performance.dpi.title")}
      subtitle={t("performance.dpi.range", { min: fmt(cap.min), max: fmt(cap.max), step: cap.step })}
      actions={
        <Button size="sm" icon={<Plus />} onClick={addStage} disabled={draft.length >= cap.stages || !mouse}>
          {t("performance.dpi.addStage")}
        </Button>
      }
    >
      <div className="perf-dpi__hero">
        <div className="perf-dpi__now">
          <span className="perf-dpi__value tabular">{current !== undefined ? fmt(current) : "—"}</span>
          <span className="perf-dpi__unit">DPI</span>
          {sniperActive ? (
            <Badge tone="warning" dot>
              {current === mouse?.sniperDpi ? t("performance.sniper.active") : t("performance.dpi.override")}
            </Badge>
          ) : (
            draft.length > 0 && <Badge>{t("performance.dpi.stageOf", { stage: active + 1, count: draft.length })}</Badge>
          )}
          {live?.dpi && live.dpi.x !== live.dpi.y && (
            <span className="subtle perf-dpi__xy tabular">
              X {fmt(live.dpi.x)} · Y {fmt(live.dpi.y)}
            </span>
          )}
        </div>
        <DpiBar stages={draft} active={active} current={current} sniper={mouse?.sniperDpi} min={cap.min} max={cap.max} />
      </div>

      {!mouse ? (
        <div className="subtle perf-note">{t("performance.dpi.unavailable")}</div>
      ) : (
        <div className="perf-stages" role="radiogroup" aria-label={t("performance.dpi.activeStage")}>
          {draft.map((s, i) => {
            const locked = isLocked(i);
            return (
              <div key={i} className={`perf-stage${i === active ? " is-active" : ""}`}>
                <div className="perf-stage__row">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={i === active}
                    className="perf-radio"
                    title={t("performance.dpi.makeActive")}
                    onClick={() => i !== active && void commit(draft, i)}
                  />
                  <span className="perf-stage__label">{t("performance.dpi.stage", { n: i + 1 })}</span>
                  <div className="perf-stage__slider">
                    <Slider
                      value={toLog(s.x, cap.min, cap.max)}
                      min={0}
                      max={LOG_STEPS}
                      onChange={(p) => change(i, "x", fromLog(p, cap.min, cap.max), false)}
                      onCommit={(p) => change(i, "x", fromLog(p, cap.min, cap.max), true)}
                    />
                  </div>
                  <span className="perf-axis">{locked ? "" : "X"}</span>
                  <NumberField value={s.x} min={cap.min} max={cap.max} step={cap.step} onCommit={(v) => change(i, "x", v, true)} ariaLabel={t("performance.dpi.stage", { n: i + 1 })} />
                  {cap.independentXY ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={locked ? <Link2 /> : <Link2Off />}
                      title={locked ? t("performance.dpi.unlockXY") : t("performance.dpi.lockXY")}
                      onClick={() => toggleLock(i)}
                      aria-pressed={locked}
                    />
                  ) : (
                    <span />
                  )}
                  <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title={t("performance.dpi.remove")} disabled={draft.length <= 1} onClick={() => removeStage(i)} />
                </div>
                {!locked && (
                  <div className="perf-stage__row perf-stage__row--y">
                    <span />
                    <span className="perf-stage__label subtle">{t("performance.dpi.vertical")}</span>
                    <div className="perf-stage__slider">
                      <Slider
                      value={toLog(s.y, cap.min, cap.max)}
                      min={0}
                      max={LOG_STEPS}
                      onChange={(p) => change(i, "y", fromLog(p, cap.min, cap.max), false)}
                      onCommit={(p) => change(i, "y", fromLog(p, cap.min, cap.max), true)}
                    />
                    </div>
                    <span className="perf-axis">Y</span>
                    <NumberField value={s.y} min={cap.min} max={cap.max} step={cap.step} onCommit={(v) => change(i, "y", v, true)} ariaLabel="Y" />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            );
          })}
          <div className="perf-stages__foot subtle">{t("performance.dpi.hint", { count: cap.stages })}</div>
        </div>
      )}
    </Card>
  );
}
