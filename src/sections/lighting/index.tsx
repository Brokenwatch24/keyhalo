import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.lighting")}>
      <EmptyState title={t("nav.lighting")}>Coming together…</EmptyState>
    </Page>
  );
}
