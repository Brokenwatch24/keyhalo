import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.automations")}>
      <EmptyState title={t("nav.automations")}>Coming together…</EmptyState>
    </Page>
  );
}
