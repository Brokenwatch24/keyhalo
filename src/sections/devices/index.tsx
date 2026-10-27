import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.devices")}>
      <EmptyState title={t("nav.devices")}>Coming together…</EmptyState>
    </Page>
  );
}
