import { Page, EmptyState } from "@/ui";
import { useT } from "@/i18n";

export default function Section() {
  const t = useT();
  return (
    <Page title={t("nav.testbench")}>
      <EmptyState title={t("nav.testbench")}>Coming together…</EmptyState>
    </Page>
  );
}
