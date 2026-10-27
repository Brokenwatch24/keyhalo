import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.settings")}>
      <EmptyState title={t("nav.settings")}>Coming together…</EmptyState>
    </Page>
  );
}
