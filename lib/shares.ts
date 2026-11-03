import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { PRIVATE_ROOT, resolveUserPath } from "./paths";

export type ShareUser = { id: number; username: string };

export type ReceivedShare = {
  id: number;
  owner: string;
  path: string;
  createdAt: number;
};

export type ShareGrant = {
  id: number;
  granteeId: number;
  username: string;
  createdAt: number;
};

function ownerFolder(user: ShareUser, virtualPath: string) {
  const { abs, virtual } = resolveUserPath(user, virtualPath);
  if (!virtual.startsWith("private/")) throw new Error("Only Private folders can be shared");
  const rel = virtual.slice("private/".length);
  if (!rel) throw new Error("Choose a folder inside Private");
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error("Only folders can be shared");
  return { abs, rel };
}

export function listReceived(user: ShareUser): ReceivedShare[] {
  return db()
    .prepare(
      `SELECT s.id, owner.username AS owner, s.path, s.created_at AS createdAt
       FROM shares s
       JOIN users owner ON owner.id = s.owner_id
       JOIN users grantee ON grantee.id = s.grantee_id
       WHERE grantee.username = ? AND s.permission = 'read'
       ORDER BY s.created_at DESC`,
    )
    .all(user.username) as ReceivedShare[];
}

export function ownerShareState(user: ShareUser, virtualPath: string) {
  const { rel } = ownerFolder(user, virtualPath);
  const users = db()
    .prepare(
      "SELECT id, username FROM users WHERE disabled = 0 AND id <> ? ORDER BY username COLLATE NOCASE",
    )
    .all(user.id) as ShareUser[];
  const grants = db()
    .prepare(
      `SELECT s.id, s.grantee_id AS granteeId, u.username, s.created_at AS createdAt
       FROM shares s
       JOIN users u ON u.id = s.grantee_id
       WHERE s.owner_id = ? AND s.path = ?
       ORDER BY u.username COLLATE NOCASE`,
    )
    .all(user.id, rel) as ShareGrant[];
  return { path: rel, users, grants };
}

export function setShares(user: ShareUser, virtualPath: string, userIds: number[]) {
  const { rel } = ownerFolder(user, virtualPath);
  const requested = Array.from(
    new Set(userIds.filter((id) => Number.isInteger(id) && id !== user.id)),
  );
  const valid = requested.length
    ? (db()
        .prepare(
          `SELECT id FROM users
           WHERE disabled = 0 AND id IN (${requested.map(() => "?").join(",")})`,
        )
        .all(...requested) as Array<{ id: number }>)
    : [];
  const ids = valid.map((row) => row.id);
  const database = db();
  database.exec("BEGIN");
  try {
    database
      .prepare("DELETE FROM shares WHERE owner_id = ? AND path = ?")
      .run(user.id, rel);
    const insert = database.prepare(
      "INSERT INTO shares (owner_id, path, grantee_id, permission, created_at) VALUES (?, ?, ?, 'read', ?)",
    );
    for (const id of ids) insert.run(user.id, rel, id, Date.now());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return ownerShareState(user, virtualPath);
}

/** Remove shares for a folder and everything below it after delete/rename/move. */
export function revokeSharesUnder(ownerId: number, rel: string) {
  if (!rel) return 0;
  const rows = db()
    .prepare("SELECT id, path FROM shares WHERE owner_id = ?")
    .all(ownerId) as Array<{ id: number; path: string }>;
  const ids = rows
    .filter((row) => row.path === rel || row.path.startsWith(`${rel}/`))
    .map((row) => row.id);
  const remove = db().prepare("DELETE FROM shares WHERE id = ?");
  for (const id of ids) remove.run(id);
  return ids.length;
}

export function cleanupUserShares(userId: number) {
  db().prepare("DELETE FROM shares WHERE owner_id = ? OR grantee_id = ?").run(
    userId,
    userId,
  );
}

/** Resolve a received share folder to an Item path without exposing other Private folders. */
export async function receivedShareItems(user: ShareUser) {
  const items = [];
  for (const share of listReceived(user)) {
    const abs = path.join(PRIVATE_ROOT, share.owner, share.path);
    try {
      const stat = await fs.promises.stat(abs);
      if (!stat.isDirectory()) continue;
      items.push({
        name: `${path.basename(share.path)} · ${share.owner}`,
        path: `shared/${share.owner}/${share.path}`,
        isDir: true,
        size: 0,
        mtime: Math.floor(stat.mtimeMs),
        kind: "folder",
        shareId: share.id,
      });
    } catch {
      /* the owner removed or renamed the shared folder */
    }
  }
  return items;
}
