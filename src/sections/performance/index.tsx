import { useState } from "react";
import { MousePointer2 } from "lucide-react";
import { useDevices } from "@/core/devices";
import { Badge, Card, EmptyState, Page, Select } from "@/ui";
import { useT } from "@/i18n";
import { navigate } from "@/app/router";
import { DpiCard } from "./DpiCard";
import { SensitivityCard } from "./SensitivityCard";
import { BatteryCard, LightingCard, PointerCard, ResponseCard } from "./cards";
import "./performance.css";

/** Performance: mouse sensor, polling, battery, Windows pointer and sensitivity tools. */
export default function PerformancePage() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const live = useDevices((s) => s.live);
  const mice = devices.filter((d) => d.definition.type === "mouse");
  const [picked, setPicked] = useState<string | undefined>();
  const mouse = mice.find((m) => m.uid === picked) ?? mice[0];
  const caps = mouse?.definition.capabilities;
  const state = mouse ? live[mouse.uid] : undefined;
  const activeDpi = state?.mouse?.dpiStages[state.mouse.activeStage]?.x ?? state?.dpi?.x;

  const header = mouse && (
    <div className="row perf-devpick">
      {mice.length > 1 ? (
        <Select value={mouse.uid} onChange={setPicked} options={mice.map((m) => ({ value: m.uid, label: m.definition.name }))} aria-label={t("performance.device")} />
      ) : (
        <span className="perf-devname">
          <MousePointer2 />
          {mouse.definition.name}
        </span>
      )}
      {mouse.firmware && <span className="subtle perf-small mono">FW {mouse.firmware}</span>}
      <Badge tone={mouse.online && !mouse.error ? "success" : "warning"} dot>
        {mouse.online && !mouse.error ? t("common.connected") : t("performance.unreachable")}
      </Badge>
    </div>
  );

  return (
    <Page title={t("nav.performance")} description={t("performance.description")} actions={header}>
      {!mouse ? (
        <Card>
          <EmptyState
            icon={<MousePointer2 />}
            title={t("performance.noMouse.title")}
            action={
              <a
                href="#/devices"
                className="kh-btn"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("devices");
                }}
              >
                {t("performance.noMouse.action")}
              </a>
            }
          >
            {t("performance.noMouse.body")}
          </EmptyState>
        </Card>
      ) : (
        <>
          {mouse.error && <div className="perf-callout perf-callout--warn">{mouse.error}</div>}
          <div className="perf-row perf-row--a">
            {caps?.dpi && <DpiCard device={mouse} />}
            {(!!caps?.pollingRates?.length || !!caps?.dpi) && <ResponseCard device={mouse} />}
          </div>
          <div className="perf-row perf-row--b">
            {caps?.battery && <BatteryCard device={mouse} />}
            {(!!caps?.brightness || !!mouse.definition.leds?.length) && <LightingCard device={mouse} />}
            <PointerCard dpi={activeDpi} />
          </div>
        </>
      )}
      {!mouse && <PointerCard />}
      <SensitivityCard device={mouse} />
    </Page>
  );
}
