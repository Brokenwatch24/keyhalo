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
  claudeHooks(action: "status" | "install" | "remove", port: number, token?: string) {
    return invoke<Awaited<ReturnType<Backend["claudeHooks"]>>>("claude_hooks", { action, port, token: token || null });
  }
  focusWindow(pid: number, title: string) {
    return invoke<boolean>("system_focus_window", { pid, title });
  }
  focusHwnd(hwnd: number) {
    return invoke<boolean>("system_focus_hwnd", { hwnd });
  }
  explorerFolder(hwnd: number) {
    return invoke<string | null>("system_explorer_folder", { hwnd });
  }
  tabs(hwnd: number) {
    return invoke<Awaited<ReturnType<Backend["tabs"]>>>("system_tabs", { hwnd });
  }
  tabSelect(hwnd: number, index: number) {
    return invoke<boolean>("system_tab_select", { hwnd, index });
  }
  windowCmd(hwnd: number, action: "minimize" | "maximize" | "restore" | "close") {
    return invoke<boolean>("system_window_cmd", { hwnd, action });
  }
  tile(hwnds: number[]) {
    return invoke<number>("system_tile", { hwnds });
  }
  agentsEnd(pid: number) {
    return invoke<boolean>("agents_end", { pid });
  }
  agentsTitle(transcript: string) {
    return invoke<string | null>("agents_title", { transcript });
  }
  agentsRecent(limit?: number) {
    return invoke<Awaited<ReturnType<Backend["agentsRecent"]>>>("agents_recent", { limit: limit ?? null });
  }
  promptOpen(payload: { id: string; title: string; value?: string; placeholder?: string; hint?: string }) {
    return invoke<void>("prompt_open", { payload });
  }
  agentsLive() {
    return invoke<Awaited<ReturnType<Backend["agentsLive"]>>>("agents_live");
  }
  codexNotify(action: "status" | "install" | "remove", port: number, token?: string) {
    return invoke<Awaited<ReturnType<Backend["codexNotify"]>>>("codex_notify", { action, port, token: token || null });
  }
  audioApps() {
    return invoke<Awaited<ReturnType<Backend["audioApps"]>>>("audio_apps");
  }
  audioAppSet(process: string, volume?: number, muted?: boolean) {
    return invoke<void>("audio_app_set", { process, volume: volume ?? null, muted: muted ?? null });
  }
  mediaState() {
    return invoke<Awaited<ReturnType<Backend["mediaState"]>>>("media_state");
  }
  mediaCommand(command: "playPause" | "next" | "prev") {
    return invoke<boolean>("media_command", { command });
  }
  launch(path: string, args?: string[]) {
    return invoke<void>("input_launch", { path, args: args ?? null });
  }
  midiList() {
    return invoke<Awaited<ReturnType<Backend["midiList"]>>>("midi_list");
  }
  midiOpen(name: string) {
    return invoke<void>("midi_open", { name });
  }
  midiClose(name: string) {
    return invoke<void>("midi_close", { name });
  }
  midiSend(name: string, messages: number[][]) {
    return invoke<void>("midi_send", { name, messages });
  }
  padmapSet(visible: boolean, payload?: unknown) {
    return invoke<void>("padmap_set", { visible, payload: payload ?? null });
  }
  notifications() {
    return invoke<Awaited<ReturnType<Backend["notifications"]>>>("system_notifications");
  }
  notificationsAccess(request = false) {
    return invoke<Awaited<ReturnType<Backend["notificationsAccess"]>>>("system_notifications_access", { request });
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
  appSetCloseToTray(enabled: boolean) {
    return invoke<void>("app_set_close_to_tray", { enabled });
  }

  async on<E extends keyof BackendEvents>(event: E, handler: (payload: BackendEvents[E]) => void) {
    return listen<BackendEvents[E]>(event, (e) => handler(e.payload));
  }
}
