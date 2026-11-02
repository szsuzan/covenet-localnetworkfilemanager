import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { kindOf } from "@/lib/kinds";
import {
  isHidden,
  PRIVATE_ROOT,
  PUBLIC_ROOT,
  virtualJoin,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 60;
const MAX_SCANNED = 8000;
const MAX_DEPTH = 8;

type Progress = { path: string; position: number; duration: number };

export async function GET() {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const found: Array<{
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    mtime: number;
    kind: string;
    position?: number;
    duration?: number;
  }> = [];

  let scanned = 0;
  const queue = [
    { dir: PUBLIC_ROOT, virtual: "public", depth: 0 },
    { dir: path.join(PRIVATE_ROOT, user.username), virtual: "private", depth: 0 },
  ];

  while (queue.length && scanned < MAX_SCANNED) {
    const node = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(node.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scanned >= MAX_SCANNED) break;
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      scanned += 1;
      const full = path.join(node.dir, entry.name);
      const virtual = virtualJoin(node.virtual, entry.name);
      if (entry.isDirectory()) {
        if (node.depth < MAX_DEPTH) {
          queue.push({ dir: full, virtual, depth: node.depth + 1 });
        }
        continue;
      }
      try {
        const stat = await fs.promises.stat(full);
        found.push({
          name: entry.name,
          path: virtual,
          isDir: false,
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs),
          kind: kindOf(entry.name),
        });
      } catch {
        /* ignore */
      }
    }
  }

  found.sort((a, b) => b.mtime - a.mtime);
  const items = found.slice(0, MAX_ITEMS);

  const progress = db()
    .prepare("SELECT path, position, duration FROM watch_progress WHERE user_id = ?")
    .all(user.id) as Progress[];
  const byPath = new Map(progress.map((row) => [row.path, row]));
  for (const item of items) {
    const state = byPath.get(item.path);
    if (state) {
      item.position = state.position;
      item.duration = state.duration;
    }
  }

  return NextResponse.json({ items });
}
