import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { clearCaches, runCleanup } from "@/lib/cleanup";
import { emptyTrash } from "@/lib/trash";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  if (user.role !== "admin") return fail("Admin only", 403);

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action === "cleanup") {
    const result = await runCleanup();
    const cache = await clearCaches();
    result.hls += cache.hls;
    result.thumbs += cache.thumbs + cache.previews;
    result.freedBytes += cache.freedBytes;
    audit(user, "admin.cleanup", `freed ${result.freedBytes} bytes`, req);
    return NextResponse.json({ ok: true, result });
  }
  if (body?.action === "empty-trash") {
    const removed = await emptyTrash();
    audit(user, "admin.empty-trash", `${removed} item(s)`, req);
    return NextResponse.json({ ok: true, removed });
  }
  return fail("Unknown action");
}
