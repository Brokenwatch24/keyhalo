import { Keyboard } from "lucide-react";
import { Button } from "@/ui";
import { useT } from "@/i18n";
import { useKeymaps } from "@/core/keymaps";
import { appPack, appShortcuts, useAppPage } from "@/core/pads/appPage";
import { navigate } from "@/app/router";
import { Head } from "./Inspector";

/** Inspector for the App page: which app is in front and which shortcut pack fills the pads. */
export function AppEditor() {
  const t = useT();
  const { process, filter } = useAppPage();
  useKeymaps((s) => s.packs);
  const pack = appPack(process);
  const app = (process ?? "").replace(/\.exe$/i, "");
  return (
    <>
      <Head kicker={t("pads.app.current")} title={app || t("pads.app.waiting")} />
      <div className="pads-insp__section">
        {pack ? (
          <>
            <div>
              <div className="pads-note" style={{ margin: 0 }}>
                {t("pads.app.pack")}
              </div>
              <div>{pack.name}</div>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {Object.entries(pack.categories).map(([c, color]) => (
                <span key={c} className="row" style={{ gap: 4, alignItems: "center", opacity: !filter || filter === c ? 1 : 0.45 }}>
                  <span className="pads-agent-dot" style={{ ["--c" as string]: color }} />
                  {c}
                </span>
              ))}
            </div>
            <p className="pads-note">{t("pads.app.count", { n: appShortcuts(pack, filter).length })}</p>
          </>
        ) : (
          app && <p className="pads-note">{t("pads.app.noneHint")}</p>
        )}
        <p className="pads-note">{t("pads.app.hint")}</p>
        <div>
          <Button size="sm" variant="ghost" icon={<Keyboard />} onClick={() => navigate("keymaps")}>
            {t("pads.app.openKeymaps")}
          </Button>
        </div>
      </div>
    </>
  );
}
