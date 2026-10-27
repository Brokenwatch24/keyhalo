/**
 * Prefilled GitHub issue links: "Works on my device" reports and support requests for
 * unrecognised hardware. Field names match the issue forms in .github/ISSUE_TEMPLATE.
 */
import type { ConnectedDevice } from "../types";
import type { HidDeviceInfo } from "../backend/api";
import { ISSUE_TEMPLATES, REPO_URL } from "./constants";

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

function issueUrl(template: string, fields: Record<string, string | undefined>): string {
  const params = new URLSearchParams({ template });
  for (const [k, v] of Object.entries(fields)) if (v) params.set(k, v);
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

let cachedAppVersion: string | undefined;
/** Set once at startup (init.ts) so report links include the app version. */
export function setReportAppVersion(v: string | undefined) {
  cachedAppVersion = v;
}

/** Prefilled "Works on my device" issue for a connected, recognised device. */
export function deviceReportUrl(device: ConnectedDevice, appVersion = cachedAppVersion): string {
  const def = device.definition;
  const layout = device.layoutId ?? def.defaultLayout;
  const layoutName = layout ? def.layouts?.[layout]?.name : undefined;
  const ids = def.match.map((m) => `${m.vendorId.replace(/^0x/i, "")}:${m.productId.replace(/^0x/i, "")}`).join(", ");
  return issueUrl(ISSUE_TEMPLATES.worksOnMyDevice, {
    title: `[Works] ${def.name}${device.firmware ? ` (fw ${device.firmware})` : ""}`,
    definition: def.id,
    device: `${def.name} (${ids})`,
    firmware: device.firmware,
    layout: layout ? `${layout}${layoutName && layoutName !== layout ? ` — ${layoutName}` : ""}` : undefined,
    "app-version": appVersion,
    notes: [`Driver: ${def.driver}`, `Definition status: ${def.status}`, device.error ? `Last error: ${device.error}` : ""].filter(Boolean).join("\n"),
  });
}

/** Prefilled "Device support request" issue for hardware KeyHalo doesn't recognise. */
export function deviceRequestUrl(hid: HidDeviceInfo | HidDeviceInfo[], appVersion = cachedAppVersion): string {
  const list = Array.isArray(hid) ? hid : [hid];
  const first = list[0];
  const model = [first?.manufacturer, first?.product].filter(Boolean).join(" ") || "Unknown device";
  const vidPid = first ? `${hex4(first.vendorId)}:${hex4(first.productId)}` : "";
  const interfaces = list
    .map((h) => `- interface ${h.interfaceNumber} · usagePage 0x${h.usagePage.toString(16).padStart(4, "0")} · usage 0x${h.usage.toString(16).padStart(2, "0")}${h.product ? ` · ${h.product}` : ""}`)
    .join("\n");
  return issueUrl(ISSUE_TEMPLATES.deviceRequest, {
    title: `[Device] ${model} (${vidPid})`,
    model,
    "vid-pid": vidPid,
    interfaces,
    "app-version": appVersion,
  });
}
