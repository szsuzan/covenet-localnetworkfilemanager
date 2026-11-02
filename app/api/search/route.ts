import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { kindOf } from "@/lib/kinds";
import {
  isHidden,
  PRIVATE_ROOT,
  PUBLIC_ROOT,
  virtualJoin,
  type SpaceUser,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 100;
const MAX_SCANNED = 20000;
const MAX_DEPTH = 8;

type ScanNode = { dir: string; virtual: string; depth: number };

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  const query = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
  if (query.length < 2) return NextResponse.json({ items: [] });

  const items: unknown[] = [];
  let scanned = 0;
  const queue: ScanNode[] = [
    { dir: PUBLIC_ROOT, virtual: "public", depth: 0 },
    {
      dir: path.join(PRIVATE_ROOT, (user as SpaceUser).username),
      virtual: "private",
      depth: 0,
    },
  ];

  while (queue.length && items.length < MAX_RESULTS && scanned < MAX_SCANNED) {
    const node = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(node.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (items.length >= MAX_RESULTS || scanned >= MAX_SCANNED) break;
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      scanned += 1;
      const full = path.join(node.dir, entry.name);
      const isDir = entry.isDirectory();
      if (isDir && node.depth < MAX_DEPTH) {
        queue.push({
          dir: full,
          virtual: virtualJoin(node.virtual, entry.name),
          depth: node.depth + 1,
        });
      }
      if (!entry.name.toLowerCase().includes(query)) continue;
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(full);
      } catch {
        continue;
      }
      items.push({
        name: entry.name,
        path: virtualJoin(node.virtual, entry.name),
        isDir,
        size: isDir ? 0 : stat.size,
        mtime: Math.floor(stat.mtimeMs),
        kind: kindOf(entry.name, isDir),
      });
    }
  }

  return NextResponse.json({ items, truncated: items.length >= MAX_RESULTS });
}
