"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "./types";
import { KeyIcon, TrashIcon, WifiIcon } from "./icons";
import { formatBytes, formatDate } from "./format";
import { PromptDialog } from "./Dialogs";
import ConfirmDialog from "./ConfirmDialog";
import PageShell from "./PageShell";

type AdminUser = {
  id: number;
  username: string;
  role: "admin" | "user";
  can_upload: number;
  disabled: number;
  created_at: number;
};

type Stats = {
  disk: { total: number; free: number; used: number };
  publicBytes: number;
  private: Array<{ id: number; username: string; bytes: number }>;
  caches: { trash: number; hls: number; thumbs: number; uploads: number };
  at: number;
};

type AuditEntry = {
  id: number;
  username: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  at: number;
};

type Hotspot = {
  available: boolean;
  running: boolean;
  ssid: string;
  password: string;
  ip: string;
  url: string;
  wifiQr: string | null;
  urlQr: string | null;
  setupCommand: string;
  starting?: boolean;
  error?: string;
};

export default function AdminPanel({ me }: { me: SessionUser }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [hotspot, setHotspot] = useState<Hotspot | null>(null);
  const [hotspotBusy, setHotspotBusy] = useState(false);
  const [hotspotError, setHotspotError] = useState("");
  const [hotspotSsid, setHotspotSsid] = useState("Cove");
  const [hotspotPassword, setHotspotPassword] = useState("");
  const [localAdmin, setLocalAdmin] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [canUpload, setCanUpload] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load users");
      setUsers(data.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load users");
    } finally {
      setLoading(false);
    }
  }

  async function loadHotspot() {
    try {
      const res = await fetch("/api/admin/hotspot");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load hotspot status");
      setHotspot(data);
      setHotspotSsid((current) => current || data.ssid || "Cove");
      setHotspotPassword((current) => current || data.password || "");
    } catch (loadError) {
      setHotspotError(
        loadError instanceof Error ? loadError.message : "Could not load hotspot status",
      );
    }
  }

  async function pollHotspot(attempt = 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const res = await fetch("/api/admin/hotspot");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHotspot({ ...data, starting: !data.running });
        if (data.ssid) setHotspotSsid(data.ssid);
        if (data.password) setHotspotPassword(data.password);
        if (data.running) return;
      }
    } catch {
      /* the network may be changing */
    }
    if (attempt < 8) {
      void pollHotspot(attempt + 1);
    } else {
      setHotspot((current) => (current ? { ...current, starting: false } : current));
      setHotspotError("Could not confirm the hotspot state. Check the laptop's Wi-Fi.");
    }
  }

  async function hotspotAction(action: "start" | "stop") {
    if (action === "start" && !localAdmin) {
      setHotspotError(
        "Open https://127.0.0.1:3000/admin on the laptop before starting; starting over Wi-Fi disconnects this page.",
      );
      return;
    }
    setHotspotBusy(true);
    setHotspotError("");
    try {
      const res = await fetch("/api/admin/hotspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "start"
            ? { action, ssid: hotspotSsid, password: hotspotPassword }
            : { action },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Hotspot action failed");
      setHotspot(data);
      if (data.ssid) setHotspotSsid(data.ssid);
      if (data.password) setHotspotPassword(data.password);
      if (data.starting) void pollHotspot();
    } catch (actionError) {
      setHotspotError(
        actionError instanceof Error ? actionError.message : "Hotspot action failed",
      );
    } finally {
      setHotspotBusy(false);
    }
  }

  async function loadStats() {
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setStats(data);
    } catch {
      /* stats are optional */
    }
    try {
      const res = await fetch("/api/admin/audit");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setAudit(data.items || []);
    } catch {
      /* audit is optional */
    }
  }

  async function runCleanup() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Cleanup failed");
      await loadStats();
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : "Cleanup failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setLocalAdmin(
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(window.location.hostname),
    );
    void refresh();
    void loadStats();
    void loadHotspot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      setUsers(data.users || []);
      void loadStats();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create", username, password, role, canUpload });
    setUsername("");
    setPassword("");
    setRole("user");
    setCanUpload(true);
  }

  function resetPassword(user: AdminUser) {
    setResetTarget(user);
  }

  function removeUser(user: AdminUser) {
    setDeleteTarget(user);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setConfirmBusy(true);
    await post({ action: "delete", id: deleteTarget.id });
    setConfirmBusy(false);
    setDeleteTarget(null);
  }

  return (
    <PageShell user={me} active="admin">
      <div className="page-head">
          <h1>Users</h1>
          <span className="pill">{users.length} account(s)</span>
          <span className="grow" />
          <span className="muted" style={{ fontSize: 12.5 }}>
            Signed in as {me.username}
          </span>
          <button
            className="btn small"
            onClick={() => void runCleanup()}
            disabled={busy}
            title="Remove expired files and clear video, thumbnail and preview caches"
          >
            Run cleanup
          </button>
        </div>

        {error ? <div className="banner">{error}</div> : null}

        {stats ? (
          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">Disk free</div>
              <div className="stat-value">{formatBytes(stats.disk.free)}</div>
              <div className="stat-sub">of {formatBytes(stats.disk.total)}</div>
              <div className="disk-bar">
                <span style={{ width: `${Math.min(100, (stats.disk.used / stats.disk.total) * 100)}%` }} />
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Public files</div>
              <div className="stat-value">{formatBytes(stats.publicBytes)}</div>
              <div className="stat-sub">visible to everyone</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Private files</div>
              <div className="stat-value">
                {formatBytes(stats.private.reduce((sum, entry) => sum + entry.bytes, 0))}
              </div>
              <div className="stat-sub">{stats.private.length} account(s)</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Trash</div>
              <div className="stat-value">{formatBytes(stats.caches.trash)}</div>
              <div className="stat-sub">purged after 30 days</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Video cache</div>
              <div className="stat-value">{formatBytes(stats.caches.hls)}</div>
              <div className="stat-sub">thumbnails {formatBytes(stats.caches.thumbs)}</div>
            </div>
          </div>
        ) : null}

        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head">
            <WifiIcon /> Offline hotspot
            <span className="grow" />
            <button
              className="btn small ghost"
              onClick={() => void loadHotspot()}
              disabled={hotspotBusy}
            >
              Refresh
            </button>
          </div>
          <div className="modal-body">
            {!hotspot ? (
              <span className="muted">Checking hotspot…</span>
            ) : !hotspot.available ? (
              <div className="hotspot-setup">
                <p>
                  One-time setup is required to let the admin panel start a
                  hotspot. Run this on the laptop once:
                </p>
                <code>{hotspot.setupCommand}</code>
                <p className="form-hint">
                  It installs dnsmasq and a narrow sudo helper. Needs internet
                  once.
                </p>
              </div>
            ) : hotspot.starting ? (
              <div className="hotspot-status">
                <div className="vp-spinner" />
                <span className="muted">
                  Starting the hotspot… this page may lose network briefly.
                </span>
              </div>
            ) : hotspot.running ? (
              <>
                <div className="hotspot-status">
                  <span className="pill on">Running</span>
                  <strong>{hotspot.ssid}</strong>
                  {hotspot.ip ? (
                    <span className="hotspot-url">{hotspot.url}</span>
                  ) : (
                    <span className="muted">waiting for an address…</span>
                  )}
                </div>

                <div className="hotspot-grid">
                  {hotspot.wifiQr ? (
                    <div className="qr-card">
                      <img src={hotspot.wifiQr} alt="QR code to join the hotspot" />
                      <strong>1 · Join Wi-Fi</strong>
                      <span>{hotspot.ssid}</span>
                    </div>
                  ) : null}
                  {hotspot.urlQr ? (
                    <div className="qr-card">
                      <img src={hotspot.urlQr} alt="QR code to open Cove" />
                      <strong>2 · Open Cove</strong>
                      <span>{hotspot.url}</span>
                    </div>
                  ) : null}
                  <div className="hotspot-details">
                    <div>
                      <span>Password</span>
                      <code>{hotspot.password || "not saved"}</code>
                    </div>
                    <p className="form-hint">
                      Scan the Wi-Fi code first, then the Cove code.
                    </p>
                    {!hotspot.password ? (
                      <p className="form-hint">
                        This hotspot was started outside Cove, so the password
                        is unknown here.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <button
                    className="btn danger"
                    onClick={() => void hotspotAction("stop")}
                    disabled={hotspotBusy}
                  >
                    {hotspotBusy ? "Stopping…" : "Stop hotspot"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="hotspot-status">
                  <span className="pill">Stopped</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Turn the laptop into a local Wi-Fi network for phones and
                    other devices.
                  </span>
                </div>
                <form
                  className="hotspot-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void hotspotAction("start");
                  }}
                >
                  <div className="field">
                    <label>Network name</label>
                    <input
                      value={hotspotSsid}
                      onChange={(event) => setHotspotSsid(event.target.value)}
                      maxLength={32}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input
                      value={hotspotPassword}
                      onChange={(event) => setHotspotPassword(event.target.value)}
                      minLength={8}
                      maxLength={63}
                      placeholder="at least 8 characters"
                      required
                    />
                  </div>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={hotspotBusy || !localAdmin}
                    title={
                      localAdmin
                        ? undefined
                        : "Open the admin page on the laptop at https://127.0.0.1:3000"
                    }
                  >
                    {hotspotBusy ? "Starting…" : "Start hotspot"}
                  </button>
                </form>
                {localAdmin ? (
                  <p className="form-hint">
                    Starting the hotspot disconnects the laptop from its current
                    Wi-Fi. Reconnect phones to the Cove hotspot after it starts.
                  </p>
                ) : (
                  <p className="form-hint">
                    This page is not open on the laptop’s localhost. Open{" "}
                    <a href="https://127.0.0.1:3000/admin">
                      https://127.0.0.1:3000/admin
                    </a>{" "}
                    on the laptop before starting; starting over Wi-Fi disconnects
                    this page.
                  </p>
                )}
              </>
            )}

            {hotspotError ? <div className="form-error">{hotspotError}</div> : null}
            {hotspot?.error ? <div className="form-error">{hotspot.error}</div> : null}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head">Create account</div>
          <form className="admin-create" onSubmit={createUser}>
            <div className="field">
              <label>Username</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. sabin"
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="min 8 characters"
                required
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={role} onChange={(event) => setRole(event.target.value as "user" | "admin")}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <label className="check" style={{ height: 40 }}>
              <input
                type="checkbox"
                checked={canUpload}
                onChange={(event) => setCanUpload(event.target.checked)}
              />
              Can upload
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              Create
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-head">All accounts</div>
          {loading ? (
            <div className="player-status">Loading…</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Upload</th>
                    <th>Status</th>
                    <th>Private</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.username}</strong>
                        {user.id === me.id ? (
                          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            (you)
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <select
                          className="sort-select"
                          value={user.role}
                          disabled={busy || user.id === me.id}
                          onChange={(event) =>
                            void post({
                              action: "update",
                              id: user.id,
                              role: event.target.value,
                              canUpload: Boolean(user.can_upload),
                              disabled: Boolean(user.disabled),
                            })
                          }
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={Boolean(user.can_upload)}
                            disabled={busy || user.id === me.id}
                            onChange={(event) =>
                              void post({
                                action: "update",
                                id: user.id,
                                role: user.role,
                                canUpload: event.target.checked,
                                disabled: Boolean(user.disabled),
                              })
                            }
                          />
                          Upload
                        </label>
                      </td>
                      <td>
                        {user.disabled ? (
                          <span className="pill">Disabled</span>
                        ) : (
                          <span className="pill on">Active</span>
                        )}
                      </td>
                      <td className="muted">
                        {formatBytes(
                          stats?.private.find((entry) => entry.id === user.id)?.bytes || 0,
                        )}
                      </td>
                      <td className="muted">{formatDate(user.created_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn small ghost"
                            disabled={busy}
                            onClick={() => resetPassword(user)}
                            title="Reset password"
                          >
                            <KeyIcon /> Reset
                          </button>
                          <button
                            className="btn small ghost"
                            disabled={busy}
                            onClick={() => void post({ action: "reset2fa", id: user.id })}
                            title="Remove this user's authenticator"
                          >
                            2FA reset
                          </button>
                          <button
                            className="btn small ghost"
                            disabled={busy || user.id === me.id}
                            onClick={() =>
                              void post({
                                action: "update",
                                id: user.id,
                                role: user.role,
                                canUpload: Boolean(user.can_upload),
                                disabled: !user.disabled,
                              })
                            }
                          >
                            {user.disabled ? "Enable" : "Disable"}
                          </button>
                          <button
                            className="btn small danger"
                            disabled={busy || user.id === me.id}
                            onClick={() => removeUser(user)}
                          >
                            <TrashIcon /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-head">Recent activity</div>
          <div className="audit-list">
            {audit.length === 0 ? (
              <div className="muted" style={{ padding: 16, fontSize: 13 }}>
                No activity recorded yet.
              </div>
            ) : (
              audit.map((entry) => (
                <div className="audit-row" key={entry.id}>
                  <span className="muted">{formatDate(entry.at)}</span>
                  <span>{entry.username || "—"}</span>
                  <span className="action">
                    {entry.action} <span className="target">{entry.target || ""}</span>
                  </span>
                  <span className="muted">{entry.ip || ""}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {resetTarget ? (
          <PromptDialog
            title={`Reset password for ${resetTarget.username}`}
            label="New password"
            placeholder="At least 8 characters"
            confirmLabel="Reset password"
            busy={busy}
            onSubmit={(value) => {
              void post({ action: "reset", id: resetTarget.id, password: value });
              setResetTarget(null);
            }}
            onClose={() => setResetTarget(null)}
          />
        ) : null}

        {deleteTarget ? (
          <ConfirmDialog
            title="Delete account"
            message={`Delete “${deleteTarget.username}”? Their public files stay, and their private folder is archived in the trash.`}
            confirmLabel="Delete account"
            busy={confirmBusy}
            onConfirm={() => void confirmDelete()}
            onClose={() => setDeleteTarget(null)}
          />
        ) : null}
    </PageShell>
  );
}
