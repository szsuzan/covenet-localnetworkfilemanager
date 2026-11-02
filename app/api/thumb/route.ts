import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { apiUser, fail } from "@/lib/api";
import { kindOf, type Kind } from "@/lib/kinds";
import { imageThumbLimit, videoThumbLimit } from "@/lib/limits";
import { isHidden, relPath, resolveUserPath, THUMB_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function magickThumb(input: string, output: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      "magick",
      [
        input,
        "-auto-orient",
        "-thumbnail", "480x360^",
        "-gravity", "center",
        "-extent", "480x360",
        "-quality", "82",
        output,
      ],
      { timeout: 30_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

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

function pdfThumb(input: string, output: string) {
  const prefix = output.replace(/\.jpg$/i, "");
  return new Promise<void>((resolve, reject) => {
    execFile(
      "pdftoppm",
      ["-f", "1", "-l", "1", "-singlefile", "-scale-to", "480", "-jpeg", input, prefix],
      { timeout: 30_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  }).then(async () => {
    await sharp(output)
      .resize(480, 360, { fit: "cover", position: "centre" })
      .jpeg({ quality: 82 })
      .toFile(`${output}.2`);
    fs.renameSync(`${output}.2`, output);
  });
}

async function createThumb(kind: Kind, input: string, output: string) {
  if (kind === "pdf") {
    await imageThumbLimit(() => pdfThumb(input, output));
    return;
  }
  if (kind === "image") {
    const ext = path.extname(input).toLowerCase();
    const magickFirst = [".heic", ".heif", ".tif", ".tiff"].includes(ext);
    await imageThumbLimit(async () => {
      if (magickFirst) {
        await magickThumb(input, output);
        return;
      }
      try {
        await sharp(input, { failOn: "none" })
          .rotate()
          .resize(480, 360, { fit: "cover", position: "centre" })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(output);
      } catch {
        await magickThumb(input, output);
      }
    });
    return;
  }
  await videoThumbLimit(async () => {
    await ffmpegThumb(input, output);
    await sharp(output)
      .resize(480, 360, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toFile(`${output}.2`);
    fs.renameSync(`${output}.2`, output);
  });
}

/** Find a representative image/video/PDF inside a folder (or nested folder). */
async function findCover(
  dir: string,
  depth = 0,
): Promise<{ abs: string; kind: Kind } | null> {
  if (depth > 2) return null;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  let scanned = 0;
  for (const entry of entries) {
    if (scanned++ > 200) break;
    if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findCover(full, depth + 1);
      if (nested) return nested;
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = kindOf(entry.name);
    if (kind === "image" || kind === "video" || kind === "pdf") {
      return { abs: full, kind };
    }
  }
  return null;
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
  if (!stat.isFile() && !stat.isDirectory()) return fail("Not a file", 400);

  const kind = kindOf(path.basename(abs), stat.isDirectory());
  if (!["image", "video", "pdf", "folder"].includes(kind)) {
    return fail("No thumbnail", 404);
  }

  let targetAbs = abs;
  let targetKind = kind;
  let targetStat = stat;
  if (kind === "folder") {
    const cover = await findCover(abs);
    if (!cover) return fail("No thumbnail", 404);
    targetAbs = cover.abs;
    targetKind = cover.kind;
    targetStat = await fs.promises.stat(targetAbs);
  }

  const key = crypto
    .createHash("sha1")
    .update(
      `${relPath(abs)}|${stat.size}|${stat.mtimeMs}|${relPath(targetAbs)}|${targetStat.size}|${targetStat.mtimeMs}|v4`,
    )
    .digest("hex");
  const cached = path.join(THUMB_ROOT, `${key}.jpg`);

  if (!fs.existsSync(cached)) {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const temp = `${cached}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp.jpg`;
        try {
          await createThumb(targetKind, targetAbs, temp);
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
