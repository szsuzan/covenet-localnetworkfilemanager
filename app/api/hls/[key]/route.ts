import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { isKey, isQueued, isReady, isRunning } from "@/lib/transcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!(await apiUser())) return fail("Not signed in", 401);
  const { key } = await params;
  if (!isKey(key)) return fail("Invalid key", 400);
  return NextResponse.json({
    ready: isReady(key),
    running: isRunning(key),
    queued: isQueued(key),
  });
}
