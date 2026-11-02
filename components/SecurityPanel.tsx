"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "./types";
import { CloseIcon, LogoutIcon, StarIcon } from "./icons";
import PageShell from "./PageShell";

type Setup = { secret: string; otpauth: string; qr: string };

export default function SecurityPanel({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [twoFactorError, setTwoFactorError] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disabling, setDisabling] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPwError("");
    setNotice("");
    if (next.length < 12) return setPwError("Use at least 12 characters");
    if (next !== confirm) return setPwError("New passwords do not match");
    setPwBusy(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "password", current, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(data.error || "Could not change password");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setNotice("Password changed. Other devices were signed out.");
      router.replace("/files");
      router.refresh();
    } catch {
      setPwError("Could not reach the server");
    } finally {
      setPwBusy(false);
    }
  }

  async function startTwoFactor() {
    setTwoFactorBusy(true);
    setTwoFactorError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "2fa-setup" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start 2FA setup");
      setSetup(data);
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : "Could not start 2FA");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function enableTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    setTwoFactorBusy(true);
    setTwoFactorError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "2fa-enable", code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not enable 2FA");
      setSetup(null);
      setCode("");
      setNotice("Two-factor authentication enabled.");
      router.refresh();
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : "Could not enable 2FA");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function disableTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    setDisabling(true);
    setTwoFactorError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "2fa-disable",
          password: disablePassword,
          code: disableCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not disable 2FA");
      setDisablePassword("");
      setDisableCode("");
      setNotice("Two-factor authentication disabled.");
      router.refresh();
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : "Could not disable 2FA");
    } finally {
      setDisabling(false);
    }
  }

  async function signOutAll() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout-all" }),
    });
    router.replace("/login");
    router.refresh();
  }

  return (
    <PageShell user={user} active="security">
      <div className="page-head">
        <h1>Account security</h1>
        <span className="pill">{user.username}</span>
      </div>

      <div className="narrow">
        {user.mustChangePassword ? (
          <div className="banner" style={{ borderColor: "rgba(255,180,84,.35)", background: "rgba(255,180,84,.08)", color: "var(--warn)" }}>
            You must change the default password before using the file manager.
          </div>
        ) : null}

        {notice ? (
          <div
            className="banner"
            style={{
              borderColor: "rgba(66,211,146,.3)",
              background: "rgba(66,211,146,.08)",
              color: "var(--ok)",
            }}
          >
            {notice}
          </div>
        ) : null}

        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head">Change password</div>
          <form className="modal-body" onSubmit={changePassword}>
            <div className="field">
              <label>Current password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>New password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                required
              />
              <span className="form-hint">
                At least 12 characters, 3 of: lowercase, uppercase, numbers, symbols.
              </span>
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </div>
            {pwError ? <div className="form-error">{pwError}</div> : null}
            <div>
              <button className="btn primary" type="submit" disabled={pwBusy}>
                {pwBusy ? "Saving…" : "Change password"}
              </button>
            </div>
          </form>
        </div>

        {!user.mustChangePassword ? (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">Two-factor authentication</div>
            <div className="modal-body">
              {user.totpEnabled ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="pill on">Enabled</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      An authenticator code is required at every sign-in.
                    </span>
                  </div>
                  <form onSubmit={disableTwoFactor} style={{ display: "grid", gap: 12, marginTop: 6 }}>
                    <div className="field">
                      <label>Password</label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(event) => setDisablePassword(event.target.value)}
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Authenticator code</label>
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={disableCode}
                        onChange={(event) => setDisableCode(event.target.value)}
                        placeholder="123456"
                        required
                      />
                    </div>
                    {twoFactorError ? <div className="form-error">{twoFactorError}</div> : null}
                    <div>
                      <button className="btn danger" type="submit" disabled={disabling}>
                        Disable 2FA
                      </button>
                    </div>
                  </form>
                </>
              ) : setup ? (
                <form onSubmit={enableTwoFactor} style={{ display: "grid", gap: 12 }}>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Scan this with an authenticator app, or enter the secret manually.
                  </div>
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
                    <img
                      src={setup.qr}
                      alt="2FA QR code"
                      width={180}
                      height={180}
                      style={{ borderRadius: 10, background: "#fff", padding: 6 }}
                    />
                    <div style={{ display: "grid", gap: 6 }}>
                      <span className="form-hint">Secret</span>
                      <code
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 13,
                          wordBreak: "break-all",
                          maxWidth: 260,
                        }}
                      >
                        {setup.secret}
                      </code>
                    </div>
                  </div>
                  <div className="field">
                    <label>Enter the 6-digit code</label>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="123456"
                      required
                    />
                  </div>
                  {twoFactorError ? <div className="form-error">{twoFactorError}</div> : null}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn primary" type="submit" disabled={twoFactorBusy || code.length < 6}>
                      Enable 2FA
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setSetup(null);
                        setTwoFactorError("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="pill">Disabled</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      Add a second factor to protect your account.
                    </span>
                  </div>
                  {twoFactorError ? <div className="form-error">{twoFactorError}</div> : null}
                  <div style={{ marginTop: 6 }}>
                    <button className="btn" onClick={() => void startTwoFactor()} disabled={twoFactorBusy}>
                      <StarIcon /> {twoFactorBusy ? "Preparing…" : "Enable 2FA"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="panel">
          <div className="panel-head">Sessions</div>
          <div className="modal-body">
            <div className="muted" style={{ fontSize: 13 }}>
              Signing out everywhere also ends this browser session. You will need to sign in again.
            </div>
            <div>
              <button className="btn danger" onClick={() => void signOutAll()}>
                <LogoutIcon /> Sign out all devices
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
