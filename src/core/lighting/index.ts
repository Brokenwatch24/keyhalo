/**
 * Public API of the lighting feature (see README.md in this folder).
 */
export { useLighting, DEFAULT_SCENE, newLayerId, normaliseScene } from "./store";
export type { LightingState } from "./store";
export { useLightingFrame, useEffects, flash } from "./hooks";
export { engine, VIRTUAL_KEYBOARD, VIRTUAL_MOUSE } from "./engine";
export type { FlashRequest } from "./engine";
export { effectRegistry } from "./effects/registry";
export type { RegisteredEffect } from "./effects/registry";
export { useProfiles, DEFAULT_PROFILE_ID, bundledProfiles, isProfile } from "./profiles";
export type { ProfilesState, ProfileSource } from "./profiles";
export { renderProfilePreview } from "./preview";
export { Compositor } from "./compositor";
export type { Overlay, RenderOptions } from "./compositor";
export { hsv, mix, hex, toHex, gradientAt, statusColor, statusScale, STATUS_PALETTES, blend } from "./color";
export type { StatusKind } from "./color";
export { noise2D } from "./noise";
export { resolveParams } from "./api";
export type { EffectContext, EffectInstance, EffectModule, SceneKey, KeyEventInfo, EffectHelpers } from "./api";
export { useSignals } from "./signals";
