import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { kindOf } from "@/lib/kinds";
import { isHidden, PUBLIC_ROOT, virtualJoin } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  kind: string;
};

type Album = {
  name: string;
  path: string;
  count: number;
  updated: number;
  covers: string[];
};

const MAX_SCAN = 9000;
const MAX_DEPTH = 5;
const CACHE_MS = 15_000;

let cache: { at: number; data: unknown } | null = null;

function kindOfName(name: string) {
  return kindOf(name);
}

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.data);
  }

  const videos: Item[] = [];
  const files: Item[] = [];
  const folders: Item[] = [];
  const albums = new Map<
    string,
    { name: string; path: string; updated: number; covers: Item[] }
  >();

  let scanned = 0;
  const queue: Array<{ dir: string; virtual: string; depth: number }> = [
    { dir: PUBLIC_ROOT, virtual: "public", depth: 0 },
  ];

  while (queue.length && scanned < MAX_SCAN) {
    const node = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(node.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (scanned >= MAX_SCAN) break;
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      scanned += 1;
      const full = path.join(node.dir, entry.name);
      const virtual = virtualJoin(node.virtual, entry.name);
      const isDir = entry.isDirectory();

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(full);
      } catch {
        continue;
      }

      if (isDir) {
        if (node.depth === 0) {
          folders.push({
            name: entry.name,
            path: virtual,
            isDir: true,
            size: 0,
            mtime: Math.floor(stat.mtimeMs),
            kind: "folder",
          });
        }
        if (node.depth < MAX_DEPTH) {
          queue.push({ dir: full, virtual, depth: node.depth + 1 });
        }
        continue;
      }

      const kind = kindOfName(entry.name);
      const item: Item = {
        name: entry.name,
        path: virtual,
        isDir: false,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
        kind,
      };

      if (kind === "video") {
        videos.push(item);
      } else if (kind === "image") {
        if (node.virtual !== "public") {
          const album = albums.get(node.virtual) ?? {
            name: path.basename(node.virtual),
            path: node.virtual,
            updated: 0,
            covers: [],
          };
          album.updated = Math.max(album.updated, item.mtime);
          album.covers.push(item);
          albums.set(node.virtual, album);
        }
      } else {
        files.push(item);
      }
    }
  }

  videos.sort((a, b) => b.mtime - a.mtime);
  files.sort((a, b) => b.mtime - a.mtime);
  folders.sort((a, b) => b.mtime - a.mtime);

  const albumList: Album[] = Array.from(albums.values())
    .map((album) => ({
      name: album.name,
      path: album.path,
      count: album.covers.length,
      updated: album.updated,
      covers: album.covers
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 4)
        .map((cover) => cover.path),
    }))
    .sort((a, b) => b.updated - a.updated);

  const movieFolder = folders.find((folder) =>
    /^(movies?|films?|videos?|media)$/i.test(folder.name),
  );
  const albumFolder = folders.find((folder) =>
    /^(photos?|albums?|gallery|pictures)$/i.test(folder.name),
  );

  const data = {
    videos: videos.slice(0, 24),
    albums: albumList.slice(0, 12),
    files: files.slice(0, 16),
    folders: folders.slice(0, 16),
    counts: {
      videos: videos.length,
      albums: albumList.length,
      files: files.length,
      folders: folders.length,
    },
    videoLabel: movieFolder?.name ?? "Videos",
    videoPath: movieFolder?.path ?? "public",
    albumPath: albumFolder?.path ?? "public",
    generatedAt: Date.now(),
  };

  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
