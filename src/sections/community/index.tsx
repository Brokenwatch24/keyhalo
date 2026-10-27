import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.community")}>
      <EmptyState title={t("nav.community")}>Coming together…</EmptyState>
    </Page>
  );
}
