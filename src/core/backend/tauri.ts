import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Backend, BackendEvents, HudPayload, RemapConfig, PointerSettings, MqttConnectOptions, HttpRequest } from "./api";
import type { MacroStep } from "../types";

/** Backend implementation that talks to the Rust side through Tauri commands. */
export class TauriBackend implements Backend {
  readonly kind = "tauri" as const;

  hidEnumerate(vendorIds?: number[]) {
    return invoke<Awaited<ReturnType<Backend["hidEnumerate"]>>>("hid_enumerate", { vendorIds: vendorIds ?? null });
  }
  hidSendFeature(path: string, data: number[]) {
    return invoke<void>("hid_send_feature", { path, data });
  }
  hidGetFeature(path: string, reportId: number, length: number) {
    return invoke<number[]>("hid_get_feature", { path, reportId, length });
  }
  hidWrite(path: string, data: number[]) {
    return invoke<void>("hid_write", { path, data });
  }
  hidRead(path: string, length: number, timeoutMs: number) {
    return invoke<number[]>("hid_read", { path, length, timeoutMs });
  }
  hidClose(path: string) {
    return invoke<void>("hid_close", { path });
  }

  lampArrayList() {
    return invoke<Awaited<ReturnType<Backend["lampArrayList"]>>>("lamparray_list");
  }
  lampArraySetColors(id: string, colors: number[][]) {
    return invoke<void>("lamparray_set_colors", { id, colors });
  }

  tcpConnect(host: string, port: number) {
    return invoke<string>("tcp_connect", { host, port });
  }
  tcpSend(id: string, data: number[]) {
    return invoke<void>("tcp_send", { id, data });
  }
  tcpRecv(id: string, length: number, timeoutMs: number) {
    return invoke<number[]>("tcp_recv", { id, length, timeoutMs });
  }
  tcpClose(id: string) {
    return invoke<void>("tcp_close", { id });
  }

  mqttConnect(options: MqttConnectOptions) {
    return invoke<void>("mqtt_connect", { options });
  }
  mqttSubscribe(id: string, topic: string) {
    return invoke<void>("mqtt_subscribe", { id, topic });
  }
  mqttPublish(id: string, topic: string, payload: string, retain = false) {
    return invoke<void>("mqtt_publish", { id, topic, payload, retain });
  }
  mqttDisconnect(id: string) {
    return invoke<void>("mqtt_disconnect", { id });
  }

  httpRequest(request: HttpRequest) {
    return invoke<Awaited<ReturnType<Backend["httpRequest"]>>>("http_request", { request });
  }

  foregroundApp() {
    return invoke<Awaited<ReturnType<Backend["foregroundApp"]>>>("system_foreground");
  }
  processes() {
    return invoke<string[]>("system_processes");
  }
  windows() {
    return invoke<Awaited<ReturnType<Backend["windows"]>>>("system_windows");
  }
  systemMetrics() {
    return invoke<Awaited<ReturnType<Backend["systemMetrics"]>>>("system_metrics");
  }
  pointerGet() {
    return invoke<PointerSettings>("system_pointer_get");
  }
  pointerSet(settings: PointerSettings) {
    return invoke<void>("system_pointer_set", { settings });
  }
  micMuted() {
    return invoke<boolean>("system_mic_muted");
  }
  setMicMuted(muted: boolean) {
    return invoke<void>("system_set_mic_muted", { muted });
  }
  openPath(path: string) {
    return invoke<void>("system_open_path", { path });
  }
  findSteamGame(folder: string) {
    return invoke<string | null>("system_find_steam_game", { folder });
  }
  writeFile(path: string, contents: string) {
    return invoke<void>("system_write_file", { path, contents });
  }

  inputSetListening(enabled: boolean) {
    return invoke<void>("input_set_listening", { enabled });
  }
  remapConfigure(config: RemapConfig) {
    return invoke<void>("remap_configure", { config });
  }
  inputSend(steps: MacroStep[]) {
    return invoke<void>("input_send", { steps });
  }

  audioSetListening(enabled: boolean) {
    return invoke<void>("audio_set_listening", { enabled });
  }

  apiConfigure(enabled: boolean, port: number, token: string) {
    return invoke<void>("api_configure", { enabled, port, token });
  }
  apiSetState(state: unknown) {
    return invoke<void>("api_set_state", { state });
  }

  storageRead(name: string) {
    return invoke<string | null>("storage_read", { name });
  }
  storageWrite(name: string, contents: string) {
    return invoke<void>("storage_write", { name, contents });
  }
  storageList(dir: string) {
    return invoke<string[]>("storage_list", { dir });
  }
  storageDelete(name: string) {
    return invoke<void>("storage_delete", { name });
  }

  traySetProfiles(profiles: { id: string; name: string; active: boolean }[]) {
    return invoke<void>("tray_set_profiles", { profiles });
  }
  hudShow(payload: HudPayload) {
    return invoke<void>("hud_show", { payload });
  }
  appVersion() {
    return invoke<string>("app_version");
  }

  async on<E extends keyof BackendEvents>(event: E, handler: (payload: BackendEvents[E]) => void) {
    return listen<BackendEvents[E]>(event, (e) => handler(e.payload));
  }
}
