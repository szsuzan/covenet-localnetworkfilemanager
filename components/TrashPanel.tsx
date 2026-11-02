"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "./types";
import { KindIcon, TrashIcon } from "./icons";
import { formatBytes, formatDate } from "./format";
import ConfirmDialog from "./ConfirmDialog";
import ThemeToggle from "./ThemeToggle";

type Entry = {
  id: string;
  name: string;
  originalPath: string;
  deletedAt: number;
  size: number;
  isDir: boolean;
  kind: string;
  scope: "public" | "private";
};

export default function TrashPanel({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<void> | void;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/trash");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load trash");
      setItems(data.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load trash");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      if (data.path) setNotice(`Restored to /files?path=${data.path}`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function permanentDelete(entry: Entry) {
    setConfirm({
      title: "Delete permanently",
      message: `Permanently delete “${entry.name}”? This cannot be undone.`,
      action: async () => {
        await post({ action: "delete", id: entry.id });
      },
    });
  }

  function emptyAll() {
    setConfirm({
      title: "Empty trash",
      message: "Permanently delete everything in the trash? This cannot be undone.",
      action: async () => {
        await post({ action: "empty" });
      },
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/files">
          <div className="brand-mark">C</div>
          <span>Cove</span>
        </a>
        <div className="grow" />
        <ThemeToggle />
        <a className="btn small" href="/files">
          Back to files
        </a>
        {user.role === "admin" ? (
          <button className="btn small danger" disabled={busy || items.length === 0} onClick={emptyAll}>
            Empty trash
          </button>
        ) : null}
      </header>

      <main className="container">
        <div className="page-head">
          <h1>Trash</h1>
          <span className="pill">{items.length} item(s)</span>
          <span className="grow" />
          <span className="muted" style={{ fontSize: 12.5 }}>
            Deleted items are removed automatically after 30 days.
          </span>
        </div>

        {error ? <div className="banner">{error}</div> : null}
        {notice ? <div className="banner" style={{ borderColor: "rgba(66,211,146,.3)", background: "rgba(66,211,146,.08)", color: "var(--ok)" }}>{notice}</div> : null}

        {loading ? (
          <div className="player-status">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <TrashIcon width={34} height={34} />
            <strong>Trash is empty</strong>
            <span>Deleted files land here and can be restored.</span>
          </div>
        ) : (
          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Size</th>
                  <th>Deleted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <KindIcon kind={entry.kind} size={17} />
                        {entry.name}
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${entry.scope === "private" ? "admin" : ""}`}>
                        {entry.scope === "public" ? "Public" : "Private"}
                      </span>
                    </td>
                    <td className="muted">{entry.isDir ? "Folder" : formatBytes(entry.size)}</td>
                    <td className="muted">{formatDate(entry.deletedAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() => void post({ action: "restore", id: entry.id })}
                        >
                          Restore
                        </button>
                        <button
                          className="btn small danger"
                          disabled={busy}
                          onClick={() => permanentDelete(entry)}
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
      </main>

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          busy={confirmBusy}
          onConfirm={() => void runConfirm()}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
