import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Copy, ExternalLink, FileUp, GitPullRequest, Link2, LoaderCircle, Share2, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, Field, Input, Segmented, Select, TextArea, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import {
  checkContent,
  communityErrorMessage,
  detectKind,
  repoPathFor,
  riskyActions,
  useCommunity,
  type GistShareResult,
  type InstallPreview,
  type PublishResult,
  type PublishStep,
} from "@/core/community";
import { useDevices } from "@/core/devices/store";
import { effectRegistry, renderProfilePreview, useEffects, useProfiles } from "@/core/lighting";
import { useKeymaps } from "@/core/keymaps";
import type { CatalogEntry, CatalogKind, KeymapPack, Profile } from "@/core/types";
import { GitHubAccount } from "./Account";
import { ItemPreview, previewKeyboard } from "./Preview";
import { copyText, GitHubMark, KindIcon } from "./shared";

type Source = "profile" | "keymap" | "effect" | "device" | "json";

interface Candidate {
  id: string;
  name: string;
  kind: CatalogKind;
  data: unknown;
}

const STEPS: PublishStep[] = ["fork", "branch", "commit", "pr"];
type StepState = "pending" | "active" | "done" | "error";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The user's own content, read defensively from each feature's store. */
function useCandidates(source: Source): Candidate[] {
  const t = useT();
  const profiles = useProfiles((s) => s.profiles) as Profile[] | undefined;
  const sources = useProfiles((s) => s.sources) as Record<string, string> | undefined;
  const userPacks = useKeymaps((s) => s.user) as KeymapPack[] | undefined;
  const effectList = useEffects();
  const effectKey = effectList.map((e) => `${e.id}:${e.source}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const effects = useMemo(() => effectList, [effectKey]);
  const definitions = useDevices((s) => s.definitions);
  const catalog = useCommunity((s) => s.index);
  return useMemo(() => {
    switch (source) {
      case "profile":
        return (profiles ?? []).filter((p) => sources?.[p.id] === "user").map((p) => ({ id: p.id, name: p.name, kind: "profile" as const, data: p }));
      case "keymap":
        return (userPacks ?? []).map((p) => ({ id: p.id, name: p.name, kind: "keymap" as const, data: p }));
      case "effect":
        return effects
          .filter((m) => m.source === "community")
          .map((m) => ({ id: m.id, name: m.name, kind: "effect" as const, data: effectRegistry.get(m.id)?.source }))
          .filter((c) => typeof c.data === "string");
      case "device": {
        const inCatalog = new Set((catalog?.entries ?? []).filter((e) => e.kind === "device").map((e) => e.id));
        return [...definitions]
          .sort((a, b) => Number(inCatalog.has(a.id)) - Number(inCatalog.has(b.id)) || a.name.localeCompare(b.name))
          .map((d) => ({ id: d.id, name: inCatalog.has(d.id) ? `${d.name} · ${t("community.page.inGallery")}` : d.name, kind: "device" as const, data: d }));
      }
      default:
        return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, profiles, sources, userPacks, effects, definitions, catalog]);
}

interface Edits {
  name: string;
  description: string;
  tags: string;
}

function applyEdits(kind: CatalogKind, data: unknown, edits: Edits, login?: string): unknown {
  if (kind === "effect" || !isObj(data)) return data;
  const d: Record<string, unknown> = structuredClone(data);
  if (edits.name.trim()) d.name = edits.name.trim();
  const desc = edits.description.trim();
  if (kind === "device") {
    if (desc) d.notes = desc;
  } else if (desc) d.description = desc;
  if (kind === "profile" || kind === "keymap") {
    const tags = edits.tags
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tags.length) d.tags = [...new Set(tags)];
    else delete d.tags;
  }
  if (login && kind !== "device" && !d.author) d.author = login;
  return d;
}

export function Share({ onReview }: { onReview: (p: InstallPreview) => void }) {
  return (
    <div className="community-share">
      <div className="community-share__main">
        <PublishCard />
      </div>
      <div className="community-share__side">
        <Card title={<span className="row" style={{ gap: 8 }}><GitHubMark />{"GitHub"}</span>}>
          <GitHubAccount />
        </Card>
        <ImportCard onReview={onReview} />
      </div>
    </div>
  );
}

function PublishCard() {
  const t = useT();
  const auth = useCommunity((s) => s.auth);
  const signedIn = auth.status === "signedIn";
  const login = signedIn ? auth.login : undefined;
  const devices = useDevices((s) => s.devices);
  const definitions = useDevices((s) => s.definitions);

  const [source, setSourceRaw] = useState<Source>("profile");
  const [touched, setTouched] = useState(false);
  const setSource = (v: Source) => {
    setTouched(true);
    setSourceRaw(v);
  };
  const byKind: Record<Exclude<Source, "json">, Candidate[]> = {
    profile: useCandidates("profile"),
    keymap: useCandidates("keymap"),
    effect: useCandidates("effect"),
    device: useCandidates("device"),
  };
  const candidates = source === "json" ? [] : byKind[source];
  // Open on the first kind the user actually has something to share.
  const firstWithItems = (["profile", "keymap", "effect", "device"] as const).find((k) => byKind[k].length > 0);
  useEffect(() => {
    if (!touched && source !== "json" && !byKind[source].length && firstWithItems) setSourceRaw(firstWithItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, source, firstWithItems]);
  const [selected, setSelected] = useState("");
  const [pasted, setPasted] = useState("");
  const [edits, setEdits] = useState<Edits>({ name: "", description: "", tags: "" });
  const [tested, setTested] = useState<string[]>([]);
  const [testedExtra, setTestedExtra] = useState("");
  const [notes, setNotes] = useState("");
  const [includePreview, setIncludePreview] = useState(true);

  const [steps, setSteps] = useState<Record<PublishStep, StepState> | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [gist, setGist] = useState<GistShareResult | null>(null);
  const [sharing, setSharing] = useState(false);

  // Keep the selection valid.
  useEffect(() => {
    const next = candidates[0]?.id ?? "";
    if (source !== "json" && !candidates.some((c) => c.id === selected) && next !== selected) setSelected(next);
  }, [candidates, selected, source]);

  // Base item.
  const base: Candidate | null = useMemo(() => {
    if (source !== "json") return candidates.find((c) => c.id === selected) ?? null;
    const text = pasted.trim();
    if (!text) return null;
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* effect source */
    }
    const kind = detectKind(data);
    if (!kind) return null;
    const o = isObj(data) ? data : {};
    return { id: String(o.id ?? (kind === "effect" ? "effect" : "")), name: String(o.name ?? kind), kind, data };
  }, [source, candidates, selected, pasted]);

  // Reset the editable fields when the base item changes.
  useEffect(() => {
    const d = isObj(base?.data) ? base!.data : {};
    setEdits({
      name: typeof d.name === "string" ? d.name : (base?.name ?? ""),
      description: typeof d.description === "string" ? d.description : typeof d.notes === "string" ? d.notes : "",
      tags: Array.isArray(d.tags) ? (d.tags as string[]).join(", ") : "",
    });
    setResult(null);
    setGist(null);
    setSteps(null);
    setPublishError(null);
  }, [base?.kind, base?.id]);

  const kind = base?.kind;
  const data = useMemo(() => (base ? applyEdits(base.kind, base.data, edits, login) : null), [base, edits, login]);
  const problems = useMemo(() => (base && data != null ? checkContent(base.kind, data) : []), [base, data]);
  const risky = useMemo(() => (kind === "keymap" && isObj(data) ? riskyActions(data as unknown as KeymapPack) : []), [kind, data]);
  const path = base && kind ? repoPathFor(kind, base.id, data) : "";
  const previewEntry: CatalogEntry | null = base && kind
    ? {
        kind,
        id: base.id,
        name: isObj(data) && typeof data.name === "string" ? data.name : base.name,
        description: isObj(data) ? ((data.description ?? data.notes) as string | undefined) : effectRegistry.get(base.id)?.meta.description,
        author: (isObj(data) ? (data.author as string | undefined) : effectRegistry.get(base.id)?.meta.author) ?? login,
        tags: isObj(data) && Array.isArray(data.tags) ? (data.tags as string[]) : undefined,
        status: kind === "device" && isObj(data) ? (data.status as CatalogEntry["status"]) : undefined,
        path,
      }
    : null;

  const testedOn = [
    ...devices.filter((d) => tested.includes(d.uid)).map((d) => `${d.definition.name}${d.firmware ? ` (fw ${d.firmware})` : ""}`),
    ...testedExtra
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];

  async function publish() {
    if (!base || !kind || data == null) return;
    setPublishing(true);
    setResult(null);
    setPublishError(null);
    const state: Record<PublishStep, StepState> = { fork: "pending", branch: "pending", commit: "pending", pr: "pending" };
    setSteps({ ...state });
    let current = null as PublishStep | null;
    try {
      let previewDataUrl: string | undefined;
      if (kind === "profile" && includePreview) {
        const kb = previewKeyboard(definitions, devices.map((d) => d.definition));
        if (kb) previewDataUrl = await renderProfilePreview(data as Profile, kb).catch(() => undefined);
      }
      const appVersion = await backend.appVersion().catch(() => undefined);
      const res = await useCommunity.getState().publish({
        kind,
        data,
        previewDataUrl,
        testedOn,
        notes: notes.trim() || undefined,
        appVersion,
        onProgress: (step) => {
          if (current) state[current] = "done";
          current = step;
          state[step] = "active";
          setSteps({ ...state });
        },
      });
      STEPS.forEach((s) => (state[s] = "done"));
      setSteps({ ...state });
      setResult(res);
      toast(t("community.share.done"));
    } catch (e) {
      if (current) state[current] = "error";
      setSteps({ ...state });
      setPublishError(communityErrorMessage(e));
    } finally {
      setPublishing(false);
    }
  }

  async function shareGist() {
    if (!kind || data == null) return;
    setSharing(true);
    try {
      setGist(await useCommunity.getState().shareGist(kind, data));
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    } finally {
      setSharing(false);
    }
  }

  const SOURCES: { value: Source; label: string }[] = [
    { value: "profile", label: t("community.kinds.profile") },
    { value: "keymap", label: t("community.kinds.keymap") },
    { value: "effect", label: t("community.kinds.effect") },
    { value: "device", label: t("community.kinds.device") },
    { value: "json", label: t("community.page.fromJson") },
  ];

  const canSend = signedIn && !!base && problems.length === 0 && !publishing;

  return (
    <Card title={t("community.share.publish")} subtitle={t("community.share.publishIntro")}>
      <div className="community-publish">
        <div className="community-publish__form">
          <Field label={t("community.page.whatToPublish")}>
            <Segmented<Source> value={source} onChange={setSource} options={SOURCES} />
          </Field>

          {source === "json" ? (
            <Field label={t("community.page.pasteItem")} hint={t("community.page.pasteHint")}>
              <TextArea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{ "id": "my-profile", "name": "…", … }' spellCheck={false} />
            </Field>
          ) : candidates.length ? (
            <Field label={t(`community.kinds.${source}`)}>
              <Select<string> value={selected} onChange={setSelected} options={candidates.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
          ) : (
            <div className="community-callout">
              <CircleAlert />
              <div>{t(`community.page.nothingToPublish.${source}`)}</div>
            </div>
          )}

          {base && (
            <>
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label={t("common.name")}>
                  <Input value={edits.name} disabled={kind === "effect"} onChange={(e) => setEdits({ ...edits, name: e.target.value })} />
                </Field>
                <Field label={t("common.tags")} hint={kind === "profile" || kind === "keymap" ? t("community.page.tagsHint") : undefined}>
                  <Input
                    value={edits.tags}
                    disabled={kind !== "profile" && kind !== "keymap"}
                    placeholder="gaming, calm"
                    onChange={(e) => setEdits({ ...edits, tags: e.target.value })}
                  />
                </Field>
              </div>
              <Field label={kind === "device" ? t("community.page.deviceNotes") : t("common.description")}>
                <TextArea
                  className="community-prose"
                  rows={2}
                  value={edits.description}
                  disabled={kind === "effect"}
                  onChange={(e) => setEdits({ ...edits, description: e.target.value })}
                />
              </Field>
              <Field label={t("community.share.testedOn")}>
                <div className="community-tested">
                  {devices.map((d) => {
                    const on = tested.includes(d.uid);
                    return (
                      <button
                        key={d.uid}
                        type="button"
                        className="community-tag"
                        aria-pressed={on}
                        onClick={() => setTested(on ? tested.filter((x) => x !== d.uid) : [...tested, d.uid])}
                      >
                        {on && <Check />}
                        {d.definition.name}
                      </button>
                    );
                  })}
                  <Input className="community-tested__extra" value={testedExtra} placeholder={t("community.page.otherDevices")} onChange={(e) => setTestedExtra(e.target.value)} />
                </div>
              </Field>
              <Field label={t("community.share.notes")}>
                <TextArea className="community-prose" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              {kind === "profile" && <Toggle checked={includePreview} onChange={setIncludePreview} label={t("community.share.includePreview")} />}
            </>
          )}
        </div>

        <div className="community-publish__preview">
          <div className="community-section-title">{t("community.page.preview")}</div>
          {previewEntry ? (
            <div className="community-card community-card--static">
              <div className="community-card__stage">
                <ItemPreview entry={previewEntry} />
                <span className="community-card__kind">
                  <KindIcon kind={previewEntry.kind} />
                  {t(`community.kinds.${previewEntry.kind}`)}
                </span>
              </div>
              <div className="community-card__body">
                <div className="community-card__title">
                  <span className="community-card__name">{previewEntry.name}</span>
                </div>
                {previewEntry.description && <p className="community-card__desc">{previewEntry.description}</p>}
                <div className="community-card__tags">
                  {(previewEntry.tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag} className="community-card__tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="community-card__foot">
                <span className="community-card__author">{previewEntry.author ? `@${previewEntry.author}` : t("community.page.anonymous")}</span>
              </div>
            </div>
          ) : (
            <div className="community-card community-card--placeholder">{t("community.page.choosePrompt")}</div>
          )}
          {path && (
            <div className="community-pathbox">
              <span className="subtle">{t("community.page.willBeSaved")}</span>
              <code className="mono">{path}</code>
            </div>
          )}
          {problems.length > 0 && (
            <div className="community-callout community-callout--danger">
              <TriangleAlert />
              <div>
                <div style={{ fontWeight: 600 }}>{t("community.page.fixFirst")}</div>
                <ul className="community-problems">
                  {problems.slice(0, 6).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {risky.length > 0 && (
            <div className="community-callout community-callout--warn">
              <TriangleAlert />
              <div>{t("community.page.riskyPublish", { count: risky.length })}</div>
            </div>
          )}

          <div className="community-publish__actions">
            <Button variant="primary" icon={<GitPullRequest />} disabled={!canSend} onClick={publish}>
              {publishing ? t("community.share.publishing") : t("community.page.openPr")}
            </Button>
            <Button icon={<Share2 />} disabled={!signedIn || !base || problems.length > 0 || sharing} onClick={shareGist}>
              {sharing ? t("common.loading") : t("community.share.gist")}
            </Button>
          </div>
          {!signedIn && <div className="community-note">{t("community.page.signInToShare")}</div>}

          {steps && (
            <ol className="community-progress">
              {STEPS.map((s, i) => (
                <li key={s} className={`community-progress__step community-progress__step--${steps[s]}`}>
                  <span className="community-progress__dot">
                    {steps[s] === "done" ? <Check /> : steps[s] === "active" ? <LoaderCircle className="community-spin" /> : steps[s] === "error" ? <TriangleAlert /> : i + 1}
                  </span>
                  {t(`community.page.stepLabels.${s}`)}
                </li>
              ))}
            </ol>
          )}
          {publishError && (
            <div className="community-callout community-callout--danger">
              <TriangleAlert />
              <div>{publishError}</div>
            </div>
          )}
          {result && (
            <div className="community-result">
              <div className="community-result__title">
                <Badge tone="success" dot>
                  {t("community.share.done")}
                </Badge>
                <span className="mono subtle">#{result.prNumber}</span>
              </div>
              <div className="community-result__row">
                <code className="mono">{result.prUrl}</code>
                <Button size="sm" iconOnly icon={<Copy />} title={t("common.copy")} onClick={() => copyText(result.prUrl)} />
                <Button size="sm" variant="primary" icon={<ExternalLink />} onClick={() => backend.openPath(result.prUrl)}>
                  {t("community.share.openPr")}
                </Button>
              </div>
            </div>
          )}
          {gist && (
            <div className="community-result">
              <div className="community-result__title">
                <Badge tone="success" dot>
                  {t("community.page.gistCreated")}
                </Badge>
              </div>
              <p className="community-note">{t("community.share.gistDone")}</p>
              <div className="community-result__row">
                <code className="mono">{gist.gistUrl}</code>
                <Button size="sm" iconOnly icon={<Copy />} title={t("common.copy")} onClick={() => copyText(gist.gistUrl)} />
                <Button size="sm" iconOnly icon={<ExternalLink />} title={t("community.share.openGist")} onClick={() => backend.openPath(gist.gistUrl)} />
              </div>
              <div className="community-result__row">
                <code className="mono">{gist.deepLink}</code>
                <Button size="sm" icon={<Link2 />} onClick={() => copyText(gist.deepLink)}>
                  {t("community.share.copyDeepLink")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ImportCard({ onReview }: { onReview: (p: InstallPreview) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      onReview(await useCommunity.getState().importFrom(text));
      setText("");
    } catch (e) {
      setError(communityErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("community.import.title")} subtitle={t("community.page.importIntro")}>
      <div className="col" style={{ gap: 10 }}>
        <TextArea rows={4} value={text} placeholder={t("community.import.placeholder")} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {error && (
          <div className="community-callout community-callout--danger">
            <TriangleAlert />
            <div>{error}</div>
          </div>
        )}
        <div className="row">
          <span className="community-note grow">{t("community.page.importSafe")}</span>
          <Button icon={<FileUp />} onClick={run} disabled={!text.trim() || busy}>
            {busy ? t("common.loading") : t("community.import.action")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
