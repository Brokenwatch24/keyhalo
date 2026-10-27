import { useEffect, useState } from "react";
import { Accessibility, ArrowUpRight, Check, Eraser, Keyboard, Monitor, Moon, Plus, RefreshCw, Settings2, Sun, X } from "lucide-react";
import { Badge, Button, Input, Modal, Segmented, Select, Slider, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { backend, isTauri } from "@/core/backend";
import { REPO, REPO_URL } from "@/core/community";
import { STATUS_PALETTES } from "@/core/lighting";
import { useSettings } from "@/core/state/settings";
import { useStats } from "@/core/stats";
import { bus } from "@/core/util/bus";
import { checkForUpdates, installUpdate, useUpdates } from "@/core/updates";
import type { ColorVision, Settings, ThemeMode } from "@/core/types";
import { compareVersions, Note, Row, Section } from "./parts";

const useS = () => useSettings((s) => s.settings);
const update = (patch: Partial<Settings>) => useSettings.getState().update(patch);

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

type UpdateState = { status: "idle" | "checking" } | { status: "latest" | "available"; version: string; url: string } | { status: "none" } | { status: "error"; message: string };

export function GeneralSection({ version }: { version: string }) {
  const t = useT();
  const s = useS();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [upd, setUpd] = useState<UpdateState>({ status: "idle" });

  // Sync "Start with Windows" with the OS state (desktop only).
  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/plugin-autostart")
      .then((m) => m.isEnabled())
      .then((on) => {
        setAutostart(on);
        if (on !== useSettings.getState().settings.startWithWindows) update({ startWithWindows: on });
      })
      .catch(() => setAutostart(null));
  }, []);

  async function setStartWithWindows(on: boolean) {
    update({ startWithWindows: on });
    if (!isTauri) return;
    try {
      const m = await import("@tauri-apps/plugin-autostart");
      await (on ? m.enable() : m.disable());
      setAutostart(await m.isEnabled());
    } catch (e) {
      update({ startWithWindows: !on });
      toast(t("settings.general.autostartFailed", { message: String((e as Error)?.message ?? e) }), "danger");
    }
  }

  async function setTray(on: boolean) {
    update({ minimizeToTray: on });
    try {
      await backend.appSetCloseToTray(on);
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "danger");
    }
  }

  async function checkNow() {
    setUpd({ status: "checking" });
    try {
      const res = await backend.httpRequest({
        method: "GET",
        url: `https://api.github.com/repos/${REPO}/releases/latest`,
        headers: { Accept: "application/vnd.github+json" },
        timeoutMs: 10_000,
      });
      if (res.status === 404) return setUpd({ status: "none" });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const rel = JSON.parse(res.body) as { tag_name?: string; html_url?: string };
      const latest = (rel.tag_name ?? "").replace(/^v/i, "");
      const url = rel.html_url ?? `${REPO_URL}/releases/latest`;
      setUpd({ status: latest && compareVersions(latest, version) > 0 ? "available" : "latest", version: latest || version, url });
    } catch (e) {
      setUpd({ status: "error", message: String((e as Error)?.message ?? e) });
    }
  }

  return (
    <Section id="general" icon={<Settings2 />} title={t("settings.nav.general")} desc={t("settings.general.desc")}>
      <Row title={t("settings.general.language")} hint={t("settings.general.languageHint")}>
        <Select<Settings["language"]>
          value={s.language}
          onChange={(language) => update({ language })}
          options={[
            { value: "en", label: "English" },
            { value: "es", label: "Español" },
          ]}
          style={{ width: 180 }}
        />
      </Row>
      <Row title={t("settings.general.theme")} hint={t("settings.general.themeHint")}>
        <Segmented<ThemeMode>
          value={s.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "system", label: t("settings.general.themes.system"), icon: <Monitor /> },
            { value: "light", label: t("settings.general.themes.light"), icon: <Sun /> },
            { value: "dark", label: t("settings.general.themes.dark"), icon: <Moon /> },
          ]}
        />
      </Row>
      <Row
        title={t("settings.general.startWithWindows")}
        hint={isTauri ? t("settings.general.startWithWindowsHint") : t("settings.general.desktopOnly")}
      >
        <Toggle checked={autostart ?? s.startWithWindows} onChange={setStartWithWindows} disabled={!isTauri} />
      </Row>
      <Row title={t("settings.general.tray")} hint={t("settings.general.trayHint")}>
        <Toggle checked={s.minimizeToTray} onChange={setTray} />
      </Row>
      <Row title={t("settings.general.updates")} hint={t("settings.general.updatesHint")}>
        <Toggle checked={s.checkUpdates} onChange={(checkUpdates) => update({ checkUpdates })} />
      </Row>
      <Row
        title={
          <span className="row" style={{ gap: 8 }}>
            {t("settings.general.version")}
            <span className="mono settings-version">{version || "…"}</span>
          </span>
        }
        hint={isTauri ? <AutoUpdateLine /> : <UpdateLine upd={upd} />}
      >
        {isTauri ? <AutoUpdateButton /> : (
          <Button size="sm" icon={<RefreshCw className={upd.status === "checking" ? "settings-spin" : undefined} />} onClick={checkNow} disabled={upd.status === "checking"}>
            {upd.status === "checking" ? t("settings.general.checking") : t("settings.general.checkNow")}
          </Button>
        )}
      </Row>
    </Section>
  );
}

