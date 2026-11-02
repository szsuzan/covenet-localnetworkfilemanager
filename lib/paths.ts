import fs from "node:fs";
import path from "node:path";

export const STORAGE_ROOT = path.resolve(
  /*turbopackIgnore: true*/ process.env.STORAGE_ROOT ||
    path.join(process.env.HOME || "/tmp", "FileShare"),
);

export const DATA_ROOT = path.join(process.cwd(), "data");
export const TRASH_ROOT = path.join(DATA_ROOT, "trash");
export const UPLOAD_ROOT = path.join(DATA_ROOT, "uploads");
export const THUMB_ROOT = path.join(DATA_ROOT, "thumbs");
export const PREVIEW_ROOT = path.join(DATA_ROOT, "previews");
export const HLS_ROOT = path.join(DATA_ROOT, "hls");

export const PUBLIC_ROOT = path.join(STORAGE_ROOT, "Public");
export const PRIVATE_ROOT = path.join(STORAGE_ROOT, "Private");

for (const dir of [
  STORAGE_ROOT,
  PUBLIC_ROOT,
  PRIVATE_ROOT,
  DATA_ROOT,
  TRASH_ROOT,
  UPLOAD_ROOT,
  THUMB_ROOT,
  PREVIEW_ROOT,
  HLS_ROOT,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

export type SpaceUser = { username: string };

function cleanRel(rel: string | null | undefined) {
  return (rel || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Map a virtual path ("public/Photos", "private/notes") to disk.
 * "private" always resolves inside the signed-in user's own folder.
 */
export function resolveUserPath(
  user: SpaceUser,
  rel: string | null | undefined,
): { abs: string; virtual: string } {
  const cleaned = cleanRel(rel);
  if (!cleaned) throw new Error("Choose Public or Private first");
  if (cleaned.includes("\0")) throw new Error("Invalid path");

  const parts = cleaned.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("Invalid path");
  }
  const space = parts[0];
  if (space !== "public" && space !== "private") throw new Error("Invalid path");

  const base =
    space === "public" ? PUBLIC_ROOT : path.join(PRIVATE_ROOT, user.username);
  if (space === "private") fs.mkdirSync(base, { recursive: true });
  const rest = parts.slice(1);
  const abs = path.resolve(base, rest.join("/"));
  const relative = path.relative(base, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path");
  }
  return { abs, virtual: [space, ...rest].join("/") };
}

export function virtualJoin(dir: string, name: string) {
  const cleaned = cleanRel(dir);
  return cleaned ? `${cleaned}/${name}` : name;
}

export function virtualParent(rel: string | null | undefined) {
  const parts = cleanRel(rel).split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

/** Relative path from the storage root, forward slashes. Used for cache keys. */
export function relPath(full: string): string {
  return path.relative(STORAGE_ROOT, full).split(path.sep).join("/");
}

export function assertName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    /[/\\\0]/.test(trimmed) ||
    /[\x00-\x1f\x7f]/.test(trimmed) ||
    /[. ]$/.test(trimmed) ||
    trimmed.length > 200
  ) {
    throw new Error("Invalid name");
  }
  return trimmed;
}

export function isHidden(name: string) {
  return name.startsWith(".");
}

export function uniqueDestination(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let n = 1;
  while (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}
