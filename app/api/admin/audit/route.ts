import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  if (user.role !== "admin") return fail("Admin only", 403);

  const rows = db()
    .prepare(
      `SELECT id, user_id, username, action, target, ip, at
       FROM audit_log ORDER BY at DESC LIMIT 100`,
    )
    .all();
  return NextResponse.json({ items: rows });
}