/** Desktop app: status of the built-in updater (src/core/updates.ts). */
function AutoUpdateLine() {
  const t = useT();
  const u = useUpdates();
  switch (u.status) {
    case "latest":
      return (
        <span className="settings-inline settings-inline--ok">
          <Check size={13} /> {t("settings.general.upToDate")}
        </span>
      );
    case "downloading":
      return <span>{t("settings.general.downloading", { version: u.version ?? "", percent: Math.round((u.progress ?? 0) * 100) })}</span>;
    case "ready":
      return (
        <Badge tone="info" dot>
          {t("settings.general.ready", { version: u.version ?? "" })}
        </Badge>
      );
    case "installing":
      return <span>{t("settings.general.installing")}</span>;
    case "error":
      return <span className="settings-inline settings-inline--danger">{t("settings.general.checkFailed", { message: u.error ?? "" })}</span>;
    default:
      return <span>{t("settings.general.autoUpdateHint")}</span>;
  }
}

function AutoUpdateButton() {
  const t = useT();
  const status = useUpdates((s) => s.status);
  if (status === "ready" || status === "installing")
    return (
      <Button size="sm" variant="primary" icon={<RefreshCw />} onClick={() => void installUpdate()} disabled={status === "installing"}>
        {t("settings.general.restartToUpdate")}
      </Button>
    );
  const busy = status === "checking" || status === "downloading";
  return (
    <Button size="sm" icon={<RefreshCw className={busy ? "settings-spin" : undefined} />} onClick={() => void checkForUpdates()} disabled={busy}>
      {busy ? t("settings.general.checking") : t("settings.general.checkNow")}
    </Button>
  );
}

function UpdateLine({ upd }: { upd: UpdateState }) {
  const t = useT();
  switch (upd.status) {
    case "latest":
      return (
        <span className="settings-inline settings-inline--ok">
          <Check size={13} /> {t("settings.general.upToDate")}
        </span>
      );
    case "available":
      return (
        <span className="settings-inline">
          <Badge tone="info" dot>
            {t("settings.general.available", { version: upd.version })}
          </Badge>
          <button type="button" className="settings-link" onClick={() => backend.openPath(upd.url)}>
            {t("settings.general.download")} <ArrowUpRight size={12} />
          </button>
        </span>
      );
    case "none":
      return <span>{t("settings.general.noReleases")}</span>;
    case "error":
      return <span className="settings-inline settings-inline--danger">{t("settings.general.checkFailed", { message: upd.message })}</span>;
    default:
      return <span>{t("settings.general.versionHint")}</span>;
  }
}

// ---------------------------------------------------------------------------
// Lighting & accessibility
// ---------------------------------------------------------------------------

