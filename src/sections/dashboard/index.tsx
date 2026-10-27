import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.dashboard")}>
      <EmptyState title={t("nav.dashboard")}>Coming together…</EmptyState>
    </Page>
  );
}
