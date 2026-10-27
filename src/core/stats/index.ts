/** Public API of the stats feature (see README.md). */
export { useStats, type StatsState, type LifetimeStats, type BatterySample, type LiveSample } from "./store";
export { acquireInputListening, useInputListening, inputListeners } from "./input";
export { dayKey, emptyStats, isPrintableCode, pixelsToMeters, pointerMultiplier, RollingRate } from "./metrics";
