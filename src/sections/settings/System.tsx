import { useRef, useState } from "react";
import { BookOpen, Check, Copy, Database, Download, Eye, EyeOff, FolderOpen, Globe, Heart, Info, Network, Plug, RefreshCw, RotateCcw, Scale, ShieldCheck, TriangleAlert, Upload, Wand2 } from "lucide-react";
import { Badge, Button, Input, Modal, Toggle, toast } from "@/ui";
import { useT } from "@/i18n";
import { Logo } from "@/app/Logo";
import { backend, isTauri } from "@/core/backend";
import { REPO_URL, SITE_URL, useCommunity } from "@/core/community";
import { useRules } from "@/core/automation";
import { useKeymaps } from "@/core/keymaps";
import { useProfiles } from "@/core/lighting";
import { DEFAULT_SETTINGS, useSettings } from "@/core/state/settings";
import type { Settings } from "@/core/types";
import { GitHubAccount } from "../community/Account";
import { GitHubMark } from "../community/shared";
import { Note, Row, Section } from "./parts";

const useS = () => useSettings((s) => s.settings);
const update = (patch: Partial<Settings>) => useSettings.getState().update(patch);
const OPENRGB_DEFAULTS = { enabled: false, host: "127.0.0.1", port: 6742 };

// ---------------------------------------------------------------------------
// Hardware safety
// ---------------------------------------------------------------------------

/** RGB / peripheral software that fights over the same devices. Matched case-insensitively. */
const CONFLICTS: { name: string; processes: string[]; tip: "close" | "bridge" }[] = [
  { name: "Razer Synapse / Razer Central", processes: ["RazerAppEngine.exe", "Razer Synapse 3.exe", "Razer Synapse.exe", "RzSynapse.exe", "Razer Central.exe"], tip: "close" },
  { name: "Corsair iCUE", processes: ["iCUE.exe", "Corsair.Service.exe"], tip: "close" },
  { name: "SignalRGB", processes: ["SignalRgb.exe", "SignalRgbLauncher.exe"], tip: "close" },
  { name: "OpenRGB", processes: ["OpenRGB.exe"], tip: "bridge" },
  { name: "ASUS Armoury Crate", processes: ["ArmouryCrate.exe", "ArmouryCrate.Service.exe", "ArmouryCrate.UserSessionHelper.exe", "LightingService.exe"], tip: "close" },
  { name: "Logitech G HUB", processes: ["lghub.exe", "lghub_agent.exe", "lghub_system_tray.exe"], tip: "close" },
];

