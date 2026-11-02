import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { db } from "@/lib/db";
import { resolveUserPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  const rel = new URL(req.url).searchParams.get("path") || "";
  const row = db()
    .prepare("SELECT position, duration FROM watch_progress WHERE user_id = ? AND path = ?")
    .get(user.id, rel) as { position: number; duration: number } | undefined;
  return NextResponse.json(row ? { position: row.position, duration: row.duration } : { position: 0 });
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as
    | { path?: string; position?: number; duration?: number }
    | null;
  const rel = body?.path || "";
  const position = Number(body?.position);
  const duration = Number(body?.duration);
  if (!rel || !Number.isFinite(position) || position < 0) return fail("Invalid progress");

  try {
    const { abs } = resolveUserPath(user, rel);
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) return fail("Not a file");

    if (Number.isFinite(duration) && duration > 0 && position / duration > 0.95) {
      db().prepare("DELETE FROM watch_progress WHERE user_id = ? AND path = ?").run(user.id, rel);
      return NextResponse.json({ ok: true, cleared: true });
    }

    db()
      .prepare(
        `INSERT INTO watch_progress (user_id, path, position, duration, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, path) DO UPDATE SET
           position = excluded.position,
           duration = excluded.duration,
           updated_at = excluded.updated_at`,
      )
      .run(user.id, rel, position, Number.isFinite(duration) ? duration : 0, Date.now());
    return NextResponse.json({ ok: true });
  } catch {
    return fail("Not found", 404);
  }
}
