import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { relPath, resolveUserPath } from "@/lib/paths";
import { hlsKey, startTranscode } from "@/lib/transcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const rel = body?.path || "";
  try {
    const abs = resolveUserPath(user, rel).abs;
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) return fail("Not a file", 400);
    const key = hlsKey(relPath(abs), stat);
    const state = startTranscode(abs, key);
    return NextResponse.json({ key, state });
  } catch {
    return fail("Not found", 404);
  }
}
