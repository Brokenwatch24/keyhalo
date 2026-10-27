/**
 * Sharing: open a pull request against the KeyHalo repository (fork → branch → commit → PR),
 * publish/import GitHub Gists, and import from URLs or pasted content.
 */
import type { CatalogKind } from "../types";
import { REPO_NAME, REPO_OWNER, REPO, MAX_CONTENT_SIZE } from "./constants";
import { detectKind, makePreview, repoPathFor, serialize, type InstallPreview } from "./content";
import { CommunityError } from "./errors";
import { GitHubClient, fromBase64, http, errorFromResponse, toBase64 } from "./github";

export interface PublishRequest {
  kind: CatalogKind;
  /** The item: parsed JSON, or module source for effects. */
  data: unknown;
  /** Optional preview image as a data URL ("data:image/png;base64,…"). */
  previewDataUrl?: string;
  /** Devices it was tested on (shown in the PR body), e.g. ["Razer Huntsman Mini (fw 1.12)"]. */
  testedOn?: string[];
  /** Free text from the author for the PR description. */
  notes?: string;
  appVersion?: string;
  /** Progress callback for the UI ("fork", "branch", "commit", "pr"). */
  onProgress?: (step: PublishStep) => void;
}

export type PublishStep = "fork" | "branch" | "commit" | "pr";

export interface PublishResult {
  prUrl: string;
  prNumber: number;
  branch: string;
  path: string;
}

