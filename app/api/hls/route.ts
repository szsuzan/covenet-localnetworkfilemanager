import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { relPath, resolveUserPath } from "@/lib/paths";
import { cancelTranscode, hlsKey, isKey, startTranscode } from "@/lib/transcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as
    | { path?: string; start?: number }
    | null;
  const rel = body?.path || "";
  const start = Math.max(0, Math.floor(Number(body?.start) || 0));
  try {
    const abs = resolveUserPath(user, rel).abs;
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) return fail("Not a file", 400);
    const key = hlsKey(relPath(abs), stat, start);
    const state = startTranscode(abs, key, start);
    return NextResponse.json({ key, state });
  } catch {
    return fail("Not found", 404);
  }
}

export async function DELETE(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  if (!(await apiUser())) return fail("Not signed in", 401);
  const body = (await req.json().catch(() => null)) as { key?: string } | null;
  const key = body?.key || "";
  if (!isKey(key)) return fail("Invalid key", 400);
  cancelTranscode(key);
  return NextResponse.json({ ok: true });
}
