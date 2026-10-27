import { useCallback, useEffect, useState } from "react";
import { Cable, CircleHelp, LifeBuoy, Plus, RefreshCw, ScanSearch, ShieldAlert, Usb, Wand2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Page, Toggle } from "@/ui";
import { useT } from "@/i18n";
import { useRoute, navigate } from "@/app/router";
import { backend, isTauri } from "@/core/backend";
import { useDevices, listUnknownHidDevices, OPENRGB_DEFAULTS, type UnknownHidDevice } from "@/core/devices";
import { deviceRequestUrl } from "@/core/community";
import { useSettings } from "@/core/state/settings";
import { DeviceCard } from "./DeviceCard";
import { DeskArrangement } from "./DeskArrangement";
import { Wizard } from "./Wizard";
import "./devices.css";

export default function DevicesSection() {
  const route = useRoute();
  if (route[1] === "wizard") return <Wizard preselect={route[2]} />;
  return <DevicesPage />;
}

function DevicesPage() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const scanning = useDevices((s) => s.scanning);
  const scan = useDevices((s) => s.scan);
  const safeMode = useSettings((s) => s.settings.safeMode);
  const [unknown, setUnknown] = useState<UnknownHidDevice[] | null>(null);

  const refreshUnknown = useCallback(() => {
    listUnknownHidDevices()
      .then(setUnknown)
      .catch(() => setUnknown([]));
  }, []);
  useEffect(() => refreshUnknown(), [refreshUnknown, devices.length]);

  return (
    <Page
      title={t("devices.page.title")}
      description={t("devices.page.subtitle")}
      actions={
        <>
          <Button icon={<RefreshCw className={scanning ? "dev-spin" : undefined} />} disabled={scanning} onClick={() => void scan().finally(refreshUnknown)}>
            {t("devices.page.rescan")}
          </Button>
          <Button variant="primary" icon={<Plus />} onClick={() => navigate("devices/wizard")}>
            {t("devices.page.addDevice")}
          </Button>
        </>
      }
    >
      {safeMode && (
        <div className="dev-banner">
          <ShieldAlert />
          <span>{t("devices.errors.safeMode")}</span>
        </div>
      )}

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Usb />}
            title={t("devices.page.noneTitle")}
            action={
              <Button icon={<Wand2 />} onClick={() => navigate("devices/wizard")}>
                {t("devices.page.addDevice")}
              </Button>
            }
          >
            {t("devices.page.noneText")}
          </EmptyState>
        </Card>
      ) : (
        <div className="dev-list">
          {devices.map((d) => (
            <DeviceCard key={d.uid} device={d} />
          ))}
        </div>
      )}

      <div className="dev-grid">
        <DeskArrangement />
        <div className="dev-stack">
          <UnknownDevices unknown={unknown} />
          <Bridges />
        </div>
      </div>
    </Page>
  );
}

function UnknownDevices({ unknown }: { unknown: UnknownHidDevice[] | null }) {
  const t = useT();
  return (
    <Card title={t("devices.wizard.unknownDevices")} subtitle={t("devices.page.unknownHint")} flush>
      {unknown === null ? (
        <div className="dev-unknown__empty subtle">{t("common.loading")}</div>
      ) : unknown.length === 0 ? (
        <div className="dev-unknown__empty">
          <ScanSearch />
          <span>{t("devices.page.unknownNone")}</span>
        </div>
      ) : (
        <div className="kh-list">
          {unknown.map((u) => (
            <div key={u.id} className="kh-list__row">
              <div className="dev-unknown__icon">
                <Usb />
              </div>
              <div className="grow">
                <div className="dev-unknown__name">{u.product ?? t("devices.page.unnamed")}</div>
                <div className="dev-unknown__meta mono">
                  {u.id} · {u.manufacturer ?? "?"} · {t("devices.page.interfaces", { n: u.interfaces.length })}
                </div>
              </div>
              <Button size="sm" icon={<Wand2 />} onClick={() => navigate(`devices/wizard/${encodeURIComponent(u.id)}`)}>
                {t("devices.page.addWithWizard")}
              </Button>
              <Button size="sm" variant="ghost" icon={<LifeBuoy />} onClick={() => void backend.openPath(deviceRequestUrl(u.interfaces))}>
                {t("devices.page.requestSupport")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Bridges() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const scan = useDevices((s) => s.scan);
  const openrgb = useSettings((s) => s.settings.openrgb) ?? OPENRGB_DEFAULTS;
  const update = useSettings((s) => s.update);
  const [lamps, setLamps] = useState<{ total: number } | null | "error">(null);
  useEffect(() => {
    backend
      .lampArrayList()
      .then((l) => setLamps({ total: l.length }))
      .catch(() => setLamps("error"));
  }, [devices.length]);
  const lampDevices = devices.filter((d) => d.definition.driver === "lamparray").length;
  const orgbDevices = devices.filter((d) => d.definition.driver === "openrgb").length;
  const setOrgb = (patch: Partial<typeof openrgb>) => {
    update({ openrgb: { ...openrgb, ...patch } });
    void scan();
  };

  return (
    <Card title={t("devices.page.bridges")} flush>
      <div className="kh-list">
        <div className="kh-list__row dev-bridge">
          <div className="dev-unknown__icon">
            <Cable />
          </div>
          <div className="grow">
            <div className="dev-unknown__name">{t("devices.drivers.lamparray")}</div>
            <div className="dev-unknown__meta">
              {!isTauri
                ? t("devices.page.desktopOnly")
                : lamps === "error"
                  ? t("devices.page.lampUnavailable")
                  : lamps === null
                    ? t("common.loading")
                    : t("devices.page.lampCount", { n: lamps.total, used: lampDevices })}
            </div>
          </div>
          {lamps !== null && lamps !== "error" && lamps.total > 0 ? (
            <Badge tone="success" dot>
              {t("common.connected")}
            </Badge>
          ) : (
            <Badge>{t("devices.page.none")}</Badge>
          )}
        </div>
        <div className="kh-list__row dev-bridge">
          <div className="dev-unknown__icon">
            <Cable />
          </div>
          <div className="grow">
            <div className="dev-unknown__name">{t("devices.openrgb.title")}</div>
            <div className="dev-unknown__meta">{t("devices.openrgb.description")}</div>
            {openrgb.enabled && (
              <div className="dev-bridge__fields">
                <Input aria-label={t("devices.openrgb.host")} value={openrgb.host} onChange={(e) => update({ openrgb: { ...openrgb, host: e.target.value } })} onBlur={() => void scan()} />
                <Input
                  aria-label={t("devices.openrgb.port")}
                  type="number"
                  value={openrgb.port}
                  onChange={(e) => update({ openrgb: { ...openrgb, port: Number(e.target.value) || OPENRGB_DEFAULTS.port } })}
                  onBlur={() => void scan()}
                />
                <span className="dev-unknown__meta">{t("devices.page.orgbCount", { n: orgbDevices })}</span>
              </div>
            )}
          </div>
          <Toggle checked={openrgb.enabled} onChange={(v) => setOrgb({ enabled: v })} />
        </div>
        <div className="kh-list__row dev-bridge dev-bridge--note">
          <CircleHelp />
          <span>{t("devices.page.bridgesNote")}</span>
        </div>
      </div>
    </Card>
  );
}
