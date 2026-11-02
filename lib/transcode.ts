import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { transcodeConcurrency } from "./limits";
import { HLS_ROOT } from "./paths";

export function hlsKey(rel: string, stat: fs.Stats) {
  return crypto
    .createHash("sha1")
    .update(`${rel}|${stat.size}|${stat.mtimeMs}`)
    .digest("hex");
}

export function hlsDir(key: string) {
  return path.join(HLS_ROOT, key);
}

export function isKey(key: string) {
  return /^[a-f0-9]{40}$/.test(key);
}

export function isReady(key: string) {
  return fs.existsSync(path.join(hlsDir(key), "index.m3u8"));
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runningPid(key: string) {
  try {
    const pid = Number(fs.readFileSync(path.join(hlsDir(key), "ffmpeg.pid"), "utf8"));
    return Number.isFinite(pid) && pidAlive(pid);
  } catch {
    return false;
  }
}

const activeKeys = new Set<string>();
const queuedKeys = new Set<string>();
const pending: Array<{ abs: string; key: string }> = [];
let active = 0;

export function isQueued(key: string) {
  return queuedKeys.has(key);
}

export function isRunning(key: string) {
  return activeKeys.has(key) || queuedKeys.has(key) || runningPid(key);
}

function pump() {
  while (active < transcodeConcurrency && pending.length > 0) {
    const job = pending.shift()!;
    queuedKeys.delete(job.key);
    activeKeys.add(job.key);
    active += 1;
    spawnJob(job.abs, job.key);
  }
}

function spawnJob(abs: string, key: string) {
  const dir = hlsDir(key);

  // Stale directory from an interrupted run: start clean.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const log = fs.openSync(path.join(dir, "ffmpeg.log"), "a");
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-y",
      "-i", abs,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "21",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=w=min(iw\\,1920):h=-2",
      "-c:a", "aac",
      "-b:a", "160k",
      "-ac", "2",
      "-hls_time", "4",
      "-hls_playlist_type", "event",
      "-hls_flags", "independent_segments",
      "-hls_segment_type", "mpegts",
      "-hls_segment_filename", path.join(dir, "seg%05d.ts"),
      path.join(dir, "index.m3u8"),
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  if (child.pid) {
    fs.writeFileSync(path.join(dir, "ffmpeg.pid"), String(child.pid));
  }
  child.on("exit", () => {
    fs.rmSync(path.join(dir, "ffmpeg.pid"), { force: true });
    activeKeys.delete(key);
    active = Math.max(0, active - 1);
    pump();
  });
}

/**
 * Queue an HLS transcode. At most TRANSCODE_CONCURRENCY (default 2) run at once;
 * the rest wait so three viewers cannot pin every CPU core.
 */
export function startTranscode(abs: string, key: string): "ready" | "running" {
  if (isReady(key)) return "ready";
  if (activeKeys.has(key) || queuedKeys.has(key)) return "running";
  if (runningPid(key)) return "running";

  pending.push({ abs, key });
  queuedKeys.add(key);
  pump();
  return "running";
}