export function SafetySection() {
  const t = useT();
  const s = useS();
  const [scan, setScan] = useState<{ busy: boolean; found?: { name: string; procs: string[]; tip: "close" | "bridge" }[]; at?: number }>({ busy: false });

  async function runScan() {
    setScan({ busy: true });
    try {
      const running = new Set((await backend.processes()).map((p) => p.toLowerCase()));
      const found = CONFLICTS.map((c) => ({ name: c.name, tip: c.tip, procs: c.processes.filter((p) => running.has(p.toLowerCase())) })).filter((c) => c.procs.length);
      setScan({ busy: false, found, at: Date.now() });
    } catch (e) {
      setScan({ busy: false });
      toast(String((e as Error)?.message ?? e), "danger");
    }
  }

  return (
    <Section id="safety" icon={<ShieldCheck />} title={t("settings.nav.safety")} desc={t("settings.safety.desc")}>
      <Row title={t("settings.safety.safeMode")} hint={t("settings.safety.safeModeHint")}>
        <Toggle checked={s.safeMode} onChange={(safeMode) => update({ safeMode })} />
      </Row>
      {s.safeMode && (
        <Note tone="warn" icon={<TriangleAlert />}>
          {t("settings.safety.safeModeOn")}
        </Note>
      )}
      <Note tone="ok" icon={<ShieldCheck />}>
        <strong>{t("settings.safety.noFirmware")}</strong> {t("settings.safety.noFirmwareText")}
      </Note>
      <Row title={t("settings.safety.conflicts")} hint={t("settings.safety.conflictsHint")}>
        <Button size="sm" icon={<RefreshCw className={scan.busy ? "settings-spin" : undefined} />} onClick={runScan} disabled={scan.busy}>
          {scan.found ? t("settings.safety.scanAgain") : t("settings.safety.scan")}
        </Button>
      </Row>
      {scan.found && (
        <div className="settings-conflicts">
          {scan.found.length === 0 ? (
            <div className="settings-conflict settings-conflict--ok">
              <Check />
              <span>{t("settings.safety.noConflicts")}</span>
            </div>
          ) : (
            scan.found.map((c) => (
              <div key={c.name} className="settings-conflict">
                <TriangleAlert className={c.tip === "bridge" ? "settings-c-info" : "settings-c-warn"} />
                <div className="grow">
                  <div className="settings-conflict__name">
                    {c.name} <span className="mono subtle">{c.procs.join(", ")}</span>
                  </div>
                  <div className="settings-conflict__tip">{t(`settings.safety.tip.${c.tip}`)}</div>
                </div>
                <Badge tone={c.tip === "bridge" ? "info" : "warning"}>{c.tip === "bridge" ? t("settings.safety.compatible") : t("settings.safety.running")}</Badge>
              </div>
            ))
          )}
          <div className="settings-conflict settings-conflict--muted">
            <Info />
            <div className="grow">
              <div className="settings-conflict__name">{t("settings.safety.dynamicLighting")}</div>
              <div className="settings-conflict__tip">{t("settings.safety.dynamicLightingTip")}</div>
            </div>
            {isTauri && (
              <Button size="sm" variant="ghost" onClick={() => backend.openPath("ms-settings:personalization-lighting")}>
                {t("settings.safety.openWindowsSettings")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// OpenRGB bridge
// ---------------------------------------------------------------------------

export function OpenRgbSection() {
  const t = useT();
  const s = useS();
  const cfg = { ...OPENRGB_DEFAULTS, ...(s.openrgb ?? {}) };
  const set = (patch: Partial<typeof cfg>) => update({ openrgb: { ...cfg, ...patch } });
  return (
    <Section id="openrgb" icon={<Network />} title={t("settings.nav.openrgb")} desc={t("settings.openrgb.desc")}>
      <Row title={t("settings.openrgb.enabled")} hint={t("settings.openrgb.enabledHint")}>
        <Toggle checked={cfg.enabled} onChange={(enabled) => set({ enabled })} />
      </Row>
      <Row title={t("settings.openrgb.server")} hint={t("settings.openrgb.serverHint")}>
        <div className="settings-hostport">
          <Input value={cfg.host} disabled={!cfg.enabled} onChange={(e) => set({ host: e.target.value.trim() })} spellCheck={false} aria-label={t("settings.openrgb.host")} />
          <span className="subtle">:</span>
          <Input
            type="number"
            value={cfg.port}
            min={1}
            max={65535}
            disabled={!cfg.enabled}
            onChange={(e) => set({ port: Math.max(1, Math.min(65535, Number(e.target.value) || OPENRGB_DEFAULTS.port)) })}
            aria-label={t("settings.openrgb.port")}
          />
        </div>
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Local API
// ---------------------------------------------------------------------------

function randomToken() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function ApiSection() {
  const t = useT();
  const s = useS();
  const [show, setShow] = useState(false);
  const [port, setPort] = useState(String(s.api.port));
  const set = (patch: Partial<Settings["api"]>) => update({ api: { ...s.api, ...patch } });
  const base = `http://127.0.0.1:${s.api.port}/api/v1`;
  return (
    <Section
      id="api"
      icon={<Plug />}
      title={t("settings.nav.api")}
      desc={t("settings.api.desc")}
      actions={
        <Button size="sm" variant="ghost" icon={<BookOpen />} onClick={() => backend.openPath(`${REPO_URL}/blob/main/docs/LOCAL_API.md`)}>
          {t("settings.api.docs")}
        </Button>
      }
    >
      <Row title={t("settings.api.enabled")} hint={t("settings.api.enabledHint")}>
        <Toggle checked={s.api.enabled} onChange={(enabled) => set({ enabled })} />
      </Row>
      <Row title={t("settings.api.port")} hint={<span className="mono">{base}</span>}>
        <Input
          type="number"
          value={port}
          min={1024}
          max={65535}
          style={{ width: 110 }}
          disabled={!s.api.enabled}
          onChange={(e) => setPort(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(port));
            if (n >= 1024 && n <= 65535) set({ port: n });
            else setPort(String(s.api.port));
          }}
        />
      </Row>
      <Row title={t("settings.api.token")} hint={s.api.token ? t("settings.api.tokenHint") : t("settings.api.noToken")}>
        <div className="settings-token">
          <Input
            type={show ? "text" : "password"}
            value={s.api.token}
            placeholder={t("settings.api.tokenPlaceholder")}
            onChange={(e) => set({ token: e.target.value.trim() })}
            spellCheck={false}
            className="mono"
          />
          <Button size="sm" iconOnly variant="ghost" icon={show ? <EyeOff /> : <Eye />} title={show ? t("settings.api.hide") : t("settings.api.show")} onClick={() => setShow(!show)} />
          <Button
            size="sm"
            iconOnly
            variant="ghost"
            icon={<Copy />}
            title={t("common.copy")}
            disabled={!s.api.token}
            onClick={() => navigator.clipboard.writeText(s.api.token).then(() => toast(t("common.copied")))}
          />
          <Button size="sm" icon={<Wand2 />} onClick={() => set({ token: randomToken() })}>
            {t("settings.api.generate")}
          </Button>
        </div>
      </Row>
      {s.api.enabled && !s.api.token && (
        <Note tone="warn" icon={<TriangleAlert />}>
          {t("settings.api.warning")}
        </Note>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export function GitHubSection() {
  const t = useT();
  const s = useS();
  const [clientId, setClientId] = useState(s.github.clientId ?? "");
  const signedIn = useCommunity((x) => x.auth.status === "signedIn");
  return (
    <Section id="github" icon={<GitHubMark size={16} />} title={t("settings.nav.github")} desc={t("settings.github.desc")}>
      <div className="settings-pad">
        <GitHubAccount compact />
      </div>
      {signedIn && (
        <Note icon={<Info />}>{t("community.auth.storedLocally")}</Note>
      )}
      <Row title={t("community.auth.clientIdLabel")} hint={t("settings.github.clientIdHint")}>
        <Input
          value={clientId}
          placeholder="Ov23li…"
          className="mono"
          style={{ width: 240 }}
          spellCheck={false}
          onChange={(e) => setClientId(e.target.value)}
          onBlur={() => update({ github: { ...useSettings.getState().settings.github, clientId: clientId.trim() || undefined } })}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Data: backup, restore, reset
// ---------------------------------------------------------------------------

interface Backup {
  app: "keyhalo";
  kind: "backup";
  version: string;
  exportedAt: string;
  settings: Partial<Settings>;
  profiles: unknown[];
  keymaps: unknown[];
  rules: unknown[];
}

function buildBackup(version: string): Backup {
  const settings = structuredClone(useSettings.getState().settings) as Partial<Settings>;
  // Never put the GitHub token in a file people may share.
  settings.github = { clientId: settings.github?.clientId };
  const ps = useProfiles.getState();
  const profiles = (ps.profiles ?? []).filter((p) => ps.sources?.[p.id] === "user");
  const keymaps = useKeymaps.getState().user ?? [];
  let rules: unknown[] = [];
  try {
    rules = JSON.parse(useRules.getState().exportRules()) as unknown[];
    if (!Array.isArray(rules)) rules = [rules];
  } catch {
    rules = [];
  }
  return { app: "keyhalo", kind: "backup", version, exportedAt: new Date().toISOString(), settings, profiles, keymaps, rules };
}

async function saveFile(name: string, contents: string) {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return false;
    await backend.writeFile(path, contents);
    return true;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function DataSection({ version }: { version: string }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [restore, setRestore] = useState<Backup | null>(null);

  async function exportAll() {
    try {
      const b = buildBackup(version);
      const ok = await saveFile(`keyhalo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b, null, 2));
      if (ok) toast(t("settings.data.exported", { profiles: b.profiles.length, keymaps: b.keymaps.length, rules: b.rules.length }));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "danger");
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Backup;
      if (!data || data.app !== "keyhalo" || data.kind !== "backup") throw new Error(t("settings.data.notBackup"));
      setRestore(data);
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "danger");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function applyRestore(b: Backup) {
    setRestore(null);
    let profiles = 0;
    let keymaps = 0;
    let rules = 0;
    if (b.settings && typeof b.settings === "object") {
      const cur = useSettings.getState().settings;
      const { github: _skip, ...rest } = b.settings;
      update({ ...rest, github: { ...cur.github, clientId: b.settings.github?.clientId ?? cur.github.clientId } });
    }
    for (const p of b.profiles ?? []) {
      try {
        useProfiles.getState().importJson(JSON.stringify(p));
        profiles++;
      } catch {
        /* skip invalid */
      }
    }
    for (const k of b.keymaps ?? []) {
      try {
        const r = await useKeymaps.getState().importPack(k);
        if (r.ok) keymaps++;
      } catch {
        /* skip */
      }
    }
    if (b.rules?.length) {
      try {
        rules = useRules.getState().importRules(b.rules).rules.length;
      } catch {
        /* skip */
      }
    }
    toast(t("settings.data.restored", { profiles, keymaps, rules }));
  }

  function reset() {
    const cur = useSettings.getState().settings;
    update({ ...DEFAULT_SETTINGS, language: cur.language, github: cur.github });
    void backend.appSetCloseToTray(DEFAULT_SETTINGS.minimizeToTray).catch(() => {});
    setConfirmReset(false);
    toast(t("settings.data.resetDone"));
  }

  async function openFolder() {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      await backend.openPath(await appDataDir());
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "danger");
    }
  }

  return (
    <Section id="data" icon={<Database />} title={t("settings.nav.data")} desc={t("settings.data.desc")}>
      {isTauri && (
        <Row title={t("settings.data.folder")} hint={t("settings.data.folderHint")}>
          <Button size="sm" icon={<FolderOpen />} onClick={openFolder}>
            {t("settings.data.openFolder")}
          </Button>
        </Row>
      )}
      <Row title={t("settings.data.export")} hint={t("settings.data.exportHint")}>
        <Button size="sm" icon={<Download />} onClick={exportAll}>
          {t("settings.data.exportAction")}
        </Button>
      </Row>
      <Row title={t("settings.data.import")} hint={t("settings.data.importHint")}>
        <Button size="sm" icon={<Upload />} onClick={() => fileRef.current?.click()}>
          {t("settings.data.importAction")}
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
      </Row>
      <Row title={t("settings.data.reset")} hint={t("settings.data.resetHint")}>
        <Button size="sm" variant="danger" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
          {t("settings.data.resetAction")}
        </Button>
      </Row>

      {confirmReset && (
        <Modal
          open
          onClose={() => setConfirmReset(false)}
          title={t("settings.data.resetTitle")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={reset}>
                {t("settings.data.resetAction")}
              </Button>
            </>
          }
        >
          <p className="settings-modal-text">{t("settings.data.resetConfirm")}</p>
        </Modal>
      )}
      {restore && (
        <Modal
          open
          onClose={() => setRestore(null)}
          title={t("settings.data.restoreTitle")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRestore(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={() => applyRestore(restore)}>
                {t("settings.data.restoreAction")}
              </Button>
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <p className="settings-modal-text">{t("settings.data.restoreIntro", { date: new Date(restore.exportedAt).toLocaleString(), version: restore.version })}</p>
            <div className="settings-restore">
              <span>{t("settings.data.restoreSettings")}</span>
              <span>{t("settings.data.restoreProfiles", { count: restore.profiles?.length ?? 0 })}</span>
              <span>{t("settings.data.restoreKeymaps", { count: restore.keymaps?.length ?? 0 })}</span>
              <span>{t("settings.data.restoreRules", { count: restore.rules?.length ?? 0 })}</span>
            </div>
            <p className="settings-modal-text subtle">{t("settings.data.restoreNote")}</p>
          </div>
        </Modal>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

export function AboutSection({ version }: { version: string }) {
  const t = useT();
  const links = [
    { icon: <GitHubMark size={15} />, label: "GitHub", url: REPO_URL },
    { icon: <Globe />, label: t("settings.about.website"), url: SITE_URL },
    { icon: <Scale />, label: t("settings.about.license"), url: `${REPO_URL}/blob/main/LICENSE` },
    { icon: <Heart />, label: t("settings.about.contribute"), url: `${REPO_URL}/blob/main/CONTRIBUTING.md` },
  ];
  return (
    <Section id="about" icon={<Info />} title={t("settings.nav.about")}>
      <div className="settings-about">
        <div className="settings-about__brand">
          <Logo size={52} />
          <div>
            <div className="settings-about__name">KeyHalo</div>
            <div className="settings-about__ver mono">v{version || "…"}{!isTauri && ` · ${t("settings.about.demo")}`}</div>
            <div className="settings-about__tag">{t("settings.about.tagline")}</div>
          </div>
        </div>
        <div className="settings-about__links">
          {links.map((l) => (
            <button key={l.label} type="button" className="settings-about__link" onClick={() => backend.openPath(l.url)}>
              {l.icon}
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-credits">
        <div className="settings-credits__title">{t("settings.about.credits")}</div>
        <ul>
          <li>
            <strong>OpenRazer</strong> &amp; <strong>OpenRGB</strong> — {t("settings.about.creditProtocols")}
          </li>
          <li>
            <strong>Kanata</strong> — {t("settings.about.creditKanata")}
          </li>
          <li>
            <strong>Tauri</strong>, <strong>React</strong>, <strong>zustand</strong>, <strong>Lucide</strong>, <strong>Inter</strong> — {t("settings.about.creditStack")}
          </li>
        </ul>
        <p className="settings-credits__mit">{t("settings.about.mit")}</p>
      </div>
    </Section>
  );
}
