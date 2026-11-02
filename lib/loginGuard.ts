import { db } from "./db";

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const USER_MAX = 10;
const IP_MAX = 40;

type Row = {
  fails: number;
  first_at: number;
  locked_until: number;
};

function read(key: string): Row | null {
  return (db()
    .prepare("SELECT fails, first_at, locked_until FROM login_throttle WHERE key = ?")
    .get(key) as Row | undefined) ?? null;
}

function blockedSeconds(row: Row | null) {
  if (!row) return 0;
  const remaining = row.locked_until - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function loginBlocked(username: string, ip: string) {
  const account = blockedSeconds(read(`u:${username.toLowerCase()}|${ip}`));
  if (ip === "local") return account;
  return Math.max(account, blockedSeconds(read(`i:${ip}`)));
}

export function noteLoginFailure(username: string, ip: string) {
  const now = Date.now();
  const apply = (key: string, max: number) => {
    const row = read(key);
    if (!row || now - row.first_at > WINDOW_MS) {
      db()
        .prepare(
          "INSERT OR REPLACE INTO login_throttle (key, fails, first_at, locked_until) VALUES (?, 1, ?, 0)",
        )
        .run(key, now);
      return;
    }
    const fails = row.fails + 1;
    const locked = fails >= max ? now + LOCK_MS : row.locked_until;
    db()
      .prepare(
        "UPDATE login_throttle SET fails = ?, locked_until = ? WHERE key = ?",
      )
      .run(fails, locked, key);
  };

  apply(`u:${username.toLowerCase()}|${ip}`, USER_MAX);
  if (ip !== "local") apply(`i:${ip}`, IP_MAX);
}

export function clearLoginFailures(username: string, ip: string) {
  db()
    .prepare("DELETE FROM login_throttle WHERE key = ?")
    .run(`u:${username.toLowerCase()}|${ip}`);
}
