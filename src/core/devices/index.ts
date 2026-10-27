/**
 * Public API of the devices feature (see README.md in this folder).
 */
export { useDevices, primaryKeyboard, primaryMouse, layoutOf } from "./store";
export type { DevicesState, DeviceLiveState } from "./store";
export { TEMPLATES, getTemplate, applyLocale, LOCALE_OVERLAYS, ANSI_60, ISO_60, ANSI_65, ANSI_75, ANSI_TKL, ISO_TKL, ANSI_100, ISO_100 } from "./templates";
export { getHandle, getDevice, setDpi, cycleDpi, sniper, setSoftwareMode, scan } from "./manager";
export {
  listUnknownHidDevices,
  findRazerInterface,
  probeRazer,
  lightMatrixCell,
  lightLed,
  releaseLed,
  buildDefinitionFromMapping,
} from "./wizard";
export type { UnknownHidDevice, MappingInput } from "./wizard";
export type { DeviceHandle, LedAddress, LedColor } from "./drivers/types";
export { OPENRGB_DEFAULTS } from "./drivers/openrgb";
