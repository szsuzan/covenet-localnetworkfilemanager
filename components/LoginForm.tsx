"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username,
          password,
          code: needsCode ? code : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.totpRequired && !needsCode) {
          setNeedsCode(true);
          setError("");
          return;
        }
        setError(data.error || "Sign in failed");
        return;
      }
      router.replace(data.user?.mustChangePassword ? "/security" : "/files");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={needsCode}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="password-wrap">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={needsCode}
            required
          />
          <button
            type="button"
            className="icon-btn password-toggle"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {needsCode ? (
        <div className="field">
          <label htmlFor="code">Authenticator code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
            required
          />
          <span className="form-hint">
            Open your authenticator app and enter the current code.
          </span>
        </div>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Signing in…" : needsCode ? "Verify code" : "Sign in"}
      </button>
      {needsCode ? (
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setNeedsCode(false);
            setCode("");
            setError("");
          }}
        >
          Back
        </button>
      ) : null}
      <div className="form-hint" style={{ textAlign: "center" }}>
        Accounts are created by the administrator.
      </div>
    </form>
  );
}
