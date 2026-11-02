import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { probe } from "@/lib/media";
import { resolveUserPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  const rel = new URL(req.url).searchParams.get("path") || "";
  try {
    const abs = resolveUserPath(user, rel).abs;
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) return fail("Not a file", 400);
    const info = await probe(abs);
    if (!info) return fail("Could not read media", 415);
    return NextResponse.json(info);
  } catch {
    return fail("Not found", 404);
  }
}
