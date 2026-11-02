import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { apiUser, fail } from "@/lib/api";
import { kindOf } from "@/lib/kinds";
import { imageThumbLimit, videoThumbLimit } from "@/lib/limits";
import { relPath, resolveUserPath, THUMB_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ffmpegThumb(input: string, output: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "0.5",
        "-i", input,
        "-frames:v", "1",
        "-vf", "scale=480:-2",
        "-q:v", "3",
        output,
      ],
      { timeout: 30_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

const inflight = new Map<string, Promise<void>>();

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
  if (!stat.isFile()) return fail("Not a file", 400);

  const kind = kindOf(path.basename(abs));
  if (kind !== "image" && kind !== "video") return fail("No thumbnail", 404);

  const key = crypto
    .createHash("sha1")
    .update(`${relPath(abs)}|${stat.size}|${stat.mtimeMs}|v2`)
    .digest("hex");
  const cached = path.join(THUMB_ROOT, `${key}.jpg`);

  if (!fs.existsSync(cached)) {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const temp = `${cached}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp.jpg`;
        try {
          if (kind === "image") {
            await imageThumbLimit(() =>
              sharp(abs, { failOn: "none" })
                .rotate()
                .resize(480, 360, { fit: "cover", position: "centre" })
                .jpeg({ quality: 80, mozjpeg: true })
                .toFile(temp),
            );
          } else {
            await videoThumbLimit(async () => {
              await ffmpegThumb(abs, temp);
              await sharp(temp)
                .resize(480, 360, { fit: "cover" })
                .jpeg({ quality: 80 })
                .toFile(`${temp}.2`);
              fs.renameSync(`${temp}.2`, temp);
            });
          }
          fs.renameSync(temp, cached);
        } catch (error) {
          fs.rmSync(temp, { force: true });
          fs.rmSync(`${temp}.2`, { force: true });
          throw error;
        }
      })();
      inflight.set(key, job);
      void job.finally(() => inflight.delete(key)).catch(() => {});
    }
    try {
      await job;
    } catch {
      return fail("Could not generate thumbnail", 404);
    }
  }

  if (!fs.existsSync(cached)) return fail("Could not generate thumbnail", 404);

  const buffer = await fs.promises.readFile(cached);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
