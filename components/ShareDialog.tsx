"use client";

import { useEffect, useState } from "react";
import type { Item } from "./types";

type ShareUser = { id: number; username: string };
type ShareGrant = { id: number; granteeId: number; username: string };

export default function ShareDialog({
  item,
  onClose,
  onSaved,
}: {
  item: Item;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shares?path=${encodeURIComponent(item.path)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load shares");
        if (cancelled) return;
        setUsers(data.users || []);
        setSelected(new Set((data.grants || []).map((grant: ShareGrant) => grant.granteeId)));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load shares");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, userIds: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update shares");
      setSelected(new Set((data.grants || []).map((grant: ShareGrant) => grant.granteeId)));
      onSaved?.();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update shares");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Share ${item.name}`}>
        <div className="modal-head">Share “{item.name}”</div>
        <div className="modal-body">
          <p className="form-hint" style={{ marginTop: 0 }}>
            Selected users get read-only access to this Private folder. They cannot
            upload, edit, delete or re-share it.
          </p>
          {loading ? (
            <div className="muted">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="muted">No other active accounts.</div>
          ) : (
            <div className="share-users">
              {users.map((user) => (
                <label className="share-user" key={user.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(user.id);
                        else next.delete(user.id);
                        return next;
                      });
                    }}
                  />
                  <span>{user.username}</span>
                </label>
              ))}
            </div>
          )}
          {error ? <div className="form-error">{error}</div> : null}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy || loading}>
            {busy ? "Saving…" : "Save access"}
          </button>
        </div>
      </div>
    </div>
  );
}
