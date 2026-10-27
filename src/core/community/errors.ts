import { t } from "@/i18n";

/**
 * Error codes surfaced to the UI. Each maps to `community.errors.<code>` in
 * src/i18n/{en,es}/community.json, so the UI can show a friendly, translated message.
 */
export type CommunityErrorCode =
  | "network"
  | "offline"
  | "rateLimited"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "invalidContent"
  | "tooLarge"
  | "unknownKind"
  | "needsConfirmation"
  | "notSignedIn"
  | "noClientId"
  | "deviceFlowUnavailable"
  | "authExpired"
  | "authDenied"
  | "authCancelled"
  | "forkTimeout"
  | "conflict"
  | "invalidInput"
  | "github";

export class CommunityError extends Error {
  readonly code: CommunityErrorCode;
  /** Extra values interpolated into the translated message (e.g. { minutes: 12 }). */
  readonly vars: Record<string, string | number>;
  /** Details for logs / "show details" (HTTP status, validation problems…). */
  readonly details?: string[];

  constructor(code: CommunityErrorCode, opts: { vars?: Record<string, string | number>; details?: string[]; cause?: unknown; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = "CommunityError";
    this.code = code;
    this.vars = opts.vars ?? {};
    this.details = opts.details;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export function isCommunityError(e: unknown): e is CommunityError {
  return e instanceof CommunityError;
}

/** Friendly, translated message for any error thrown by the community services. */
export function communityErrorMessage(e: unknown): string {
  if (isCommunityError(e)) return t(`community.errors.${e.code}`, e.vars);
  if (e instanceof Error && e.message) return t("community.errors.unexpected", { message: e.message });
  return t("community.errors.unexpected", { message: String(e) });
}
