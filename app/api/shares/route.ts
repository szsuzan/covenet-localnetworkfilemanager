import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listReceived, ownerShareState, setShares } from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  const target = new URL(req.url).searchParams.get("path");
  try {
    if (target) return NextResponse.json(ownerShareState(user, target));
    return NextResponse.json({ received: listReceived(user) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not load shares");
  }
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as
    | { path?: string; userIds?: number[] }
    | null;
  if (!body?.path || !Array.isArray(body.userIds)) return fail("Invalid share request");
  try {
    const state = setShares(user, body.path, body.userIds);
    audit(user, "share.set", `${body.path} → ${state.grants.length} user(s)`, req);
    return NextResponse.json(state);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not update shares");
  }
}
