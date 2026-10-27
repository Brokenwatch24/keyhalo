import { useState } from "react";
import { Copy, ExternalLink, KeyRound, LogOut, TriangleAlert } from "lucide-react";
import { Button, Field, Input, Modal, toast } from "@/ui";
import { useT } from "@/i18n";
import { backend } from "@/core/backend";
import { communityErrorMessage, useCommunity } from "@/core/community";
import { copyText, GitHubMark } from "./shared";

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=public_repo,gist&description=KeyHalo";

/** GitHub sign-in: device flow (code) when available, personal access token otherwise. */
export function GitHubAccount({ compact }: { compact?: boolean }) {
  const t = useT();
  const auth = useCommunity((s) => s.auth);
  const canDeviceFlow = useCommunity((s) => s.canUseDeviceFlow)();
  const [tokenOpen, setTokenOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  async function startDeviceFlow() {
    setStarting(true);
    setFlowError(null);
    try {
      const code = await useCommunity.getState().signIn();
      void backend.openPath(code.verificationUri).catch(() => {});
    } catch (e) {
      setFlowError(communityErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  if (auth.status === "signedIn")
    return (
      <div className="community-account">
        <div className="community-account__who">
          {auth.login ? <img className="community-avatar" src={`https://github.com/${auth.login}.png?size=96`} alt="" /> : <span className="community-avatar community-avatar--empty"><GitHubMark size={20} /></span>}
          <div className="grow">
            <div className="community-account__login">@{auth.login || "github"}</div>
            <div className="subtle" style={{ fontSize: "var(--text-sm)" }}>
              {t("community.auth.signedInAs", { login: auth.login })}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => useCommunity.getState().signOut()}>
            {t("community.auth.signOut")}
          </Button>
        </div>
        {!compact && <p className="community-note">{t("community.auth.storedLocally")}</p>}
      </div>
    );

  if (auth.status === "pending")
    return (
      <div className="community-account community-device-code">
        <div className="community-device-code__title">{t("community.auth.deviceTitle")}</div>
        <div className="community-device-code__steps">{t("community.auth.deviceSteps", { url: "github.com/login/device" })}</div>
        <div className="community-device-code__code mono">{auth.code.userCode}</div>
        <div className="row wrap" style={{ justifyContent: "center" }}>
          <Button variant="primary" icon={<ExternalLink />} onClick={() => backend.openPath(auth.code.verificationUri)}>
            {t("community.page.openDevicePage")}
          </Button>
          <Button icon={<Copy />} onClick={() => copyText(auth.code.userCode)}>
            {t("community.auth.copyCode")}
          </Button>
        </div>
        <div className="community-waiting">
          <span className="community-pulse" />
          {t("community.auth.waiting")}
          <Button size="sm" variant="ghost" onClick={() => useCommunity.getState().cancelSignIn()}>
            {t("community.auth.cancel")}
          </Button>
        </div>
      </div>
    );

  const error = flowError ?? (auth.error ? communityErrorMessage(auth.error) : null);
  return (
    <div className="community-account">
      <p className="community-account__why">{t("community.auth.why")}</p>
      {error && (
        <div className="community-callout community-callout--warn">
          <TriangleAlert />
          <div>{error}</div>
        </div>
      )}
      {!canDeviceFlow && !compact && <p className="community-note">{t("community.page.noDeviceFlow")}</p>}
      <div className="row wrap">
        {canDeviceFlow && (
          <Button variant="primary" icon={<GitHubMark />} onClick={startDeviceFlow} disabled={starting}>
            {t("community.auth.signIn")}
          </Button>
        )}
        <Button variant={canDeviceFlow ? "secondary" : "primary"} icon={<KeyRound />} onClick={() => setTokenOpen(true)}>
          {canDeviceFlow ? t("community.page.useToken") : t("community.page.signInWithToken")}
        </Button>
      </div>
      {tokenOpen && <TokenModal onClose={() => setTokenOpen(false)} />}
    </div>
  );
}

function TokenModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await useCommunity.getState().signInWithToken(token);
      toast(t("community.auth.signedInAs", { login: useCommunity.getState().auth.status === "signedIn" ? (useCommunity.getState().auth as { login: string }).login : "" }));
      onClose();
    } catch (e) {
      setError(communityErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("community.page.tokenTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !token.trim()}>
            {busy ? t("common.loading") : t("community.auth.tokenSave")}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <ol className="community-steps-list">
          <li>
            {t("community.page.tokenStep1")}{" "}
            <button type="button" className="community-link" onClick={() => backend.openPath(TOKEN_URL)}>
              {t("community.auth.tokenCreate")} <ExternalLink size={12} />
            </button>
          </li>
          <li>{t("community.page.tokenStep2")}</li>
          <li>{t("community.page.tokenStep3")}</li>
        </ol>
        <p className="community-note">{t("community.auth.tokenHelp")}</p>
        <Field label={t("community.auth.tokenLabel")}>
          <Input
            type="password"
            value={token}
            autoFocus
            placeholder="ghp_…"
            spellCheck={false}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && token.trim() && save()}
          />
        </Field>
        {error && (
          <div className="community-callout community-callout--danger">
            <TriangleAlert />
            <div>{error}</div>
          </div>
        )}
        <p className="community-note">{t("community.auth.storedLocally")}</p>
      </div>
    </Modal>
  );
}
