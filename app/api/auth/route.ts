import { NextResponse, type NextRequest } from "next/server";
import { compare, hash } from "bcryptjs";
import QRCode from "qrcode";
import {
  clearCookie,
  createSession,
  getCurrentUser,
  login,
  logout,
  revokeAllSessions,
  sessionCookie,
  COOKIE_NAME,
} from "@/lib/auth";
import { db, type UserRow } from "@/lib/db";
import { apiUser, fail, originOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import {
  clearLoginFailures,
  loginBlocked,
  noteLoginFailure,
} from "@/lib/loginGuard";
import { clientIp, validatePassword } from "@/lib/security";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/totp";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ user: await getCurrentUser() });
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const body = (await req.json().catch(() => null)) as
    | {
        action?: string;
        username?: string;
        password?: string;
        current?: string;
        next?: string;
        code?: string;
      }
    | null;
  if (!body?.action) return fail("Missing action");

  if (body.action === "login") {
    const username = (body.username || "").trim();
    const password = body.password || "";
    const ip = clientIp(req);
    if (!username || !password) return fail("Username and password required");

    const blocked = loginBlocked(username, ip);
    if (blocked) {
      audit({ username }, "login.blocked", null, req);
      return fail(`Too many attempts. Try again in ${blocked}s.`, 429);
    }

    const result = await login(username, password, body.code);
    if (!result.ok) {
      if (!result.totpRequired) {
        noteLoginFailure(username, ip);
        audit({ username }, "login.failed", null, req);
      }
      return NextResponse.json(
        { error: result.error, totpRequired: Boolean(result.totpRequired) },
        { status: 401 },
      );
    }

    clearLoginFailures(username, ip);
    audit({ id: result.user.id, username: result.user.username }, "login", null, req);
    const res = NextResponse.json({ user: result.user });
    res.cookies.set(sessionCookie(result.token));
    return res;
  }

  if (body.action === "logout") {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    const user = await getCurrentUser();
    if (token) logout(token);
    audit({ id: user?.id, username: user?.username }, "logout", null, req);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(clearCookie());
    return res;
  }

  if (body.action === "logout-all") {
    const user = await getCurrentUser();
    if (!user) return fail("Not signed in", 401);
    revokeAllSessions(user.id);
    audit(user, "logout.all", null, req);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(clearCookie());
    return res;
  }

  if (body.action === "password") {
    const user = await getCurrentUser();
    if (!user) return fail("Not signed in", 401);
    if (!body.current || !body.next) return fail("Current and new password required");

    const row = db()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(user.id) as UserRow | undefined;
    if (!row || !(await compare(body.current, row.password_hash))) {
      audit(user, "password.change.failed", null, req);
      return fail("Current password is incorrect", 401);
    }

    const policyError = validatePassword(body.next, user.username);
    if (policyError) return fail(policyError, 400);
    if (body.next === body.current) return fail("New password must be different");

    db()
      .prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      )
      .run(await hash(body.next, 12), user.id);

    // Invalidate every session, then issue a fresh one for this browser.
    revokeAllSessions(user.id);
    const token = createSession(user.id);
    audit(user, "password.change", null, req);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(token));
    return res;
  }

  if (body.action === "2fa-setup") {
    if (!(await apiUser())) return fail("Not signed in", 401);
    const user = (await getCurrentUser())!;
    const secret = generateTotpSecret();
    db()
      .prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?")
      .run(secret, user.id);
    const otpauth = otpauthUrl(secret, user.username);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
    return NextResponse.json({ secret, otpauth, qr });
  }

  if (body.action === "2fa-enable") {
    if (!(await apiUser())) return fail("Not signed in", 401);
    const user = (await getCurrentUser())!;
    const row = db()
      .prepare("SELECT totp_secret FROM users WHERE id = ?")
      .get(user.id) as { totp_secret: string | null } | undefined;
    if (!row?.totp_secret) return fail("Start setup first", 400);
    if (!body.code || !verifyTotp(row.totp_secret, body.code)) {
      return fail("Invalid authenticator code", 400);
    }
    db().prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(user.id);
    audit(user, "2fa.enable", null, req);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "2fa-disable") {
    if (!(await apiUser())) return fail("Not signed in", 401);
    const user = (await getCurrentUser())!;
    const row = db()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(user.id) as UserRow | undefined;
    if (!row) return fail("Not found", 404);
    if (!body.password || !(await compare(body.password, row.password_hash))) {
      return fail("Password is incorrect", 401);
    }
    if (row.totp_enabled && (!body.code || !row.totp_secret || !verifyTotp(row.totp_secret, body.code))) {
      return fail("Invalid authenticator code", 400);
    }
    db()
      .prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?")
      .run(user.id);
    audit(user, "2fa.disable", null, req);
    return NextResponse.json({ ok: true });
  }

  return fail("Unknown action");
}
