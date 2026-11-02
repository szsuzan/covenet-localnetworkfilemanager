import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { hlsDir, isKey } from "@/lib/transcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string; file: string }> },
) {
  if (!(await apiUser())) return fail("Not signed in", 401);
  const { key, file } = await params;
  if (!isKey(key)) return fail("Invalid key", 400);
  if (!/^(index\.m3u8|seg\d{5}\.ts)$/.test(file)) return fail("Invalid file", 400);

  const target = path.join(hlsDir(key), file);
  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(target);
  } catch {
    return fail("Not ready", 404);
  }

  const playlist = file.endsWith(".m3u8");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": playlist ? "application/vnd.apple.mpegurl" : "video/mp2t",
      "Content-Length": String(buffer.length),
      "Cache-Control": playlist ? "no-store" : "private, max-age=31536000, immutable",
    },
  });
}
