import { Activity, Crosshair, Keyboard, MousePointerClick, Ruler, Timer } from "lucide-react";
import { Page, Tabs } from "@/ui";
import { useT } from "@/i18n";
import { navigate, useRoute } from "@/app/router";
import { PollingTest } from "./PollingTest";
import { ClickTest } from "./ClickTest";
import { KeyTest } from "./KeyTest";
import { SensorTest } from "./SensorTest";
import { DpiCalibration } from "./DpiCalibration";
import { ReactionTest } from "./ReactionTest";
import "./testbench.css";

const TABS = ["polling", "clicks", "keys", "sensor", "dpi", "reaction"] as const;
type TabId = (typeof TABS)[number];

/** Test bench ("dyno"): self-contained input tests. The active tab lives in the route: #/testbench/<tab>. */
export default function TestBench() {
  const t = useT();
  const route = useRoute();
  const tab: TabId = (TABS as readonly string[]).includes(route[1]) ? (route[1] as TabId) : "polling";

  return (
    <Page title={t("nav.testbench")} description={t("testbench.description")}>
      <Tabs
        value={tab}
        onChange={(v) => navigate(`testbench/${v}`)}
        tabs={[
          { value: "polling", label: t("testbench.tabs.polling"), icon: <Activity size={15} /> },
          { value: "clicks", label: t("testbench.tabs.clicks"), icon: <MousePointerClick size={15} /> },
          { value: "keys", label: t("testbench.tabs.keys"), icon: <Keyboard size={15} /> },
          { value: "sensor", label: t("testbench.tabs.sensor"), icon: <Crosshair size={15} /> },
          { value: "dpi", label: t("testbench.tabs.dpi"), icon: <Ruler size={15} /> },
          { value: "reaction", label: t("testbench.tabs.reaction"), icon: <Timer size={15} /> },
        ]}
      />
      {/* Keyed so switching tabs unmounts the previous test and removes its listeners. */}
      <div className="tb-body" key={tab}>
        {tab === "polling" && <PollingTest />}
        {tab === "clicks" && <ClickTest />}
        {tab === "keys" && <KeyTest />}
        {tab === "sensor" && <SensorTest />}
        {tab === "dpi" && <DpiCalibration />}
        {tab === "reaction" && <ReactionTest />}
      </div>
    </Page>
  );
}
