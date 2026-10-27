import { useEffect, useState } from "react";
import { Compass, PackageCheck, Share2, Usb, TriangleAlert } from "lucide-react";
import { Button, Modal, Page, Tabs } from "@/ui";
import { useT } from "@/i18n";
import { useRoute, navigate } from "@/app/router";
import { communityErrorMessage, useCommunity, type InstallPreview } from "@/core/community";
import type { CatalogEntry } from "@/core/types";
import { Browse, SourceIndicator } from "./Browse";
import { Installed } from "./Installed";
import { Share } from "./Share";
import { AddDevice } from "./AddDevice";
import { ItemModal } from "./ItemModal";
import { useLangParam } from "./shared";
import "./community.css";

type Tab = "browse" | "installed" | "share" | "device";
const TABS: Tab[] = ["browse", "installed", "share", "device"];

type Open = { entry: CatalogEntry } | { preview: InstallPreview } | null;

export default function CommunityPage() {
  const t = useT();
  const route = useRoute();
  const tab: Tab = TABS.includes(route[1] as Tab) ? (route[1] as Tab) : "browse";
  const setTab = (v: Tab) => navigate(v === "browse" ? "community" : `community/${v}`);
  const [open, setOpen] = useState<Open>(null);
  useLangParam();

  const installedCount = useCommunity((s) => Object.keys(s.installed).length);
  const updates = useCommunity((s) => (s.index ? s.updates().length : 0));
  const pendingImport = useCommunity((s) => s.pendingImport);
  const pendingError = useCommunity((s) => s.pendingImportError);
  const clearPending = useCommunity((s) => s.clearPendingImport);

  useEffect(() => {
    if (!useCommunity.getState().index && !useCommunity.getState().loading) void useCommunity.getState().refresh();
  }, []);

  // Screenshot/demo switch: `?open=<kind>:<id>` opens an item's detail dialog.
  const index = useCommunity((s) => s.index);
  useEffect(() => {
    const q = window.location.hash.split("?")[1];
    const want = new URLSearchParams(window.location.search).get("open") ?? (q ? new URLSearchParams(q).get("open") : null);
    if (!want || !index) return;
    const [kind, id] = want.split(":");
    const entry = index.entries.find((e) => e.kind === kind && e.id === id);
    if (entry) setOpen({ entry });
  }, [index]);

  return (
    <Page title={t("community.title")} description={t("community.subtitle")} actions={tab === "browse" ? <SourceIndicator /> : undefined}>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "browse", label: t("community.page.tabs.browse"), icon: <Compass size={15} /> },
          {
            value: "installed",
            label: (
              <>
                {t("community.page.tabs.installed")}
                {installedCount > 0 && <span className={`community-tab-count${updates ? " community-tab-count--hot" : ""}`}>{updates || installedCount}</span>}
              </>
            ),
            icon: <PackageCheck size={15} />,
          },
          { value: "share", label: t("community.page.tabs.share"), icon: <Share2 size={15} /> },
          { value: "device", label: t("community.page.tabs.device"), icon: <Usb size={15} /> },
        ]}
      />

      {tab === "browse" && <Browse onOpen={(entry) => setOpen({ entry })} />}
      {tab === "installed" && <Installed onOpen={(entry) => setOpen({ entry })} onBrowse={() => setTab("browse")} />}
      {tab === "share" && <Share onReview={(preview) => setOpen({ preview })} />}
      {tab === "device" && <AddDevice />}

      {open && "entry" in open && <ItemModal key={`${open.entry.kind}:${open.entry.id}`} entry={open.entry} onClose={() => setOpen(null)} />}
      {open && "preview" in open && <ItemModal preview={open.preview} onClose={() => setOpen(null)} />}

      {/* Items opened from keyhalo:// links or ?import= */}
      {!open && pendingImport && <ItemModal key={`pending:${pendingImport.kind}:${pendingImport.id}`} preview={pendingImport} onClose={clearPending} />}
      {pendingError && !pendingImport && (
        <Modal
          open
          onClose={clearPending}
          title={t("community.page.linkFailedTitle")}
          footer={
            <Button variant="primary" onClick={clearPending}>
              {t("common.close")}
            </Button>
          }
        >
          <div className="community-callout community-callout--danger">
            <TriangleAlert />
            <div>{t("community.import.failed", { message: communityErrorMessage(pendingError) })}</div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
