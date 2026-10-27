import { useMemo } from "react";
import { ArrowRight, BadgeCheck, ExternalLink, Keyboard, Lightbulb, Mouse, Share2, Usb } from "lucide-react";
import { Badge, Button, Card, EmptyState, Stat } from "@/ui";
import { useT } from "@/i18n";
import { navigate } from "@/app/router";
import { backend } from "@/core/backend";
import { deviceReportUrl, deviceRequestUrl, REPO_URL, useCommunity } from "@/core/community";
import { useDevices } from "@/core/devices/store";
import { STATUS_TONE } from "./shared";

/** "Add your keyboard or mouse": entry to the Device wizard + device reports. */
export function AddDevice() {
  const t = useT();
  const devices = useDevices((s) => s.devices);
  const index = useCommunity((s) => s.index);
  const byStatus = useMemo(() => {
    const out = { verified: 0, community: 0, experimental: 0 };
    for (const e of index?.entries ?? []) if (e.kind === "device" && e.status) out[e.status]++;
    return out;
  }, [index]);

  const steps = [
    { icon: Usb, title: t("community.page.wizard.step1"), text: t("community.page.wizard.step1Text") },
    { icon: Lightbulb, title: t("community.page.wizard.step2"), text: t("community.page.wizard.step2Text") },
    { icon: Share2, title: t("community.page.wizard.step3"), text: t("community.page.wizard.step3Text") },
  ];

  return (
    <div className="community-adddev">
      <Card className="community-hero">
        <div className="community-hero__inner">
          <div className="community-hero__text">
            <div className="community-hero__eyebrow">{t("community.page.wizard.eyebrow")}</div>
            <h2 className="community-hero__title">{t("community.page.wizard.title")}</h2>
            <p className="community-hero__desc">{t("community.page.wizard.desc")}</p>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <Button variant="primary" icon={<ArrowRight />} onClick={() => navigate("devices/wizard")}>
                {t("community.page.wizard.open")}
              </Button>
              <Button variant="ghost" icon={<ExternalLink />} onClick={() => backend.openPath(`${REPO_URL}/blob/main/CONTRIBUTING.md#device-definitions`)}>
                {t("community.page.wizard.guide")}
              </Button>
            </div>
          </div>
          <ol className="community-hero__steps">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="community-hero__num">
                  <s.icon />
                </span>
                <div>
                  <div className="community-hero__step-title">{s.title}</div>
                  <div className="community-hero__step-text">{s.text}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <div className="community-adddev__grid">
        <Card flush title={t("community.page.wizard.connected")} subtitle={t("community.page.wizard.connectedHint")}>
          {devices.length ? (
            <div className="kh-list">
              {devices.map((d) => (
                <div key={d.uid} className="kh-list__row">
                  <span className="community-installed-row__icon">{d.definition.type === "mouse" ? <Mouse /> : <Keyboard />}</span>
                  <div className="grow">
                    <div className="community-installed-row__name">{d.definition.name}</div>
                    <div className="community-installed-row__meta">
                      {d.definition.vendor} · {d.definition.type}
                      {d.firmware ? ` · fw ${d.firmware}` : ""}
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[d.definition.status]} dot>
                    {t(`community.status.${d.definition.status}`)}
                  </Badge>
                  <Button size="sm" icon={<BadgeCheck />} onClick={() => backend.openPath(deviceReportUrl(d))}>
                    {t("community.report.worksOnMyDevice")}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Usb />} title={t("community.page.wizard.noDevices")} />
          )}
        </Card>

        <Card title={t("community.page.wizard.supportTitle")}>
          <div className="col" style={{ gap: 16 }}>
            <div className="grid-3" style={{ gap: 12 }}>
              <Stat label={t("community.status.verified")} value={byStatus.verified} />
              <Stat label={t("community.status.community")} value={byStatus.community} />
              <Stat label={t("community.status.experimental")} value={byStatus.experimental} />
            </div>
            <div className="community-status-legend">
              {(["verified", "community", "experimental"] as const).map((s) => (
                <div key={s} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <Badge tone={STATUS_TONE[s]} dot>
                    {t(`community.status.${s}`)}
                  </Badge>
                  <span className="community-note">{t(`community.page.wizard.statusHelp.${s}`)}</span>
                </div>
              ))}
            </div>
            <div className="community-divider" />
            <p className="community-note">{t("community.report.requestIntro")}</p>
            <div>
              <Button icon={<ExternalLink />} onClick={() => backend.openPath(deviceRequestUrl([]))}>
                {t("community.page.wizard.request")}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
