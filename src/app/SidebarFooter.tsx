import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { useT } from "@/i18n";
import { useDevices } from "@/core/devices";
import { useProfiles, useSignals } from "@/core/lighting";
import type { ConnectedDevice } from "@/core/types";
import { installUpdate, useUpdates } from "@/core/updates";
import { navigate } from "./router";
import { BatteryIcon, DeviceIcon } from "@/sections/dashboard/shared";
import "./sidebar-footer.css";

/** Sidebar footer: active profile switcher and connected-device status. */
export function SidebarFooter() {
  const devices = useDevices((s) => s.devices);
  return (
    <div className="kh-sf">
      <UpdateReady />
      <ProfileSwitcher />
      {devices.length > 0 && (
        <div className="kh-sf__devices">
          {devices.slice(0, 4).map((d) => (
            <DeviceDot key={d.uid} device={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One-click restart once a downloaded update is ready. */
function UpdateReady() {
  const t = useT();
  const status = useUpdates((s) => s.status);
  const version = useUpdates((s) => s.version);
  if (status !== "ready" && status !== "installing") return null;
  return (
    <button type="button" className="kh-sf__update" disabled={status === "installing"} onClick={() => void installUpdate()} title={t("settings.general.ready", { version: version ?? "" })}>
      <RefreshCw size={14} className={status === "installing" ? "settings-spin" : undefined} />
      <span className="kh-sf__text">{t("settings.general.restartToUpdate")}</span>
    </button>
  );
}

/** A swatch made from the first colours of the profile's base layer (for the collapsed sidebar). */
function swatch(params: Record<string, unknown> | undefined): string {
  const colors = Object.values(params ?? {}).flatMap((v) =>
    typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? [v] : Array.isArray(v) ? v.filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) : [],
  ) as string[];
  if (colors.length >= 2) return `linear-gradient(135deg, ${colors.slice(0, 3).join(", ")})`;
  if (colors.length === 1) return colors[0];
  return "conic-gradient(from 200deg, #ff5f6d, #ffc371, #47e891, #3fa7ff, #b06bff, #ff5f6d)";
}

function ProfileSwitcher() {
  const t = useT();
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeId);
  const apply = useProfiles((s) => s.apply);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = profiles.find((p) => p.id === activeId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (profiles.length === 0) return null;

  return (
    <div className="kh-sf__profile" ref={ref}>
      <button type="button" className="kh-sf__trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={t("dashboard.sidebar.switchProfile")}>
        <span className="kh-sf__swatch" style={{ background: swatch(active?.lighting.layers[0]?.params) }} />
        <span className="kh-sf__text">
          <span className="kh-sf__label">{t("dashboard.sidebar.profile")}</span>
          <span className="kh-sf__name">{active?.name ?? "—"}</span>
        </span>
        <ChevronsUpDown className="kh-sf__chev" />
      </button>
      {open && (
        <div className="kh-sf__menu" role="listbox" aria-label={t("dashboard.sidebar.switchProfile")}>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === activeId}
              className="kh-sf__option"
              onClick={() => {
                setOpen(false);
                void apply(p.id, "user");
              }}
            >
              <span className="kh-sf__swatch kh-sf__swatch--sm" style={{ background: swatch(p.lighting.layers[0]?.params) }} />
              <span className="grow">{p.name}</span>
              {p.id === activeId && <Check />}
            </button>
          ))}
          <div className="kh-sf__sep" />
          <button
            type="button"
            className="kh-sf__option kh-sf__option--muted"
            onClick={() => {
              setOpen(false);
              navigate("lighting");
            }}
          >
            {t("dashboard.sidebar.manageProfiles")}
          </button>
        </div>
      )}
    </div>
  );
}

function DeviceDot({ device }: { device: ConnectedDevice }) {
  const t = useT();
  const liveBattery = useDevices((s) => s.live[device.uid]?.battery);
  const signalBattery = useSignals((s) => s.battery[device.uid]);
  const battery = liveBattery ?? signalBattery;
  const low = battery && !battery.charging && battery.percent <= 15;
  const title = [device.definition.name, device.online ? t("common.connected") : t("common.disconnected"), battery ? `${Math.round(battery.percent)}%${battery.charging ? ` · ${t("devices.battery.charging")}` : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" className="kh-sf__dev" title={title} onClick={() => navigate(device.definition.type === "mouse" ? "performance" : "devices")}>
      <span className="kh-sf__devicon">
        <DeviceIcon type={device.definition.type} size={14} />
        <span className={`kh-sf__status${device.online ? "" : " kh-sf__status--off"}`} />
      </span>
      {battery && (
        <span className={`kh-sf__bat${low ? " kh-sf__bat--low" : ""}`}>
          <BatteryIcon percent={battery.percent} charging={battery.charging} size={12} />
          {Math.round(battery.percent)}%
        </span>
      )}
    </button>
  );
}
