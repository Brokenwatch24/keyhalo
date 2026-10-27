import { useMemo, useState } from "react";
import { PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, toast } from "@/ui";
import { useT } from "@/i18n";
import { communityErrorMessage, useCommunity, type InstalledItem } from "@/core/community";
import type { CatalogEntry } from "@/core/types";
import { KIND_ORDER, KindIcon, shortDate } from "./shared";

export function Installed({ onOpen, onBrowse }: { onOpen: (entry: CatalogEntry) => void; onBrowse: () => void }) {
  const t = useT();
  const installed = useCommunity((s) => s.installed);
  const index = useCommunity((s) => s.index);
  const busy = useCommunity((s) => s.busy);
  const [updatingAll, setUpdatingAll] = useState(false);

  const items = useMemo(
    () => Object.values(installed).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)),
    [installed],
  );
  const updates = useMemo(() => useCommunity.getState().updates(), [installed, index]);

  async function update(entry: CatalogEntry) {
    const s = useCommunity.getState();
    const preview = await s.prepareInstall(entry);
    if (preview.requiresConfirmation) {
      onOpen(entry); // needs a fresh review
      return false;
    }
    await s.install(preview);
    return true;
  }

  async function updateAll() {
    setUpdatingAll(true);
    let done = 0;
    let review = 0;
    for (const e of updates) {
      try {
        if (await update(e)) done++;
        else review++;
      } catch (err) {
        toast(communityErrorMessage(err), "danger");
      }
    }
    setUpdatingAll(false);
    toast(t("community.page.updatedCount", { count: done }) + (review ? ` ${t("community.page.needReview", { count: review })}` : ""));
  }

  async function remove(item: InstalledItem) {
    try {
      await useCommunity.getState().uninstall(item.kind, item.id);
      toast(t("community.item.removedToast", { name: item.name }));
    } catch (e) {
      toast(communityErrorMessage(e), "danger");
    }
  }

  if (!items.length)
    return (
      <Card>
        <EmptyState
          icon={<PackageOpen />}
          title={t("community.page.installedEmptyTitle")}
          action={
            <Button variant="primary" onClick={onBrowse}>
              {t("community.page.browseGallery")}
            </Button>
          }
        >
          {t("community.page.installedEmpty")}
        </EmptyState>
      </Card>
    );

  return (
    <Card
      flush
      title={t("community.page.installedTitle", { count: items.length })}
      subtitle={updates.length ? t("community.item.updatesAvailable", { count: updates.length }) : t("community.page.allUpToDate")}
      actions={
        <Button size="sm" variant={updates.length ? "primary" : "secondary"} icon={<RefreshCw />} disabled={!updates.length || updatingAll} onClick={updateAll}>
          {t("community.item.updateAll")}
        </Button>
      }
    >
      <div className="kh-list">
        {items.map((item) => {
          const key = `${item.kind}:${item.id}`;
          const entry = index?.entries.find((e) => e.kind === item.kind && e.id === item.id);
          const hasUpdate = useCommunity.getState().hasUpdate(item.kind, item.id);
          return (
            <div key={key} className="kh-list__row community-installed-row">
              <span className="community-installed-row__icon">
                <KindIcon kind={item.kind} entry={entry} />
              </span>
              <div className="grow">
                <div className="community-installed-row__name">
                  {entry ? (
                    <button type="button" className="community-link" onClick={() => onOpen(entry)}>
                      {item.name}
                    </button>
                  ) : (
                    item.name
                  )}
                  {item.version && <span className="subtle mono"> v{item.version}</span>}
                </div>
                <div className="community-installed-row__meta">
                  {t(`community.kinds.${item.kind}`)} · {t("community.page.installedOn", { date: shortDate(item.installedAt) })} ·{" "}
                  {t(`community.page.origins.${item.origin.type}`)}
                  {item.confirmedRisky && <> · {t("community.page.reviewedActions")}</>}
                </div>
              </div>
              {hasUpdate && <Badge tone="info">{t("community.item.updateAvailable")}</Badge>}
              {hasUpdate && entry && (
                <Button
                  size="sm"
                  icon={<RefreshCw />}
                  disabled={!!busy[key]}
                  onClick={() => update(entry).then((ok) => ok && toast(t("community.item.installedToast", { name: item.name })), (e) => toast(communityErrorMessage(e), "danger"))}
                >
                  {t("community.item.update")}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={!!busy[key]} onClick={() => remove(item)}>
                {t("community.item.uninstall")}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
