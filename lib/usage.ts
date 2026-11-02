import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "./paths";

export type SizeResult = { bytes: number; files: number };

/** Recursive size, without following symlinks. Caps traversal so a huge tree cannot hang a request. */
export async function pathSize(
  target: string,
  maxFiles = 200_000,
): Promise<SizeResult> {
  let bytes = 0;
  let files = 0;
  const stack = [target];

  while (stack.length && files < maxFiles) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      try {
        const stat = await fs.promises.lstat(current);
        if (stat.isFile()) {
          bytes += stat.size;
          files += 1;
        }
      } catch {
        /* ignore */
      }
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(full);
          bytes += stat.size;
          files += 1;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { bytes, files };
}

export async function diskStats() {
  const stat = await fs.promises.statfs(STORAGE_ROOT);
  const total = stat.blocks * stat.bsize;
  const free = stat.bavail * stat.bsize;
  return { total, free, used: total - free };
}