interface RepoInfo {
  full_name: string;
  default_branch: string;
  owner: { login: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "20261026T235301" — sortable, branch-safe. */
export function timestamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

export function branchName(kind: CatalogKind, id: string, d = new Date()): string {
  return `community/${kind}-${id}-${timestamp(d)}`;
}

const KIND_TITLE: Record<CatalogKind, string> = {
  device: "device",
  profile: "profile",
  keymap: "keymap pack",
  effect: "effect",
  typing: "typing pack",
};

/** Pull-request body following .github/PULL_REQUEST_TEMPLATE.md. */
export function prBody(req: Pick<PublishRequest, "kind" | "testedOn" | "notes" | "appVersion">, preview: InstallPreview, path: string): string {
  const lines = [
    `## What is it?`,
    "",
    `A community **${KIND_TITLE[req.kind]}**: **${preview.name}** (\`${preview.id}\`) → \`${path}\`.`,
  ];
  const desc = typeof preview.data === "object" && preview.data ? (preview.data as { description?: string; notes?: string }) : {};
  if (desc.description || desc.notes) lines.push("", `> ${String(desc.description ?? desc.notes).replace(/\n/g, "\n> ")}`);
  if (req.notes?.trim()) lines.push("", req.notes.trim());
  lines.push("", "## Devices tested", "");
  if (req.testedOn?.length) for (const d of req.testedOn) lines.push(`- ${d}`);
  else lines.push("- _Not specified_");
  if (preview.risky.length) {
    lines.push("", "## ⚠️ Actions that need review", "");
    for (const r of preview.risky) lines.push(`- \`${r.type}\` at ${r.where}: ${r.detail.replace(/`/g, "'")}`);
  }
  if (preview.sandboxed) lines.push("", "_Community effects run sandboxed (worker, no network, no DOM)._");
  lines.push(
    "",
    "## Checklist",
    "",
    "- [x] File name matches the `id`",
    "- [x] Created with KeyHalo (in-app publish), `$schema` set",
    `- [${req.testedOn?.length ? "x" : " "}] Tested on a real device`,
    `- [${preview.risky.length ? " " : "x"}] No risky actions (\`launch\`, \`text\`, \`macro\` with text, \`http\`) — or they are explained above`,
    "- [x] I agree to license this contribution under the MIT License",
    "",
    `<sub>Published from KeyHalo${req.appVersion ? ` ${req.appVersion}` : ""}.</sub>`,
  );
  return lines.join("\n");
}

function previewFor(kind: CatalogKind, data: unknown): InstallPreview {
  const { preview, problems } = makePreview(kind, data, { type: "paste" });
  if (!preview) throw new CommunityError("invalidContent", { details: problems, vars: { problems: problems.slice(0, 3).join("; ") } });
  return preview;
}

/**
 * Publish an item as a pull request against Brokenwatch24/keyhalo.
 * Steps: ensure a fork exists (poll until ready) → branch from upstream's default branch →
 * commit the file (+ optional preview PNG) → open the PR. Returns the PR URL.
 */
export async function publishPullRequest(token: string | undefined, req: PublishRequest): Promise<PublishResult> {
  if (!token) throw new CommunityError("notSignedIn");
  const gh = new GitHubClient(token);
  const preview = previewFor(req.kind, req.data);
  const me = await gh.user();
  const upstreamPath = `/repos/${REPO_OWNER}/${REPO_NAME}`;

  // 1. Fork (the owner publishes straight to the upstream repository).
  req.onProgress?.("fork");
  const upstream = await gh.request<RepoInfo>("GET", upstreamPath);
  let target = upstream.full_name;
  if (me.login.toLowerCase() !== REPO_OWNER.toLowerCase()) {
    const fork = await gh.request<RepoInfo>("POST", `${upstreamPath}/forks`, { default_branch_only: true });
    target = fork.full_name;
    // Forking is asynchronous: wait until the fork answers.
    const deadline = Date.now() + 90_000;
    for (let delay = 1500; ; delay = Math.min(delay * 1.5, 8000)) {
      const ready = await gh.maybe<RepoInfo>("GET", `/repos/${target}/branches/${encodeURIComponent(fork.default_branch || upstream.default_branch)}`);
      if (ready) break;
      if (Date.now() > deadline) throw new CommunityError("forkTimeout");
      await sleep(delay);
    }
  }

  // 2. Branch from upstream's default branch.
  req.onProgress?.("branch");
  const base = await gh.request<{ object: { sha: string } }>("GET", `${upstreamPath}/git/ref/heads/${encodeURIComponent(upstream.default_branch)}`);
  const branch = branchName(req.kind, preview.id);
  await gh.request("POST", `/repos/${target}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.object.sha });

  // 3. Commit the file (and preview).
  req.onProgress?.("commit");
  const path = repoPathFor(req.kind, preview.id, preview.data);
  const putFile = async (filePath: string, contentB64: string, message: string) => {
    const existing = await gh.maybe<{ sha: string }>("GET", `/repos/${target}/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    await gh.request("PUT", `/repos/${target}/contents/${filePath}`, { message, content: contentB64, branch, ...(existing?.sha ? { sha: existing.sha } : {}) });
  };
  const verb = (await gh.maybe("GET", `${upstreamPath}/contents/${path}?ref=${encodeURIComponent(upstream.default_branch)}`)) ? "update" : "add";
  await putFile(path, toBase64(serialize(req.kind, preview.data)), `community(${req.kind}): ${verb} ${preview.name}`);
  if (req.previewDataUrl) {
    const m = /^data:image\/(png|svg\+xml|webp|jpeg);base64,(.+)$/.exec(req.previewDataUrl);
    if (m) {
      const ext = m[1] === "svg+xml" ? "svg" : m[1] === "jpeg" ? "jpg" : m[1];
      await putFile(path.replace(/\/[^/]+$/, `/${preview.id}.${ext}`), m[2], `community(${req.kind}): preview for ${preview.name}`);
    }
  }

  // 4. Pull request.
  req.onProgress?.("pr");
  const owner = target.split("/")[0];
  const pr = await gh.request<{ html_url: string; number: number }>("POST", `${upstreamPath}/pulls`, {
    title: `community(${req.kind}): ${verb} ${preview.name}`,
    head: `${owner}:${branch}`,
    base: upstream.default_branch,
    body: prBody(req, preview, path),
    maintainer_can_modify: true,
  });
  return { prUrl: pr.html_url, prNumber: pr.number, branch, path };
}

// ---------------------------------------------------------------------------
// Gists
// ---------------------------------------------------------------------------

export interface GistShareResult {
  gistId: string;
  gistUrl: string;
  /** keyhalo://import?gist=<id> — opens KeyHalo and offers to install. */
  deepLink: string;
  /** Raw URL of the file (works with "Import from URL"). */
  rawUrl?: string;
}

export const gistFileName = (kind: CatalogKind, id: string) => (kind === "effect" ? `keyhalo-effect-${id}.js` : `keyhalo-${kind}-${id}.json`);

export async function shareGist(token: string | undefined, kind: CatalogKind, data: unknown, opts: { public?: boolean } = {}): Promise<GistShareResult> {
  if (!token) throw new CommunityError("notSignedIn");
  const preview = previewFor(kind, data);
  const gh = new GitHubClient(token);
  const file = gistFileName(kind, preview.id);
  const gist = await gh.request<{ id: string; html_url: string; files: Record<string, { raw_url?: string }> }>("POST", "/gists", {
    description: `KeyHalo ${KIND_TITLE[kind]}: ${preview.name} — open with keyhalo://import?gist=… or https://github.com/${REPO}`,
    public: opts.public ?? true,
    files: { [file]: { content: serialize(kind, preview.data) } },
  });
  return { gistId: gist.id, gistUrl: gist.html_url, deepLink: `keyhalo://import?gist=${gist.id}`, rawUrl: gist.files?.[file]?.raw_url };
}

// ---------------------------------------------------------------------------
// Import (gist id / gist URL / raw URL / pasted JSON or JS)
// ---------------------------------------------------------------------------

export type ImportSource = { type: "gist"; id: string } | { type: "url"; url: string } | { type: "paste"; text: string };

/** Classify what the user pasted into the "Import" box. */
export function parseImportInput(input: string): ImportSource {
  const s = input.trim();
  if (!s) throw new CommunityError("invalidInput");
  if (s.startsWith("{") || /\bexport\s+default\b/.test(s)) return { type: "paste", text: s };
  const bareId = /^[0-9a-f]{20,40}$/i.exec(s);
  if (bareId) return { type: "gist", id: s.toLowerCase() };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new CommunityError("invalidInput");
  }
  if (url.protocol === "keyhalo:") {
    const params = new URLSearchParams(url.search);
    if (params.get("gist")) return parseImportInput(params.get("gist")!);
    if (params.get("url")) return parseImportInput(params.get("url")!);
    throw new CommunityError("invalidInput");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new CommunityError("invalidInput");
  if (url.hostname === "gist.github.com") {
    const id = url.pathname.split("/").filter(Boolean).find((p) => /^[0-9a-f]{20,40}$/i.test(p));
    if (id) return { type: "gist", id: id.toLowerCase() };
  }
  return { type: "url", url: url.toString() };
}

function parseText(text: string, filename?: string): { kind: CatalogKind; data: unknown } {
  if (text.length > MAX_CONTENT_SIZE) throw new CommunityError("tooLarge");
  const trimmed = text.replace(/^﻿/, "").trim();
  let data: unknown = trimmed;
  if (!/\.js$/i.test(filename ?? "") && !/\bexport\s+default\b/.test(trimmed)) {
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      throw new CommunityError("invalidContent", { cause: e, details: ["not valid JSON"], vars: { problems: "not valid JSON" } });
    }
  }
  const kind = detectKind(data, filename);
  if (!kind) throw new CommunityError("unknownKind");
  return { kind, data };
}

async function fetchText(url: string): Promise<string> {
  const res = await http("GET", url, { headers: { Accept: "application/json, text/plain, */*" } });
  if (res.status !== 200) throw errorFromResponse(res);
  return res.body;
}

/** Resolve an import input into an InstallPreview (nothing is installed yet). */
export async function resolveImport(input: string | ImportSource, token?: string): Promise<InstallPreview> {
  const src = typeof input === "string" ? parseImportInput(input) : input;
  let text: string;
  let filename: string | undefined;
  let ref: string | undefined;
  if (src.type === "gist") {
    const gh = new GitHubClient(token);
    const gist = await gh.request<{ files: Record<string, { filename: string; content?: string; truncated?: boolean; raw_url?: string; encoding?: string }> }>("GET", `/gists/${src.id}`);
    const files = Object.values(gist.files ?? {});
    const file = files.find((f) => /^keyhalo-/.test(f.filename)) ?? files.find((f) => /\.(json|js)$/i.test(f.filename)) ?? files[0];
    if (!file) throw new CommunityError("notFound");
    filename = file.filename;
    text = file.truncated || file.content === undefined ? await fetchText(file.raw_url!) : file.encoding === "base64" ? fromBase64(file.content) : file.content;
    ref = src.id;
  } else if (src.type === "url") {
    text = await fetchText(src.url);
    filename = new URL(src.url).pathname.split("/").pop();
    ref = src.url;
  } else {
    text = src.text;
  }
  const { kind, data } = parseText(text, filename);
  const { preview, problems } = makePreview(kind, data, { type: src.type, ref });
  if (!preview) throw new CommunityError("invalidContent", { details: problems, vars: { problems: problems.slice(0, 3).join("; ") } });
  return preview;
}
