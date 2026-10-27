import { useMemo, useState } from "react";
import { Check, Download, RefreshCw, Search, X } from "lucide-react";
import { Badge, Button, EmptyState, Input, Segmented, Select, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { catalogApps, catalogTags, communityErrorMessage, countByKind, useCatalogResults, useCommunity, type CatalogFilters } from "@/core/community";
import type { CatalogEntry, CatalogKind } from "@/core/types";
import { ItemPreview } from "./Preview";
import { KIND_ORDER, KindIcon, relativeTime, STATUS_TONE } from "./shared";

type KindFilter = "all" | CatalogKind;
type SortUi = "featured" | "newest" | "name";
const SORT_TO: Record<SortUi, CatalogFilters["sort"]> = { featured: "relevance", newest: "updated", name: "name" };
const SORT_FROM: Record<CatalogFilters["sort"], SortUi> = { relevance: "featured", updated: "newest", name: "name" };

export function Browse({ onOpen }: { onOpen: (entry: CatalogEntry) => void }) {
  const t = useT();
  const index = useCommunity((s) => s.index);
  const filters = useCommunity((s) => s.filters);
  const setFilters = useCommunity((s) => s.setFilters);
  const resetFilters = useCommunity((s) => s.resetFilters);
  const loading = useCommunity((s) => s.loading);
  const results = useCatalogResults();
  const entries = index?.entries ?? [];
  const counts = useMemo(() => countByKind(entries), [entries]);
  const [showAllTags, setShowAllTags] = useState(false);

  // Tags & apps relevant to the selected kind.
  const scoped = useMemo(() => (filters.kinds.length ? entries.filter((e) => filters.kinds.includes(e.kind)) : entries), [entries, filters.kinds]);
  const tags = useMemo(() => catalogTags(scoped), [scoped]);
  const apps = useMemo(() => catalogApps(scoped), [scoped]);
  const visibleTags = showAllTags ? tags : tags.slice(0, 12);

  const kind: KindFilter = filters.kinds.length === 1 ? filters.kinds[0] : "all";
  const sort = SORT_FROM[filters.sort];

  // "Featured" with no query: group by kind so the gallery opens on lighting.
  const ordered = useMemo(() => {
    if (filters.sort !== "relevance" || filters.query.trim()) return results;
    return [...results].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }, [results, filters.sort, filters.query]);

  const dirty = filters.query || filters.kinds.length || filters.tags.length || filters.compatibleOnly || filters.app || filters.installed;

  return (
    <div className="community-browse">
      <div className="community-toolbar">
        <div className="community-search">
          <Search />
          <Input
            value={filters.query}
            placeholder={t("community.catalog.search")}
            onChange={(e) => setFilters({ query: e.target.value })}
            aria-label={t("common.search")}
          />
          {filters.query && (
            <button type="button" className="community-search__clear" onClick={() => setFilters({ query: "" })} aria-label={t("community.filters.reset")}>
              <X />
            </button>
          )}
        </div>
        <Select<SortUi>
          value={sort}
          onChange={(v) => setFilters({ sort: SORT_TO[v] })}
          options={[
            { value: "featured", label: t("community.page.sortFeatured") },
            { value: "newest", label: t("community.page.sortNewest") },
            { value: "name", label: t("community.filters.sortName") },
          ]}
          aria-label={t("community.filters.sort")}
          style={{ width: 150 }}
        />
      </div>

      <div className="community-filters">
        <Segmented<KindFilter>
          value={kind}
          onChange={(v) => setFilters({ kinds: v === "all" ? [] : [v], tags: [], app: undefined })}
          options={[
            { value: "all", label: <FilterLabel label={t("community.filters.all")} count={entries.length} /> },
            ...KIND_ORDER.map((k) => ({ value: k, label: <FilterLabel label={t(`community.page.kindTabs.${k}`)} count={counts[k]} /> })),
          ]}
        />
        <span className="grow" />
        <Toggle checked={filters.compatibleOnly} onChange={(v) => setFilters({ compatibleOnly: v })} label={t("community.filters.compatible")} />
        {apps.length > 0 && (
          <Select<string>
            value={filters.app ?? ""}
            onChange={(v) => setFilters({ app: v || undefined })}
            options={[{ value: "", label: t("community.filters.anyApp") }, ...apps.map((a) => ({ value: a, label: a.replace(/\.exe$/i, "") }))]}
            aria-label={t("community.filters.app")}
            style={{ width: 170 }}
          />
        )}
      </div>

      {tags.length > 0 && (
        <div className="community-tags">
          {visibleTags.map(({ tag, count }) => {
            const on = filters.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className="community-tag"
                aria-pressed={on}
                onClick={() => setFilters({ tags: on ? filters.tags.filter((x) => x !== tag) : [...filters.tags, tag] })}
              >
                {on && <Check />}
                {tag}
                <span className="community-tag__n">{count}</span>
              </button>
            );
          })}
          {tags.length > 12 && (
            <button type="button" className="community-tag community-tag--more" onClick={() => setShowAllTags((v) => !v)}>
              {showAllTags ? t("community.page.fewerTags") : t("community.page.moreTags", { count: tags.length - 12 })}
            </button>
          )}
          {dirty ? (
            <button type="button" className="community-tag community-tag--reset" onClick={resetFilters}>
              <X />
              {t("community.filters.reset")}
            </button>
          ) : null}
        </div>
      )}

      {!index && loading ? (
        <div className="community-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="community-card community-card--skeleton" />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={entries.length ? t("community.catalog.empty") : t("community.catalog.emptyCatalog")}
          action={
            dirty ? (
              <Button size="sm" onClick={resetFilters}>
                {t("community.filters.reset")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="community-count subtle">{t("community.catalog.results", { count: ordered.length })}</div>
          <div className="community-grid">
            {ordered.map((e) => (
              <ItemCard key={`${e.kind}:${e.id}`} entry={e} onOpen={() => onOpen(e)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      <span className="community-seg-count">{count}</span>
    </>
  );
}

export function ItemCard({ entry, onOpen }: { entry: CatalogEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <article className="community-card">
      <button type="button" className="community-card__stage" onClick={onOpen} aria-label={entry.name}>
        <ItemPreview entry={entry} />
        <span className="community-card__kind">
          <KindIcon kind={entry.kind} entry={entry} />
          {t(`community.kinds.${entry.kind}`)}
        </span>
      </button>
      <div className="community-card__body" onClick={onOpen}>
        <div className="community-card__title">
          <span className="community-card__name">{entry.name}</span>
          {entry.status && (
            <Badge tone={STATUS_TONE[entry.status]} dot>
              {t(`community.status.${entry.status}`)}
            </Badge>
          )}
        </div>
        {entry.description && <p className="community-card__desc">{entry.description}</p>}
        <div className="community-card__tags">
          {(entry.tags ?? []).slice(0, 3).map((tag) => (
            <span key={tag} className="community-card__tag">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="community-card__foot">
        <span className="community-card__author">{entry.author ? `@${entry.author}` : t("community.page.anonymous")}</span>
        <InstallButton entry={entry} onNeedsReview={onOpen} />
      </div>
    </article>
  );
}

/** Install / Installed / Update. Risky items open the review dialog instead of installing. */
export function InstallButton({ entry, onNeedsReview }: { entry: CatalogEntry; onNeedsReview: () => void }) {
  const t = useT();
  const key = `${entry.kind}:${entry.id}`;
  const installed = useCommunity((s) => key in s.installed);
  const busyStore = useCommunity((s) => !!s.busy[key]);
  const hasUpdate = useCommunity((s) => (key in s.installed ? s.hasUpdate(entry.kind, entry.id) : false));
  const [preparing, setPreparing] = useState(false);
  const busy = busyStore || preparing;

  async function run() {
    setPreparing(true);
    try {
      const { prepareInstall, install } = useCommunity.getState();
      const preview = await prepareInstall(entry);
      if (preview.requiresConfirmation) {
        onNeedsReview();
        return;
      }
      await install(preview);
      toast(t("community.item.installedToast", { name: entry.name }));
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    } finally {
      setPreparing(false);
    }
  }

  if (installed && !hasUpdate)
    return (
      <span className="community-installed">
        <Check />
        {t("community.item.installed")}
      </span>
    );
  return (
    <Button
      size="sm"
      variant={hasUpdate ? "primary" : "secondary"}
      icon={hasUpdate ? <RefreshCw /> : <Download />}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void run();
      }}
    >
      {busy ? t("community.item.installing") : hasUpdate ? t("community.item.update") : t("community.item.install")}
    </Button>
  );
}

/** "Up to date · 2 min ago" / "Offline — bundled" indicator + refresh. */
export function SourceIndicator() {
  const t = useT();
  const source = useCommunity((s) => s.source);
  const fetchedAt = useCommunity((s) => s.fetchedAt);
  const loading = useCommunity((s) => s.loading);
  const error = useCommunity((s) => s.error);
  const refresh = useCommunity((s) => s.refresh);
  const offline = source === "bundled" || source === "runtime";
  const tone = source === "network" ? "ok" : source === "cache" ? "info" : "off";
  const label = !source
    ? t("common.loading")
    : source === "network"
      ? `${t("community.catalog.source.network")} · ${relativeTime(fetchedAt)}`
      : source === "cache"
        ? t("community.page.sourceCache", { when: relativeTime(fetchedAt) })
        : t("community.page.sourceOffline");
  return (
    <div className="row" style={{ gap: 10 }}>
      <span
        className={`community-source-ind community-source-ind--${tone}`}
        title={offline || error ? t("community.catalog.offlineHint", { message: error ? communityErrorMessage(error) : "" }) : undefined}
      >
        <span className="community-source-ind__dot" />
        {label}
      </span>
      <Button
        size="sm"
        icon={<RefreshCw className={loading ? "community-spin" : undefined} />}
        disabled={loading}
        onClick={() => refresh({ force: true }).then(() => {
          const err = useCommunity.getState().error;
          if (err && useCommunity.getState().source !== "network") toast(t("community.catalog.offlineHint", { message: communityErrorMessage(err) }));
        })}
      >
        {loading ? t("community.catalog.refreshing") : t("community.catalog.refresh")}
      </Button>
    </div>
  );
}
