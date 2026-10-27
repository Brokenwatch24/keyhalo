import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  LayoutDashboard,
  Keyboard,
  Sparkles,
  MousePointer2,
  Command,
  Type,
  FlaskConical,
  Workflow,
  Plug,
  Users,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export interface SectionDef {
  id: string;
  /** i18n key under the "nav" namespace. */
  labelKey: string;
  icon: LucideIcon;
  group: "overview" | "customize" | "practice" | "connect" | "system";
  component: LazyExoticComponent<ComponentType>;
}

/** Each section lives in src/sections/<id>/index.tsx and default-exports its page. */
export const SECTIONS: SectionDef[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, group: "overview", component: lazy(() => import("./dashboard")) },
  { id: "devices", labelKey: "nav.devices", icon: Keyboard, group: "overview", component: lazy(() => import("./devices")) },
  { id: "lighting", labelKey: "nav.lighting", icon: Sparkles, group: "customize", component: lazy(() => import("./lighting")) },
  { id: "performance", labelKey: "nav.performance", icon: MousePointer2, group: "customize", component: lazy(() => import("./performance")) },
  { id: "keymaps", labelKey: "nav.keymaps", icon: Command, group: "customize", component: lazy(() => import("./keymaps")) },
  { id: "typing", labelKey: "nav.typing", icon: Type, group: "practice", component: lazy(() => import("./typing")) },
  { id: "testbench", labelKey: "nav.testbench", icon: FlaskConical, group: "practice", component: lazy(() => import("./testbench")) },
  { id: "automations", labelKey: "nav.automations", icon: Workflow, group: "connect", component: lazy(() => import("./automations")) },
  { id: "integrations", labelKey: "nav.integrations", icon: Plug, group: "connect", component: lazy(() => import("./integrations")) },
  { id: "community", labelKey: "nav.community", icon: Users, group: "connect", component: lazy(() => import("./community")) },
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon, group: "system", component: lazy(() => import("./settings")) },
];
