import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import {
  deleteTrashEntry,
  emptyTrash,
  listTrash,
  restoreTrash,
} from "@/lib/trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  return NextResponse.json({ items: await listTrash(user) });
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as
    | { action?: string; id?: string }
    | null;
  if (!body?.action) return fail("Missing action");

  try {
    if (body.action === "restore") {
      if (!body.id) return fail("Missing id");
      const restored = await restoreTrash(user, body.id);
      audit(user, "trash.restore", restored.path, req);
      return NextResponse.json({ ok: true, path: restored.path });
    }
    if (body.action === "delete") {
      if (!body.id) return fail("Missing id");
      await deleteTrashEntry(user, body.id);
      audit(user, "trash.delete", body.id, req);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "empty") {
      if (user.role !== "admin") return fail("Admin only", 403);
      const removed = await emptyTrash();
      audit(user, "trash.empty", `${removed} item(s)`, req);
      return NextResponse.json({ ok: true, removed });
    }
    return fail("Unknown action");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Trash operation failed");
  }
}
