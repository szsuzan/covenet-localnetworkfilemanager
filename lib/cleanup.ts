import fs from "node:fs";
import path from "node:path";
import { HLS_ROOT, PREVIEW_ROOT, THUMB_ROOT, UPLOAD_ROOT } from "./paths";
import { purgeExpiredTrash } from "./trash";
import { pathSize } from "./usage";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GB = 1024 * 1024 * 1024;

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const config = () => ({
  uploadStaleMs: int(process.env.UPLOAD_STALE_HOURS, 24) * HOUR,
  trashDays: int(process.env.TRASH_RETENTION_DAYS, 30),
  hlsDays: int(process.env.HLS_RETENTION_DAYS, 7),
  hlsMaxBytes: int(process.env.HLS_MAX_GB, 10) * GB,
  thumbDays: int(process.env.THUMB_RETENTION_DAYS, 90),
  thumbMaxBytes: int(process.env.THUMB_MAX_GB, 2) * GB,
  intervalMs: int(process.env.CLEANUP_INTERVAL_HOURS, 6) * HOUR,
});

export type CleanupResult = {
  uploads: number;
  trash: number;
  hls: number;
  thumbs: number;
  freedBytes: number;
  at: number;
};

async function entrySize(target: string, isDir: boolean) {
  if (isDir) return (await pathSize(target)).bytes;
  try {
    return (await fs.promises.stat(target)).size;
  } catch {
    return 0;
  }
}

async function pruneUploads(maxAgeMs: number) {
  let removed = 0;
  let freed = 0;
  const files = await fs.promises.readdir(UPLOAD_ROOT).catch(() => [] as string[]);
  const ids = new Set(files.map((name) => name.replace(/\.(part|json)$/, "")));

  for (const id of ids) {
    const part = path.join(UPLOAD_ROOT, `${id}.part`);
    const meta = path.join(UPLOAD_ROOT, `${id}.json`);
    let newest = 0;
    for (const file of [part, meta]) {
      try {
        const stat = await fs.promises.stat(file);
        newest = Math.max(newest, stat.mtimeMs);
      } catch {
        /* missing */
      }
    }
    if (!newest || Date.now() - newest <= maxAgeMs) continue;
    for (const file of [part, meta]) {
      const size = await entrySize(file, false);
      await fs.promises.rm(file, { force: true }).catch(() => {});
      freed += size;
    }
    removed += 1;
  }
  return { removed, freed };
}

async function newestMtime(target: string, stat: fs.Stats) {
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  const children = await fs.promises.readdir(target).catch(() => [] as string[]);
  for (const child of children) {
    const childStat = await fs.promises.stat(path.join(target, child)).catch(() => null);
    if (childStat) newest = Math.max(newest, childStat.mtimeMs);
  }
  return newest || stat.mtimeMs;
}

/** Delete files and directories older than `maxAgeMs`. */
async function pruneByAge(root: string, maxAgeMs: number) {
  let removed = 0;
  let freed = 0;
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) continue;
    const mtime = await newestMtime(full, stat);
    if (Date.now() - mtime <= maxAgeMs) continue;
    freed += await entrySize(full, stat.isDirectory());
    await fs.promises.rm(full, { recursive: stat.isDirectory(), force: true }).catch(() => {});
    removed += 1;
  }
  return { removed, freed };
}

/** Keep a directory under a byte budget, deleting the least recently used entries first. */
async function pruneBySize(root: string, maxBytes: number, dirs: boolean) {
  let removed = 0;
  let freed = 0;
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const items: Array<{ full: string; mtime: number; size: number; isDir: boolean }> = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (dirs && !entry.isDirectory()) continue;
    if (!dirs && !entry.isFile()) continue;
    const full = path.join(root, entry.name);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) continue;
    items.push({
      full,
      mtime: await newestMtime(full, stat),
      size: await entrySize(full, entry.isDirectory()),
      isDir: entry.isDirectory(),
    });
  }

  let total = items.reduce((sum, item) => sum + item.size, 0);
  if (total <= maxBytes) return { removed, freed };

  items.sort((a, b) => a.mtime - b.mtime);
  for (const item of items) {
    if (total <= maxBytes) break;
    await fs.promises.rm(item.full, {
      recursive: item.isDir,
      force: true,
    }).catch(() => {});
    total -= item.size;
    freed += item.size;
    removed += 1;
  }
  return { removed, freed };
}

let running = false;

export async function runCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    uploads: 0,
    trash: 0,
    hls: 0,
    thumbs: 0,
    freedBytes: 0,
    at: Date.now(),
  };
  if (running) return result;
  running = true;

  const cfg = config();
  try {
    const uploads = await pruneUploads(cfg.uploadStaleMs);
    result.uploads = uploads.removed;
    result.freedBytes += uploads.freed;

    result.trash = await purgeExpiredTrash(cfg.trashDays);

    const hlsAge = await pruneByAge(HLS_ROOT, cfg.hlsDays * DAY);
    const hlsSize = await pruneBySize(HLS_ROOT, cfg.hlsMaxBytes, true);
    result.hls = hlsAge.removed + hlsSize.removed;
    result.freedBytes += hlsAge.freed + hlsSize.freed;

    const thumbAge = await pruneByAge(THUMB_ROOT, cfg.thumbDays * DAY);
    const thumbSize = await pruneBySize(THUMB_ROOT, cfg.thumbMaxBytes, false);
    const previewAge = await pruneByAge(PREVIEW_ROOT, cfg.thumbDays * DAY);
    const previewSize = await pruneBySize(PREVIEW_ROOT, cfg.thumbMaxBytes, false);
    result.thumbs = thumbAge.removed + thumbSize.removed + previewAge.removed + previewSize.removed;
    result.freedBytes += thumbAge.freed + thumbSize.freed + previewAge.freed + previewSize.freed;

    console.log(
      `[cleanup] uploads=${result.uploads} trash=${result.trash} hls=${result.hls} thumbs=${result.thumbs} freed=${(result.freedBytes / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (error) {
    console.error("[cleanup] failed", error);
  } finally {
    running = false;
  }
  return result;
}

const schedulerGlobal = globalThis as unknown as { __cleanupTimer?: NodeJS.Timeout };

export function ensureCleanupScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (schedulerGlobal.__cleanupTimer) return;
  const cfg = config();
  setTimeout(() => void runCleanup(), 10_000).unref();
  schedulerGlobal.__cleanupTimer = setInterval(() => void runCleanup(), cfg.intervalMs);
  schedulerGlobal.__cleanupTimer.unref();
}
