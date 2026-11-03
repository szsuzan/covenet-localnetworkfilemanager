import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { hash } from "bcryptjs";
import { apiUser, fail, originOk } from "@/lib/api";
import { db, type UserRow } from "@/lib/db";
import { PRIVATE_ROOT, TRASH_ROOT } from "@/lib/paths";
import { audit } from "@/lib/audit";
import { cleanupUserShares } from "@/lib/shares";
import { validatePassword } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;

function listUsers() {
  return db()
    .prepare(
      "SELECT id, username, role, can_upload, disabled, created_at FROM users ORDER BY id",
    )
    .all() as Omit<UserRow, "password_hash">[];
}

async function requireAdminApi() {
  const user = await apiUser();
  if (!user) return { error: fail("Not signed in", 401) };
  if (user.role !== "admin") return { error: fail("Admin only", 403) };
  return { user };
}

export async function GET() {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;
  const me = guard.user!;

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    id?: number;
    username?: string;
    password?: string;
    role?: string;
    canUpload?: boolean;
    disabled?: boolean;
  } | null;
  if (!body?.action) return fail("Missing action");

  const admins = (
    db().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0").get() as {
      c: number;
    }
  ).c;

  if (body.action === "create") {
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (!USERNAME.test(username)) {
      return fail("Username must be 3-32 characters: letters, numbers, . _ -");
    }
    const policyError = validatePassword(password, username);
    if (policyError) return fail(policyError, 400);
    const exists = db().prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) return fail("Username already exists", 409);
    db()
      .prepare(
        "INSERT INTO users (username, password_hash, role, can_upload, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        username,
        await hash(password, 12),
        body.role === "admin" ? "admin" : "user",
        body.canUpload === false ? 0 : 1,
        Date.now(),
      );
    audit(me, "admin.user.create", username, req);
    return NextResponse.json({ users: listUsers() });
  }

  if (typeof body.id !== "number") return fail("Missing user id");

  if (body.action === "reset") {
    const target = db()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(body.id) as UserRow | undefined;
    if (!target) return fail("User not found", 404);
    if (!body.password) return fail("Password required");
    const policyError = validatePassword(body.password, target.username);
    if (policyError) return fail(policyError, 400);
    db()
      .prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
      )
      .run(await hash(body.password, 12), body.id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(body.id);
    audit(me, "admin.user.reset-password", target.username, req);
    return NextResponse.json({ users: listUsers() });
  }

  if (body.action === "reset2fa") {
    const target = db()
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(body.id) as { username: string } | undefined;
    if (!target) return fail("User not found", 404);
    db()
      .prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?")
      .run(body.id);
    audit(me, "admin.user.reset-2fa", target.username, req);
    return NextResponse.json({ users: listUsers() });
  }

  if (body.action === "update") {
    const target = db().prepare("SELECT * FROM users WHERE id = ?").get(body.id) as
      | UserRow
      | undefined;
    if (!target) return fail("User not found", 404);
    const nextRole = body.role === "admin" ? "admin" : body.role === "user" ? "user" : target.role;
    const nextDisabled = body.disabled === undefined ? Boolean(target.disabled) : body.disabled;
    const nextUpload =
      body.canUpload === undefined ? Boolean(target.can_upload) : body.canUpload;

    if (target.role === "admin" && (nextRole !== "admin" || nextDisabled) && admins <= 1) {
      return fail("Cannot demote or disable the last admin", 409);
    }
    if (target.id === me.id && (nextRole !== "admin" || nextDisabled)) {
      return fail("You cannot demote or disable your own account", 409);
    }
    db()
      .prepare("UPDATE users SET role = ?, disabled = ?, can_upload = ? WHERE id = ?")
      .run(nextRole, nextDisabled ? 1 : 0, nextUpload ? 1 : 0, body.id);
    if (nextDisabled) {
      db().prepare("DELETE FROM sessions WHERE user_id = ?").run(body.id);
      cleanupUserShares(body.id);
    }
    audit(me, "admin.user.update", target.username, req);
    return NextResponse.json({ users: listUsers() });
  }

  if (body.action === "delete") {
    if (body.id === me.id) return fail("You cannot delete your own account", 409);
    const target = db().prepare("SELECT * FROM users WHERE id = ?").get(body.id) as
      | UserRow
      | undefined;
    if (!target) return fail("User not found", 404);
    if (target.role === "admin" && admins <= 1) {
      return fail("Cannot delete the last admin", 409);
    }
    // Keep the files, but move the private folder out of the reusable namespace.
    const privateDir = path.join(PRIVATE_ROOT, target.username);
    if (fs.existsSync(privateDir)) {
      try {
        fs.mkdirSync(TRASH_ROOT, { recursive: true });
        fs.renameSync(
          privateDir,
          path.join(TRASH_ROOT, `${Date.now()}_private_${target.username}`),
        );
      } catch {
        return fail("Could not archive this user's private folder", 500);
      }
    }
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(body.id);
    cleanupUserShares(body.id);
    db().prepare("DELETE FROM users WHERE id = ?").run(body.id);
    audit(me, "admin.user.delete", target.username, req);
    return NextResponse.json({ users: listUsers() });
  }

  return fail("Unknown action");
}
