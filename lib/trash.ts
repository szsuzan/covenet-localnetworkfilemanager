import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { kindOf } from "./kinds";
import {
  resolveUserPath,
  TRASH_ROOT,
  uniqueDestination,
  virtualJoin,
  virtualParent,
} from "./paths";
import { pathSize } from "./usage";

const META = "meta.json";
const ITEM = "item";

export type TrashMeta = {
  id: string;
  originalPath: string;
  name: string;
  ownerId: number;
  deletedAt: number;
};

export type TrashEntry = TrashMeta & {
  size: number;
  isDir: boolean;
  kind: string;
  scope: "public" | "private";
};

type TrashUser = { id: number; username: string };

function entryDir(id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid trash entry");
  const dir = path.join(TRASH_ROOT, id);
  const rel = path.relative(TRASH_ROOT, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid trash entry");
  }
  return dir;
}

function publicPath(originalPath: string) {
  return originalPath === "public" || originalPath.startsWith("public/");
}

export function canSee(meta: TrashMeta, user: TrashUser) {
  if (publicPath(meta.originalPath)) return true;
  return meta.originalPath.startsWith("private/") && meta.ownerId === user.id;
}

async function readMeta(dir: string): Promise<TrashMeta | null> {
  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(path.join(dir, META), "utf8"),
    ) as TrashMeta;
    if (!parsed?.id || !parsed.originalPath || !parsed.deletedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function move(src: string, dest: string) {
  try {
    await fs.promises.rename(src, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.promises.cp(src, dest, { recursive: true });
    await fs.promises.rm(src, { recursive: true, force: true });
  }
}

export async function moveToTrash(
  absSrc: string,
  originalPath: string,
  ownerId: number,
) {
  const id = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const dir = path.join(TRASH_ROOT, id);
  await fs.promises.mkdir(dir, { recursive: true });
  await move(absSrc, path.join(dir, ITEM));
  const meta: TrashMeta = {
    id,
    originalPath,
    name: path.basename(absSrc),
    ownerId,
    deletedAt: Date.now(),
  };
  await fs.promises.writeFile(path.join(dir, META), JSON.stringify(meta));
  return id;
}

export async function listTrash(user: TrashUser): Promise<TrashEntry[]> {
  let dirs: fs.Dirent[];
  try {
    dirs = await fs.promises.readdir(TRASH_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: TrashEntry[] = [];
  for (const dirEntry of dirs) {
    if (!dirEntry.isDirectory()) continue;
    const dir = path.join(TRASH_ROOT, dirEntry.name);
    const meta = await readMeta(dir);
    if (!meta || !canSee(meta, user)) continue;
    const item = path.join(dir, ITEM);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(item);
    } catch {
      continue;
    }
    const size = stat.isDirectory() ? (await pathSize(item)).bytes : stat.size;
    entries.push({
      ...meta,
      size,
      isDir: stat.isDirectory(),
      kind: kindOf(meta.name, stat.isDirectory()),
      scope: publicPath(meta.originalPath) ? "public" : "private",
    });
  }
  entries.sort((a, b) => b.deletedAt - a.deletedAt);
  return entries;
}

export async function restoreTrash(user: TrashUser, id: string) {
  const dir = entryDir(id);
  const meta = await readMeta(dir);
  if (!meta || !canSee(meta, user)) throw new Error("Trash entry not found");

  const { abs: originalAbs } = resolveUserPath(user, meta.originalPath);
  const parent = path.dirname(originalAbs);
  await fs.promises.mkdir(parent, { recursive: true });
  const dest = uniqueDestination(parent, path.basename(originalAbs));
  await move(path.join(dir, ITEM), dest);
  await fs.promises.rm(dir, { recursive: true, force: true });

  return {
    path: virtualJoin(virtualParent(meta.originalPath), path.basename(dest)),
  };
}

export async function deleteTrashEntry(user: TrashUser, id: string) {
  const dir = entryDir(id);
  const meta = await readMeta(dir);
  if (!meta || !canSee(meta, user)) throw new Error("Trash entry not found");
  await fs.promises.rm(dir, { recursive: true, force: true });
}

export async function emptyTrash() {
  const dirs = await fs.promises.readdir(TRASH_ROOT).catch(() => [] as string[]);
  let removed = 0;
  for (const name of dirs) {
    try {
      await fs.promises.rm(path.join(TRASH_ROOT, name), {
        recursive: true,
        force: true,
      });
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export async function purgeExpiredTrash(retentionDays: number) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const dirs = await fs.promises.readdir(TRASH_ROOT).catch(() => [] as string[]);
  let removed = 0;
  for (const name of dirs) {
    const dir = path.join(TRASH_ROOT, name);
    const meta = await readMeta(dir);
    if (!meta) continue;
    if (meta.deletedAt < cutoff) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      removed += 1;
    }
  }
  return removed;
}
