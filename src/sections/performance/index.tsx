import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.performance")}>
      <EmptyState title={t("nav.performance")}>Coming together…</EmptyState>
    </Page>
  );
}
