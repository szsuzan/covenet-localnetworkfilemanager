import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { kindOf } from "@/lib/kinds";
import { PREVIEW_ROOT, relPath, resolveUserPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONVERTIBLE = [".heic", ".heif", ".tif", ".tiff"];

function convert(input: string, output: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      "magick",
      [input, "-auto-orient", "-resize", "2400x2400>", "-quality", "88", output],
      { timeout: 45_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const rel = new URL(req.url).searchParams.get("path") || "";
  let abs: string;
  try {
    abs = resolveUserPath(user, rel).abs;
  } catch {
    return fail("Invalid path", 400);
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    return fail("Not found", 404);
  }
  if (!stat.isFile() || kindOf(path.basename(abs)) !== "image") {
    return fail("Not an image", 400);
  }

  const ext = path.extname(abs).toLowerCase();
  if (!CONVERTIBLE.includes(ext)) return fail("Preview not needed", 400);

  const key = crypto
    .createHash("sha1")
    .update(`${relPath(abs)}|${stat.size}|${stat.mtimeMs}|preview-v1`)
    .digest("hex");
  const cached = path.join(PREVIEW_ROOT, `${key}.jpg`);

  if (!fs.existsSync(cached)) {
    const temp = `${cached}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp.jpg`;
    try {
      await convert(abs, temp);
      fs.renameSync(temp, cached);
    } catch {
      fs.rmSync(temp, { force: true });
      return fail("Could not convert this image", 415);
    }
  }

  const buffer = await fs.promises.readFile(cached);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
