import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "./auth";
import type { SessionUser } from "./db";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function apiUser(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // A forced password change blocks every API except /api/auth.
  if (user.mustChangePassword) return null;
  return user;
}

/** Reject cross-site mutations. SameSite=Lax already blocks most of this. */
export function originOk(req: NextRequest) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = req.headers.get("origin");
  if (!origin) return !site; // allow curl/CLI, reject browser requests without an origin

  try {
    const host =
      req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Keep filesystem errors and absolute paths out of client responses. */
export function safeError(error: unknown, fallback = "Operation failed") {
  const message = error instanceof Error ? error.message : "";
  if (
    !message ||
    /\b(?:ENOENT|EACCES|EPERM|ENOTDIR|EISDIR|ENOTEMPTY|EEXIST|ELOOP|ENOSPC|EROFS)\b/.test(
      message,
    ) ||
    /(?:^|[\s'"])\/[^\s'"]+/.test(message)
  ) {
    return fallback;
  }
  return message;
}

export function safeStat(stat: { size: number }) {
  return stat.size;
}
