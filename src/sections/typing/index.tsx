import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.typing")}>
      <EmptyState title={t("nav.typing")}>Coming together…</EmptyState>
    </Page>
  );
}
