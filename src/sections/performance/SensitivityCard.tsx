import { useEffect, useMemo, useState } from "react";
import { Crosshair, Upload } from "lucide-react";
import { useDevices } from "@/core/devices";
import type { ConnectedDevice } from "@/core/types";
import { Button, Card, Field, Select, toast } from "@/ui";
import { useT } from "@/i18n";
import { NumberField } from "./NumberField";
import { GAMES, R6_DEFAULT_MULTIPLIER, cmPer360, convertSens, formatSens, type GameId } from "./sensitivity";
import { loadLocal, saveLocal, snap, write } from "./util";

interface CalcState {
  game: GameId;
  sens: number;
  dpi: number;
  targetDpi: number;
  r6Multiplier: number;
}

const DEFAULTS: CalcState = { game: "valorant", sens: 0.35, dpi: 800, targetDpi: 800, r6Multiplier: R6_DEFAULT_MULTIPLIER };

const fmtCm = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");

export function SensitivityCard({ device }: { device?: ConnectedDevice }) {
  const t = useT();
  const cap = device?.definition.capabilities.dpi;
  const live = useDevices((s) => (device ? s.live[device.uid] : undefined));
  const setMouseSettings = useDevices((s) => s.setMouseSettings);
  const deviceDpi = live?.mouse?.dpiStages[live.mouse.activeStage]?.x;
  const [st, setSt] = useState<CalcState>(() => {
    const saved = loadLocal("performance.sens", DEFAULTS);
    return deviceDpi ? { ...saved, dpi: deviceDpi, targetDpi: saved.targetDpi || deviceDpi } : saved;
  });
  const patch = (p: Partial<CalcState>) => setSt((s) => ({ ...s, ...p }));
  useEffect(() => saveLocal("performance.sens", st), [st]);

  const game = GAMES.find((g) => g.id === st.game)!;
  const cm = cmPer360(st.game, st.sens, st.dpi, st.r6Multiplier);
  const edpi = st.dpi * st.sens;
  const usesR6 = st.game === "r6";

  const rows = useMemo(
    () =>
      GAMES.map((g) => ({
        game: g,
        sens: convertSens(st.game, st.sens, st.dpi, g.id, st.targetDpi, st.r6Multiplier),
      })),
    [st],
  );

  const canApply = !!device && !!cap && !!live?.mouse && st.targetDpi !== deviceDpi;
  const apply = async () => {
    if (!device || !cap || !live?.mouse) return;
    const v = snap(st.targetDpi, cap.min, cap.max, cap.step);
    const stages = live.mouse.dpiStages.map((s, i) => (i === live.mouse!.activeStage ? { x: v, y: v } : s));
    if (await write(() => setMouseSettings(device.uid, { dpiStages: stages }))) toast(t("performance.sens.applied", { dpi: v.toLocaleString("en-US") }));
  };

  return (
    <Card
      title={t("performance.sens.title")}
      subtitle={t("performance.sens.subtitle")}
      actions={
        deviceDpi !== undefined && (
          <Button size="sm" variant="ghost" icon={<Crosshair />} onClick={() => patch({ dpi: deviceDpi })}>
            {t("performance.sens.useDevice", { dpi: deviceDpi.toLocaleString("en-US") })}
          </Button>
        )
      }
    >
      <div className="perf-sens">
        <div className="perf-sens__inputs">
          <div className="perf-sens__label">{t("performance.sens.yours")}</div>
          <Field label={t("performance.sens.game")}>
            <Select value={st.game} onChange={(g) => patch({ game: g })} options={GAMES.map((g) => ({ value: g.id, label: g.name }))} />
          </Field>
          <div className="perf-sens__pair">
            <Field label={t("performance.sens.sensitivity")}>
              <NumberField value={st.sens} min={0.0001} max={1000} step={0.0001} onCommit={(v) => patch({ sens: v })} suffix={game.suffix} width={999} />
            </Field>
            <Field label="DPI">
              <NumberField value={st.dpi} min={50} max={64000} step={1} onCommit={(v) => patch({ dpi: v })} width={999} />
            </Field>
          </div>
          {usesR6 && (
            <Field label={t("performance.sens.r6Multiplier")} hint={t("performance.sens.r6Hint")}>
              <NumberField value={st.r6Multiplier} min={0.0001} max={1} step={0.0001} onCommit={(v) => patch({ r6Multiplier: v })} width={999} />
            </Field>
          )}
          <div className="perf-sens__results">
            <div>
              <div className="perf-sens__big tabular">{fmtCm(cm)}</div>
              <div className="subtle">{t("performance.sens.cm360")}</div>
            </div>
            <div>
              <div className="perf-sens__big tabular">{Number.isFinite(cm) ? (cm / 2.54).toFixed(1) : "—"}</div>
              <div className="subtle">{t("performance.sens.in360")}</div>
            </div>
            <div>
              <div className="perf-sens__big tabular">{Number.isFinite(edpi) ? Math.round(edpi * 100) / 100 : "—"}</div>
              <div className="subtle">eDPI</div>
            </div>
          </div>
          <div className="perf-sens__feel subtle">{Number.isFinite(cm) ? t(cm < 20 ? "performance.sens.feelHigh" : cm < 45 ? "performance.sens.feelMid" : "performance.sens.feelLow") : ""}</div>
        </div>

        <div className="perf-sens__table">
          <div className="perf-sens__tablehead">
            <div className="perf-sens__label">{t("performance.sens.sameFeel")}</div>
            <div className="row">
              <span className="subtle perf-small">{t("performance.sens.atDpi")}</span>
              <NumberField value={st.targetDpi} min={50} max={64000} step={1} onCommit={(v) => patch({ targetDpi: v })} width={92} />
              {cap && (
                <Button size="sm" icon={<Upload />} disabled={!canApply} onClick={apply} title={t("performance.sens.applyHint")}>
                  {t("performance.sens.apply")}
                </Button>
              )}
            </div>
          </div>
          <table className="perf-table">
            <thead>
              <tr>
                <th>{t("performance.sens.game")}</th>
                <th className="num">{t("performance.sens.sensitivity")}</th>
                <th className="num">eDPI</th>
                <th className="num">cm/360</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ game: g, sens }) => (
                <tr key={g.id} className={g.id === st.game && st.targetDpi === st.dpi ? "is-source" : undefined}>
                  <td>
                    {g.name}
                    {g.id === "r6" && <span className="perf-table__sub">{t("performance.sens.hipfire")}</span>}
                    {g.id === "fortnite" && <span className="perf-table__sub">X/Y</span>}
                  </td>
                  <td className="num mono">{formatSens(g.id, sens)}</td>
                  <td className="num mono subtle">{Number.isFinite(sens) ? Math.round(sens * st.targetDpi * 10) / 10 : "—"}</td>
                  <td className="num mono">{fmtCm(cmPer360(g.id, sens, st.targetDpi, st.r6Multiplier))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="perf-note subtle">{t("performance.sens.note")}</div>
        </div>
      </div>
    </Card>
  );
}
