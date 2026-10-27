import { useEffect, useMemo, useState } from "react";
import { Cpu, Eye, EyeOff, HardDriveDownload, RotateCcw, Sparkles, ThumbsUp, Undo2 } from "lucide-react";
import { Badge, Button, ColorInput, KeyboardView, Modal, MouseView, Segmented, Select, Slider, toast } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { useDevices, layoutOf, setSoftwareMode, LOCALE_OVERLAYS } from "@/core/devices";
import { useLightingFrame, useProfiles, useSignals } from "@/core/lighting";
import { deviceReportUrl } from "@/core/community";
import { useSettings } from "@/core/state/settings";
import type { ConnectedDevice, HardwareEffect, HardwareEffectType, RGB } from "@/core/types";
import { BatteryIcon, DeviceIcon, batteryTone } from "../dashboard/shared";
import { errorText, hexToRgb, rgbToHex } from "./util";

const PICKER: HardwareEffectType[] = ["off", "static", "breathing", "spectrum", "wave", "reactive", "starlight"];
const WITH_COLOR = new Set<HardwareEffectType>(["static", "breathing", "reactive", "starlight"]);
const WITH_SPEED = new Set<HardwareEffectType>(["wave", "reactive", "starlight"]);

function maskSerial(s: string) {
  return s.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

export function DeviceCard({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const def = device.definition;
  const live = useDevices((s) => s.live[device.uid]);
  const setEffect = useDevices((s) => s.setEffect);
  const setBrightness = useDevices((s) => s.setBrightness);
  const restoreSnapshot = useDevices((s) => s.restoreSnapshot);
  const saveToOnboard = useDevices((s) => s.saveToOnboard);
  const setLayout = useDevices((s) => s.setLayout);
  const signalBattery = useSignals((s) => s.battery[device.uid]);
  const safeMode = useSettings((s) => s.settings.safeMode);
  const activeProfile = useProfiles((s) => s.profiles.find((p) => p.id === s.activeId));
  const frame = useLightingFrame(device.uid);

  const [reveal, setReveal] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const caps = def.capabilities;
  const effects = PICKER.filter((e) => caps.hardwareEffects?.includes(e));
  const isKeyboard = def.type === "keyboard";
  const layout = isKeyboard ? layoutOf(device) : undefined;
  const hwMode = live?.mode === "hardware";
  const battery = live?.battery ?? signalBattery;

  // Hardware effect editor state (starts from what the device shows).
  const [fx, setFx] = useState<HardwareEffect>(() => normalise(live?.effect));
  useEffect(() => {
    if (live?.effect && live.mode === "hardware") setFx(normalise(live.effect));
  }, [live?.effect, live?.mode]);
  const [hwBrightness, setHwBrightness] = useState(Math.round((live?.brightness ?? 1) * 100));
  useEffect(() => setHwBrightness(Math.round((live?.brightness ?? 1) * 100)), [live?.brightness]);

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast(errorText(e, t), "danger");
    } finally {
      setBusy(null);
    }
  };

  const applyFx = (next: HardwareEffect) => {
    setFx(next);
    void run("fx", () => setEffect(device.uid, next));
  };

  const layoutOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const l of Object.values(def.layouts ?? {})) {
      out.push({ value: l.id, label: l.name });
      // Spanish legends apply to ISO boards (and ANSI boards sold with Latin-American legends).
      for (const loc of ["es-ES", "es-LA"]) {
        if (loc === "es-ES" && l.standard !== "iso") continue;
        out.push({ value: `${l.id}@${loc}`, label: `${l.name} · ${LOCALE_OVERLAYS[loc].name}` });
      }
    }
    return out;
  }, [def.layouts]);

  const statusTone = def.status === "verified" ? "success" : def.status === "community" ? "info" : "warning";
  const match = def.match[0];

  return (
    <article className="dev-card">
      <div className="dev-card__visual">
        {isKeyboard && layout ? (
          <KeyboardView keys={layout.keys} size={def.size} colors={frame} showLabels={false} maxWidth={300} />
        ) : def.type === "mouse" ? (
          <MouseView leds={def.leds} colors={frame} height={120} />
        ) : (
          <DeviceIcon type={def.type} size={40} />
        )}
      </div>

      <div className="dev-card__body">
        <header className="dev-card__head">
          <div className="dev-card__title">
            <span className="dev-card__name">{def.name}</span>
            <span className="dev-card__meta">
              {def.vendor} · {t(`devices.types.${def.type}`)} · {t(`devices.drivers.${def.driver}`)}
            </span>
          </div>
          <div className="dev-card__badges">
            <Badge tone={statusTone} dot>
              {t(`devices.status.${def.status}`)}
            </Badge>
            <Badge tone={device.online ? undefined : "danger"}>{device.online ? t("common.connected") : t("devices.page.noAnswer")}</Badge>
            <Badge tone={hwMode ? "info" : undefined}>{t(`devices.mode.${live?.mode ?? "software"}`)}</Badge>
          </div>
        </header>

        {device.error && <div className="dev-card__error">{device.error}</div>}

        <dl className="dev-facts">
          <div>
            <dt>{t("devices.page.firmware")}</dt>
            <dd className="mono">{device.firmware ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("devices.page.serial")}</dt>
            <dd>
              {device.serial ? (
                <button type="button" className="dev-serial mono" onClick={() => setReveal((r) => !r)} title={reveal ? t("devices.page.hide") : t("devices.page.reveal")}>
                  {reveal ? device.serial : maskSerial(device.serial)}
                  {reveal ? <EyeOff /> : <Eye />}
                </button>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>{t("devices.page.usb")}</dt>
            <dd className="mono">{match ? `${match.vendorId.replace(/^0x/i, "")}:${match.productId.replace(/^0x/i, "")}` : "—"}</dd>
          </div>
          {battery ? (
            <div>
              <dt>{t("devices.page.battery")}</dt>
              <dd className={`dev-bat dev-bat--${batteryTone(battery.percent, battery.charging) ?? "ok"}`}>
                <BatteryIcon percent={battery.percent} charging={battery.charging} />
                <span className="mono">{Math.round(battery.percent)}%</span>
                {battery.charging && <span className="subtle">{t("devices.battery.charging")}</span>}
              </dd>
            </div>
          ) : (
            <div>
              <dt>{t("devices.page.lighting")}</dt>
              <dd>{caps.perKeyRgb ? t("devices.page.perKey") : caps.zones ? t("devices.page.zones") : "—"}</dd>
            </div>
          )}
        </dl>

        {isKeyboard && layoutOptions.length > 0 && (
          <div className="dev-row">
            <span className="dev-row__label">{t("devices.page.layout")}</span>
            <Select className="dev-row__select" value={device.layoutId ?? layoutOptions[0].value} onChange={(v) => setLayout(device.uid, v)} options={layoutOptions} />
          </div>
        )}

        {effects.length > 0 && (
          <div className="dev-hw">
            <div className="dev-hw__head">
              <span className="dev-row__label">
                <Cpu /> {t("devices.page.hardwareEffect")}
              </span>
              {hwMode ? (
                <Button size="sm" icon={<Sparkles />} onClick={() => setSoftwareMode(device.uid)}>
                  {t("devices.page.backToKeyHalo")}
                </Button>
              ) : (
                <span className="dev-hw__hint">{t("devices.page.hardwareHint")}</span>
              )}
            </div>
            <div className="dev-fx">
              {effects.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="dev-fx__chip"
                  aria-pressed={hwMode && fx.type === e}
                  disabled={busy === "fx" || safeMode}
                  onClick={() => applyFx({ ...fx, type: e })}
                >
                  <span className={`dev-fx__swatch dev-fx__swatch--${e}`} style={WITH_COLOR.has(e) ? { ["--c" as string]: rgbToHex(fx.colors?.[0] ?? [0, 255, 170]) } : undefined} />
                  {t(`devices.effects.${e}`)}
                </button>
              ))}
            </div>
            {hwMode && (WITH_COLOR.has(fx.type) || WITH_SPEED.has(fx.type)) && (
              <div className="dev-hw__params">
                {WITH_COLOR.has(fx.type) && <ColorInput value={rgbToHex(fx.colors?.[0] ?? [0, 255, 170])} onChange={(hex) => applyFx({ ...fx, colors: [hexToRgb(hex)] })} />}
                {WITH_SPEED.has(fx.type) && (
                  <Segmented
                    value={String(fx.speed ?? 2)}
                    onChange={(v) => applyFx({ ...fx, speed: Number(v) })}
                    options={[
                      { value: "1", label: t("devices.page.slow") },
                      { value: "2", label: t("devices.page.medium") },
                      { value: "3", label: t("devices.page.fast") },
                    ]}
                  />
                )}
                {fx.type === "wave" && (
                  <Segmented
                    value={fx.direction ?? "right"}
                    onChange={(v) => applyFx({ ...fx, direction: v })}
                    options={[
                      { value: "left", label: "←" },
                      { value: "right", label: "→" },
                    ]}
                  />
                )}
              </div>
            )}
            {caps.brightness && (
              <div className="dev-hw__bright">
                <Slider
                  label={t("devices.page.hardwareBrightness")}
                  value={hwBrightness}
                  min={0}
                  max={100}
                  unit="%"
                  disabled={safeMode}
                  onChange={setHwBrightness}
                  onCommit={(v) => void run("bright", () => setBrightness(device.uid, v / 100))}
                />
              </div>
            )}
          </div>
        )}

        <footer className="dev-card__actions">
          {caps.onboardMemory && (
            <Button
              size="sm"
              icon={<HardDriveDownload />}
              disabled={!!busy || safeMode}
              title={t("devices.page.saveOnboardHint")}
              onClick={() => {
                const effect = activeProfile?.onboard?.[def.id] ?? (hwMode ? fx : undefined);
                if (!effect) {
                  toast(t("devices.page.saveOnboardPick"));
                  return;
                }
                void run("onboard", () => saveToOnboard(device.uid, effect), t("devices.page.savedOnboard"));
              }}
            >
              {t("devices.page.saveOnboard")}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!!busy} onClick={() => setConfirmRestore(true)}>
            {t("devices.snapshot.restore")}
          </Button>
          <span className="grow" />
          <Button size="sm" variant="ghost" icon={<ThumbsUp />} onClick={() => void backend.openPath(deviceReportUrl(device))}>
            {t("devices.page.worksForMe")}
          </Button>
        </footer>
      </div>

      <Modal
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        title={t("devices.snapshot.restore")}
        footer={
          <>
            <Button onClick={() => setConfirmRestore(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              icon={<Undo2 />}
              onClick={() => {
                setConfirmRestore(false);
                void run("restore", () => restoreSnapshot(device.uid), t("devices.snapshot.restored"));
              }}
            >
              {t("devices.page.restoreConfirm")}
            </Button>
          </>
        }
      >
        <p className="dev-modal-text">{t("devices.page.restoreText", { name: def.name })}</p>
      </Modal>
    </article>
  );
}

function normalise(e?: HardwareEffect): HardwareEffect {
  if (!e || e.type === "custom") return { type: "static", colors: [[0, 255, 170] as RGB], speed: 2, direction: "right" };
  return { speed: 2, direction: "right", ...e, colors: e.colors?.length ? e.colors : [[0, 255, 170]] };
}
