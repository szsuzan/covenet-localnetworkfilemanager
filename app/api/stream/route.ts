import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { mimeOf } from "@/lib/kinds";
import { resolveUserPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(name: string, download: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const INLINE_SAFE = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico",
  "mp4", "m4v", "webm", "ogv",
  "mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac",
  "pdf", "txt", "md", "log", "csv", "vtt", "srt",
]);

/** SVG/HTML/XML/JS can execute same-origin if opened directly — force download. */
function isInlineSafe(name: string) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return INLINE_SAFE.has(ext);
}

async function handler(req: NextRequest, head: boolean) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const params = new URL(req.url).searchParams;
  const rel = params.get("path") || "";
  const download = params.get("download") === "1";
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

  const name = path.basename(abs);
  const size = stat.size;
  const forceDownload = download || !isInlineSafe(name);
  const headers = new Headers({
    "Content-Type": forceDownload && !download ? "application/octet-stream" : mimeOf(name),
    "Accept-Ranges": "bytes",
    "Content-Disposition": contentDisposition(name, forceDownload),
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Cross-Origin-Resource-Policy": "same-origin",
  });

  const range = req.headers.get("range");
  let start = 0;
  let end = size - 1;
  let status = 200;

  if (range && size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const [, rawStart, rawEnd] = match;
    if (rawStart === "" && rawEnd !== "") {
      const bytes = Number(rawEnd);
      start = Math.max(0, size - bytes);
      end = size - 1;
    } else {
      start = rawStart === "" ? 0 : Number(rawStart);
      end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }

  const length = size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(length));

  if (head || size === 0) {
    return new Response(null, { status, headers });
  }

  const stream = fs.createReadStream(abs, { start, end, highWaterMark: 1024 * 1024 });
  stream.on("error", () => stream.destroy());
  return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
    status,
    headers,
  });
}

export async function GET(req: NextRequest) {
  return handler(req, false);
}

export async function HEAD(req: NextRequest) {
  return handler(req, true);
}
