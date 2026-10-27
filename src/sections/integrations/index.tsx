import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.integrations")}>
      <EmptyState title={t("nav.integrations")}>Coming together…</EmptyState>
    </Page>
  );
}
