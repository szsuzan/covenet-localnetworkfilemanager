import path from "node:path";
import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { db } from "@/lib/db";
import {
  HLS_ROOT,
  PRIVATE_ROOT,
  PUBLIC_ROOT,
  THUMB_ROOT,
  TRASH_ROOT,
  UPLOAD_ROOT,
} from "@/lib/paths";
import { diskStats, pathSize } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Stats = {
  disk: { total: number; free: number; used: number };
  publicBytes: number;
  private: Array<{ id: number; username: string; bytes: number }>;
  caches: {
    trash: number;
    hls: number;
    thumbs: number;
    uploads: number;
  };
  at: number;
};

let cache: { at: number; data: Stats } | null = null;

export async function GET() {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  if (user.role !== "admin") return fail("Admin only", 403);

  if (cache && Date.now() - cache.at < 30_000) {
    return NextResponse.json(cache.data);
  }

  const users = db()
    .prepare("SELECT id, username FROM users ORDER BY username")
    .all() as Array<{ id: number; username: string }>;

  const [disk, publicSize, trash, hls, thumbs, uploads] = await Promise.all([
    diskStats(),
    pathSize(PUBLIC_ROOT),
    pathSize(TRASH_ROOT),
    pathSize(HLS_ROOT),
    pathSize(THUMB_ROOT),
    pathSize(UPLOAD_ROOT),
  ]);

  const privateSizes = await Promise.all(
    users.map(async (row) => ({
      id: row.id,
      username: row.username,
      bytes: (await pathSize(path.join(PRIVATE_ROOT, row.username))).bytes,
    })),
  );

  const data: Stats = {
    disk,
    publicBytes: publicSize.bytes,
    private: privateSizes,
    caches: {
      trash: trash.bytes,
      hls: hls.bytes,
      thumbs: thumbs.bytes,
      uploads: uploads.bytes,
    },
    at: Date.now(),
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
