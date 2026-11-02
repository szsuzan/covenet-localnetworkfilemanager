import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { db } from "@/lib/db";
import { kindOf } from "@/lib/kinds";
import { resolveUserPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FavoriteRow = { path: string };

export async function GET() {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const rows = db()
    .prepare("SELECT path FROM favorites WHERE user_id = ? ORDER BY created_at DESC")
    .all(user.id) as FavoriteRow[];

  const items = [];
  const paths: string[] = [];
  for (const row of rows) {
    try {
      const { abs } = resolveUserPath(user, row.path);
      const stat = await fs.promises.stat(abs);
      if (!stat.isFile()) continue;
      paths.push(row.path);
      items.push({
        name: path.basename(abs),
        path: row.path,
        isDir: false,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
        kind: kindOf(path.basename(abs)),
      });
    } catch {
      // file moved or deleted since it was favorited
    }
  }
  return NextResponse.json({ paths, items });
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const rel = body?.path || "";
  try {
    const { abs } = resolveUserPath(user, rel);
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) return fail("Only files can be favorited");

    const current = db()
      .prepare("SELECT 1 FROM favorites WHERE user_id = ? AND path = ?")
      .get(user.id, rel);
    if (current) {
      db().prepare("DELETE FROM favorites WHERE user_id = ? AND path = ?").run(user.id, rel);
      return NextResponse.json({ favorite: false });
    }
    db()
      .prepare("INSERT INTO favorites (user_id, path, created_at) VALUES (?, ?, ?)")
      .run(user.id, rel, Date.now());
    return NextResponse.json({ favorite: true });
  } catch {
    return fail("Not found", 404);
  }
}
