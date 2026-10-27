import { useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, ExternalLink, Globe, Keyboard as KeyIcon, Link2, Play, ShieldCheck, TriangleAlert, Type as TypeIcon, Trash2, RefreshCw } from "lucide-react";
import { Badge, Button, Modal, toast } from "@/ui";
import { useT } from "@/i18n";
import { communityErrorMessage, installDeepLink, useCommunity, type InstallPreview, type RiskyAction } from "@/core/community";
import type { CatalogEntry } from "@/core/types";
import { ItemPreview } from "./Preview";
import { copyText, githubBlobUrl, KindIcon, Meta, shortDate, STATUS_TONE } from "./shared";
import { backend } from "@/core/backend";

const RISK_ICON = { launch: Play, text: TypeIcon, macro: KeyIcon, http: Globe } as const;

/**
 * Detail + review dialog. Opened for a catalog entry (downloads and checks it first) or for an
 * already-resolved preview (import, deep link). Risky keymap actions must be acknowledged with a
 * checkbox before the Install button unlocks.
 */
export function ItemModal({ entry, preview: initial, onClose }: { entry?: CatalogEntry; preview?: InstallPreview; onClose: () => void }) {
  const t = useT();
  const [preview, setPreview] = useState<InstallPreview | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const store = useCommunity();
  const item = entry ?? preview?.entry;
  const kind = item?.kind ?? preview?.kind;
  const id = item?.id ?? preview?.id;
  const installed = kind && id ? store.isInstalled(kind, id) : false;
  const hasUpdate = kind && id ? store.hasUpdate(kind, id) : false;
  const busy = kind && id ? !!store.busy[`${kind}:${id}`] : false;

  useEffect(() => {
    if (initial || !entry) return;
    let live = true;
    store.prepareInstall(entry).then(
      (p) => live && setPreview(p),
      (e) => live && setLoadError(communityErrorMessage(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.kind, entry?.id]);

  const source = useMemo(() => {
    if (!preview) return "";
    return typeof preview.data === "string" ? preview.data : JSON.stringify(preview.data, null, 2);
  }, [preview]);

  const name = item?.name ?? preview?.name ?? "";
  const needsConfirm = !!preview?.requiresConfirmation;

  async function doInstall() {
    if (!preview) return;
    try {
      await store.install(preview, { confirmRisky: needsConfirm ? confirmed : undefined });
      toast(t("community.item.installedToast", { name: preview.name }));
      onClose();
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    }
  }

  async function doUninstall() {
    if (!kind || !id) return;
    try {
      await store.uninstall(kind, id);
      toast(t("community.item.removedToast", { name }));
      onClose();
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    }
  }

  const fromLink = preview && preview.origin.type !== "catalog";
  const description = item?.description ?? (preview?.data as { description?: string } | undefined)?.description;
  const author = item?.author ?? (preview?.data as { author?: string } | undefined)?.author;

  const footer = (
    <>
      {installed && !fromLink && (
        <Button variant="danger" icon={<Trash2 />} onClick={doUninstall} disabled={busy} style={{ marginRight: "auto" }}>
          {t("community.item.uninstall")}
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        {needsConfirm && !installed ? t("community.review.cancel") : t("common.close")}
      </Button>
      {(!installed || hasUpdate || fromLink) && (
        <Button
          variant="primary"
          icon={hasUpdate ? <RefreshCw /> : <Check />}
          onClick={doInstall}
          disabled={!preview || busy || (needsConfirm && !confirmed)}
        >
          {busy ? t("community.item.installing") : hasUpdate ? t("community.item.update") : installed ? t("community.page.reinstall") : t("community.item.install")}
        </Button>
      )}
    </>
  );

  return (
    <Modal open onClose={onClose} wide title={fromLink ? t("community.review.title") : name} footer={footer}>
      <div className="community-detail">
        <div className="community-detail__top">
          {item && (
            <div className="community-detail__thumb">
              <ItemPreview entry={item} />
            </div>
          )}
          <div className="community-detail__info">
            <div className="row wrap" style={{ gap: 6 }}>
              {kind && (
                <span className="community-kind">
                  <KindIcon kind={kind} entry={item} />
                  {t(`community.kinds.${kind}`)}
                </span>
              )}
              {item?.status && (
                <Badge tone={STATUS_TONE[item.status]} dot>
                  {t(`community.status.${item.status}`)}
                </Badge>
              )}
              {installed && <Badge tone="success">{t("community.item.installed")}</Badge>}
              {hasUpdate && <Badge tone="info">{t("community.item.updateAvailable")}</Badge>}
              {fromLink && <Badge>{t("community.import.fromLink")}</Badge>}
            </div>
            {fromLink && <div className="community-detail__name">{name}</div>}
            {description && <p className="community-detail__desc">{description}</p>}
            <div className="community-detail__metas">
              {author && <Meta label={t("common.author")}>@{author}</Meta>}
              {(preview?.version || (preview?.data as { version?: string })?.version) && (
                <Meta label={t("community.page.version")}>{preview?.version ?? (preview?.data as { version?: string }).version}</Meta>
              )}
              {item?.updated && <Meta label={t("community.page.updatedLabel")}>{shortDate(item.updated)}</Meta>}
              {item?.apps?.length ? <Meta label={t("community.filters.app")}>{item.apps.join(", ")}</Meta> : null}
              {item && kind !== "device" && (
                <Meta label={t("community.page.devices")}>{item.devices?.length ? item.devices.join(", ") : t("community.item.anyDevice")}</Meta>
              )}
              {preview && preview.origin.type !== "catalog" && preview.origin.ref && (
                <Meta label={t("community.page.source")}>
                  <span className="mono community-break">{preview.origin.ref}</span>
                </Meta>
              )}
            </div>
            {item?.tags?.length ? (
              <div className="row wrap" style={{ gap: 4 }}>
                {item.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            ) : null}
            {item && (
              <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
                <Button size="sm" icon={<ExternalLink />} onClick={() => backend.openPath(githubBlobUrl(item.path))}>
                  {t("community.item.viewOnGitHub")}
                </Button>
                <Button size="sm" variant="ghost" icon={<Link2 />} onClick={() => copyText(installDeepLink(item.kind, item.id), t("community.item.linkCopied"))}>
                  {t("community.item.copyLink")}
                </Button>
                <span className="community-path mono" title={item.path}>
                  {item.path}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Review ----------------------------------------------------------- */}
        <section className="community-review">
          <div className="community-section-title">{t("community.page.safety")}</div>
          {!preview && !loadError && <div className="community-review__loading">{t("community.page.checking")}</div>}
          {loadError && (
            <div className="community-callout community-callout--danger">
              <TriangleAlert />
              <div>{loadError}</div>
            </div>
          )}
          {preview && preview.risky.length > 0 && <RiskList preview={preview} confirmed={confirmed} setConfirmed={setConfirmed} />}
          {preview && preview.risky.length === 0 && (
            <div className="community-callout community-callout--ok">
              <ShieldCheck />
              <div>{preview.sandboxed ? t("community.review.sandboxed") : t("community.review.safe")}</div>
            </div>
          )}
          {preview?.kind === "keymap" && <div className="community-note">{t("community.review.disabledUntilEnabled")}</div>}
        </section>

        {/* Source ------------------------------------------------------------ */}
        {preview && (
          <section className="community-source">
            <button type="button" className="community-source__toggle" onClick={() => setShowSource((v) => !v)} aria-expanded={showSource}>
              <Code2 />
              {preview.kind === "effect" ? t("community.page.viewSourceJs") : t("community.page.viewSource")}
              <span className="subtle">{t("community.page.lines", { count: source.split("\n").length })}</span>
              <span className="grow" />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Copy />}
                title={t("common.copy")}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(source);
                }}
              />
            </button>
            {showSource && <pre className="community-source__code mono">{source}</pre>}
          </section>
        )}
      </div>
    </Modal>
  );
}

function RiskList({ preview, confirmed, setConfirmed }: { preview: InstallPreview; confirmed: boolean; setConfirmed: (v: boolean) => void }) {
  const t = useT();
  return (
    <div className="community-risk">
      <div className="community-callout community-callout--warn">
        <TriangleAlert />
        <div>{t("community.review.intro", { name: preview.name })}</div>
      </div>
      <ul className="community-risk__list">
        {preview.risky.map((r: RiskyAction, i) => {
          const Icon = RISK_ICON[r.type];
          return (
            <li key={i} className="community-risk__item">
              <span className="community-risk__icon">
                <Icon />
              </span>
              <div className="grow">
                <div className="community-risk__title">
                  {t(`community.review.${r.type}`)}
                  <span className="subtle"> · {t("community.review.where", { where: r.where })}</span>
                </div>
                <div className="community-risk__explain">{t(`community.page.riskExplain.${r.type}`)}</div>
                {r.detail && <code className="community-risk__detail">{r.detail}</code>}
              </div>
            </li>
          );
        })}
      </ul>
      <label className="community-confirm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{t("community.review.confirm")}</span>
      </label>
    </div>
  );
}
