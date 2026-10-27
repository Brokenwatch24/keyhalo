import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.keymaps")}>
      <EmptyState title={t("nav.keymaps")}>Coming together…</EmptyState>
    </Page>
  );
}
