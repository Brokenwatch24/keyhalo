import { ExternalLink, Minus, X } from "lucide-react";
import { Badge, Button } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { GRID, parseButton, previewColor } from "@/core/pads";
import { appColor, refreshWindows, toolName, useOpenWindows, windowLabel, WINDOW_TOOLS } from "@/core/pads/windows";
import { Head } from "./Inspector";

/** Inspector for the Windows page: the selected window, or what a top button does. */
export function WindowsEditor({ selected }: { selected: string }) {
  const t = useT();
  const b = parseButton(selected);
  const slot = b && b.kind === "g" ? b.y * GRID + b.x : -1;
  const win = useOpenWindows((s) => s.windows.find((w) => w.slot === slot));
  const front = useOpenWindows((s) => s.front);
  const act = (p: Promise<unknown>) => void p.catch(() => {}).then(() => refreshWindows());

  if (b?.kind === "t") {
    const tool = WINDOW_TOOLS[b.x];
    return (
      <>
        <Head kicker={t("pads.windows.tool")} title={tool ? toolName(tool.key) : "—"} />
        <div className="pads-insp__section">
          {tool && <p className="pads-note">{t(`pads.windows.toolHints.${tool.key}`)}</p>}
          {tool && (
            <div>
              <Button size="sm" onClick={() => tool.run()}>
                {toolName(tool.key)}
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }

  if (!win) {
    return (
      <>
        <Head kicker={t("pads.page.kinds.windows")} title={t("pads.windows.empty")} />
        <div className="pads-insp__section">
          <p className="pads-note">{t("pads.windows.emptyHint")}</p>
          <p className="pads-note">{t("pads.windows.hint")}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Head kicker={win.process.replace(/\.exe$/i, "")} title={windowLabel(win)}>
        {front === win.hwnd && (
          <Badge tone="info" dot>
            {t("pads.windows.front")}
          </Badge>
        )}
      </Head>
      <div className="pads-insp__section">
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="pads-agent-dot" style={{ ["--c" as string]: previewColor(appColor(win.process)) }} />
          <span className="pads-note" style={{ margin: 0 }}>
            {win.title}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="primary" icon={<ExternalLink />} onClick={() => act(backend.focusHwnd(win.hwnd))}>
            {t("pads.windows.focus")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Minus />} onClick={() => act(backend.windowCmd(win.hwnd, "minimize"))}>
            {t("pads.windows.minimize")}
          </Button>
          <Button size="sm" variant="ghost" icon={<X />} onClick={() => act(backend.windowCmd(win.hwnd, "close"))}>
            {t("pads.windows.close")}
          </Button>
        </div>
        <p className="pads-note">{t("pads.windows.hint")}</p>
      </div>
    </>
  );
}
