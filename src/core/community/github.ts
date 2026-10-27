/**
 * Minimal GitHub client used by the community features. Every request goes through
 * `backend.httpRequest` (no CORS limits in the desktop app; plain fetch in the browser demo).
 */
import { backend, type HttpResponse } from "@/core/backend";
import { API_BASE, GITHUB_SCOPES } from "./constants";
import { CommunityError } from "./errors";

export interface GitHubUser {
  login: string;
  name?: string | null;
  avatar_url?: string;
  html_url?: string;
}

export interface DeviceCodeInfo {
  deviceCode: string;
  /** Code the user types at `verificationUri` (e.g. "WDJB-MJHT"). */
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  /** Polling interval in seconds. */
  interval: number;
}

type Json = Record<string, unknown>;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new CommunityError("authCancelled"));
    });
  });

/** Low-level HTTP with network errors mapped to CommunityError("network"). */
export async function http(method: string, url: string, opts: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<HttpResponse> {
  try {
    return await backend.httpRequest({ method, url, headers: opts.headers, body: opts.body, timeoutMs: opts.timeoutMs ?? 20_000 });
  } catch (e) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new CommunityError(offline ? "offline" : "network", { cause: e, details: [String(e)] });
  }
}

const header = (res: HttpResponse, name: string) => {
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name);
  return key ? res.headers[key] : undefined;
};

/** Convert a failed GitHub response into a friendly CommunityError. */
export function errorFromResponse(res: HttpResponse): CommunityError {
  let message = "";
  try {
    message = String((JSON.parse(res.body) as Json).message ?? "");
  } catch {
    /* not JSON */
  }
  const remaining = header(res, "x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && (remaining === "0" || /rate limit/i.test(message))) {
    const reset = Number(header(res, "x-ratelimit-reset") ?? 0) * 1000;
    const minutes = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60_000)) : 60;
    return new CommunityError("rateLimited", { vars: { minutes }, details: [message] });
  }
  const details = [`HTTP ${res.status}`, message].filter(Boolean);
  if (res.status === 401) return new CommunityError("unauthorized", { details });
  if (res.status === 403) return new CommunityError("forbidden", { details });
  if (res.status === 404) return new CommunityError("notFound", { details });
  if (res.status === 409 || res.status === 422) return new CommunityError("conflict", { vars: { message }, details });
  return new CommunityError("github", { vars: { status: res.status, message: message || `HTTP ${res.status}` }, details });
}

export class GitHubClient {
  constructor(private token?: string) {}

  /** JSON request against api.github.com (path) or an absolute URL. */
  async request<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "KeyHalo",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await http(method, url, { headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status < 200 || res.status >= 300) throw errorFromResponse(res);
    if (!res.body) return undefined as T;
    try {
      return JSON.parse(res.body) as T;
    } catch {
      return res.body as T;
    }
  }

  /** Like request() but resolves null on 404. */
  async maybe<T = Json>(method: string, path: string, body?: unknown): Promise<T | null> {
    try {
      return await this.request<T>(method, path, body);
    } catch (e) {
      if (e instanceof CommunityError && e.code === "notFound") return null;
      throw e;
    }
  }

  user() {
    return this.request<GitHubUser>("GET", "/user");
  }
}

// ---------------------------------------------------------------------------
// OAuth device flow (https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
// ---------------------------------------------------------------------------

const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const FORM_HEADERS = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "KeyHalo" };

export async function startDeviceFlow(clientId: string): Promise<DeviceCodeInfo> {
  let res: HttpResponse;
  try {
    res = await http("POST", "https://github.com/login/device/code", { headers: FORM_HEADERS, body: form({ client_id: clientId, scope: GITHUB_SCOPES }) });
  } catch (e) {
    // In the browser demo github.com/login has no CORS headers, so fetch fails.
    if (backend.kind === "mock") throw new CommunityError("deviceFlowUnavailable", { cause: e });
    throw e;
  }
  if (res.status !== 200) throw errorFromResponse(res);
  const j = JSON.parse(res.body) as Json;
  if (j.error) throw new CommunityError(j.error === "device_flow_disabled" || j.error === "unauthorized_client" ? "noClientId" : "github", { vars: { status: res.status, message: String(j.error_description ?? j.error) } });
  return {
    deviceCode: String(j.device_code),
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri ?? "https://github.com/login/device"),
    expiresAt: Date.now() + Number(j.expires_in ?? 900) * 1000,
    interval: Number(j.interval ?? 5),
  };
}

/** Poll until the user authorises (returns the access token), denies, or the code expires. */
export async function pollDeviceFlow(clientId: string, info: DeviceCodeInfo, signal?: AbortSignal): Promise<string> {
  let interval = info.interval;
  while (Date.now() < info.expiresAt) {
    await sleep(interval * 1000, signal);
    if (signal?.aborted) throw new CommunityError("authCancelled");
    const res = await http("POST", "https://github.com/login/oauth/access_token", {
      headers: FORM_HEADERS,
      body: form({ client_id: clientId, device_code: info.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    let j: Json = {};
    try {
      j = JSON.parse(res.body) as Json;
    } catch {
      /* keep polling */
    }
    if (typeof j.access_token === "string") return j.access_token;
    switch (j.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval = Number(j.interval ?? interval + 5);
        break;
      case "expired_token":
        throw new CommunityError("authExpired");
      case "access_denied":
        throw new CommunityError("authDenied");
      case undefined:
        if (res.status >= 400) throw errorFromResponse(res);
        break;
      default:
        throw new CommunityError("github", { vars: { status: res.status, message: String(j.error_description ?? j.error) } });
    }
  }
  throw new CommunityError("authExpired");
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** UTF-8 safe base64 (GitHub contents API). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
