import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { compare, hashSync } from "bcryptjs";
import { db, type SessionUser, type UserRow } from "./db";
import { verifyTotp } from "./totp";

const SECURE = process.env.COOKIE_SECURE === "1";
export const COOKIE_NAME = SECURE ? "__Host-cove" : "cove_sid";

const DAY = 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * DAY;
const IDLE_MS = Math.max(1, Number(process.env.SESSION_IDLE_DAYS) || 7) * DAY;
const MAX_SESSIONS = 10;

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

let dummy: string | null = null;
function dummyHash() {
  if (!dummy) dummy = hashSync(crypto.randomBytes(16).toString("hex"), 12);
  return dummy;
}

export type LoginResult =
  | { ok: true; token: string; user: SessionUser }
  | { ok: false; error: string; totpRequired?: boolean };

export async function login(
  username: string,
  password: string,
  code?: string,
): Promise<LoginResult> {
  const row = db()
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;

  if (!row) {
    await compare(password, dummyHash());
    return { ok: false, error: "Invalid username or password" };
  }
  if (!(await compare(password, row.password_hash))) {
    return { ok: false, error: "Invalid username or password" };
  }
  if (row.disabled) return { ok: false, error: "Account is disabled" };

  if (row.totp_enabled) {
    if (!code) {
      return {
        ok: false,
        error: "Enter your authenticator code",
        totpRequired: true,
      };
    }
    if (!row.totp_secret || !verifyTotp(row.totp_secret, code)) {
      return { ok: false, error: "Invalid authenticator code" };
    }
  }

  const token = createSession(row.id);
  return { ok: true, token, user: toSessionUser(row) };
}

export function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, last_seen) VALUES (?, ?, ?, ?)",
    )
    .run(sha256(token), userId, now + SESSION_MS, now);

  // Keep only the most recent sessions per account.
  db()
    .prepare(
      `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?
       )`,
    )
    .run(userId, userId, MAX_SESSIONS);
  return token;
}

export function logout(token: string) {
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function revokeAllSessions(userId: number) {
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    canUpload: Boolean(row.can_upload),
    mustChangePassword: Boolean(row.must_change_password),
    totpEnabled: Boolean(row.totp_enabled),
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const now = Date.now();
  const row = db()
    .prepare(
      `SELECT u.*, s.last_seen AS session_seen FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
    )
    .get(sha256(token), now) as (UserRow & { session_seen: number }) | undefined;

  if (!row) return null;
  if (now - row.session_seen > IDLE_MS) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return null;
  }
  // Touch at most once an hour to avoid a write on every request.
  if (now - row.session_seen > 60 * 60 * 1000) {
    db()
      .prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?")
      .run(now, sha256(token));
  }
  return toSessionUser(row);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/security");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/files");
  return user;
}

export function sessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: SECURE,
    path: "/",
    maxAge: Math.floor(SESSION_MS / 1000),
  };
}

export function clearCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: SECURE,
    path: "/",
    maxAge: 0,
  };
}