const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export function LightingSection() {
  const t = useT();
  const s = useS();
  const palette = STATUS_PALETTES[s.colorVision] ?? STATUS_PALETTES.normal;
  return (
    <Section id="lighting" icon={<Accessibility />} title={t("settings.nav.lighting")} desc={t("settings.lighting.desc")}>
      <Row title={t("settings.lighting.reduceFlashing")} hint={t("settings.lighting.reduceFlashingHint")}>
        <Toggle checked={s.reduceFlashing} onChange={(reduceFlashing) => update({ reduceFlashing })} />
      </Row>
      <Row title={t("settings.lighting.colorVision")} hint={t("settings.lighting.colorVisionHint")}>
        <div className="settings-cv">
          <div className="settings-swatches" aria-label={t("settings.lighting.statusPreview")}>
            {(["good", "warn", "bad", "info"] as const).map((k) => (
              <span key={k} className="settings-swatch" title={t(`settings.lighting.status.${k}`)}>
                <span className="settings-swatch__key" style={{ ["--c" as string]: rgb(palette[k]) }} />
                <span className="settings-swatch__label">{t(`settings.lighting.status.${k}`)}</span>
              </span>
            ))}
          </div>
          <Select<ColorVision>
            value={s.colorVision}
            onChange={(colorVision) => update({ colorVision })}
            options={(["normal", "protanopia", "deuteranopia", "tritanopia"] as const).map((v) => ({ value: v, label: t(`settings.lighting.cv.${v}`) }))}
            style={{ width: 210 }}
          />
        </div>
      </Row>
      <Row title={t("settings.lighting.hud")} hint={t("settings.lighting.hudHint")}>
        <Toggle checked={s.hud.enabled} onChange={(enabled) => update({ hud: { ...s.hud, enabled } })} />
      </Row>
      <Row title={t("settings.lighting.hudPosition")}>
        <Segmented<"top" | "bottom">
          value={s.hud.position}
          onChange={(position) => update({ hud: { ...s.hud, position } })}
          options={[
            { value: "top", label: t("settings.lighting.top") },
            { value: "bottom", label: t("settings.lighting.bottom") },
          ]}
        />
      </Row>
      <Row title={t("settings.lighting.hudDuration")} hint={t("settings.lighting.hudDurationHint")}>
        <div className="settings-slider">
          <Slider
            value={s.hud.durationMs}
            min={600}
            max={5000}
            step={100}
            format={(v) => `${(v / 1000).toFixed(1)} s`}
            onChange={(durationMs) => update({ hud: { ...s.hud, durationMs } })}
            label=""
          />
          <Button
            size="sm"
            disabled={!s.hud.enabled}
            onClick={() => bus.emit("hud", { title: "KeyHalo", value: t("settings.lighting.hudSample"), icon: "info", durationMs: s.hud.durationMs })}
          >
            {t("settings.lighting.preview")}
          </Button>
        </div>
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Input & privacy
// ---------------------------------------------------------------------------

export function InputSection() {
  const t = useT();
  const s = useS();
  const lifetime = useStats((x) => (x as { lifetime?: { keys: number } }).lifetime);
  const [confirmClear, setConfirmClear] = useState(false);
  const [app, setApp] = useState("");
  const fmt = new Intl.NumberFormat(s.language);

  function addApp() {
    const v = app.trim();
    if (!v) return;
    const name = /\.exe$/i.test(v) ? v : `${v}.exe`;
    if (!s.remapPauseApps.some((a) => a.toLowerCase() === name.toLowerCase())) update({ remapPauseApps: [...s.remapPauseApps, name] });
    setApp("");
  }

  return (
    <Section id="input" icon={<Keyboard />} title={t("settings.nav.input")} desc={t("settings.input.desc")}>
      <Row title={t("settings.input.stats")} hint={t("settings.input.statsHint")}>
        <Toggle checked={s.inputStats} onChange={(inputStats) => update({ inputStats })} />
      </Row>
      <Note tone="ok" icon={<Check />}>
        {t("settings.input.privacy")}
      </Note>
      <Row
        title={t("settings.input.clear")}
        hint={lifetime?.keys ? t("settings.input.clearHintCount", { keys: fmt.format(lifetime.keys) }) : t("settings.input.clearHint")}
      >
        <Button size="sm" variant="danger" icon={<Eraser />} onClick={() => setConfirmClear(true)}>
          {t("settings.input.clearAction")}
        </Button>
      </Row>
      <Row title={t("settings.input.cheatsheet")} hint={t("settings.input.cheatsheetHint")}>
        <Toggle checked={s.cheatsheet} onChange={(cheatsheet) => update({ cheatsheet })} />
      </Row>
      <Row title={t("settings.input.remap")} hint={t("settings.input.remapHint")}>
        <Toggle checked={s.remapEnabled} onChange={(remapEnabled) => update({ remapEnabled })} />
      </Row>
      <Row title={t("settings.input.pauseApps")} hint={t("settings.input.pauseAppsHint")} stack>
        <div className="settings-apps">
          {s.remapPauseApps.map((a) => (
            <span key={a} className="settings-app mono">
              {a}
              <button type="button" aria-label={t("common.delete")} onClick={() => update({ remapPauseApps: s.remapPauseApps.filter((x) => x !== a) })}>
                <X />
              </button>
            </span>
          ))}
          <span className="settings-app-add">
            <Input value={app} placeholder="Game.exe" onChange={(e) => setApp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addApp()} />
            <Button size="sm" iconOnly icon={<Plus />} title={t("common.add")} onClick={addApp} disabled={!app.trim()} />
          </span>
        </div>
      </Row>
      {confirmClear && (
        <Modal
          open
          onClose={() => setConfirmClear(false)}
          title={t("settings.input.clearTitle")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  setConfirmClear(false);
                  try {
                    await useStats.getState().clearAll();
                    toast(t("settings.input.cleared"));
                  } catch (e) {
                    toast(String((e as Error)?.message ?? e), "danger");
                  }
                }}
              >
                {t("settings.input.clearAction")}
              </Button>
            </>
          }
        >
          <p className="settings-modal-text">{t("settings.input.clearConfirm")}</p>
        </Modal>
      )}
    </Section>
  );
}
