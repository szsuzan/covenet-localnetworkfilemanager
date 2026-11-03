import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk, safeError } from "@/lib/api";
import type { SessionUser } from "@/lib/db";
import { kindOf } from "@/lib/kinds";
import {
  assertName,
  isHidden,
  PRIVATE_ROOT,
  PUBLIC_ROOT,
  resolveUserPath,
  uniqueDestination,
  virtualJoin,
  virtualParent,
} from "@/lib/paths";
import { receivedShareItems, revokeSharesUnder } from "@/lib/shares";
import { moveToTrash } from "@/lib/trash";
import { audit } from "@/lib/audit";

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

async function rootListing(user: SessionUser) {
  const [pub, priv, shared] = await Promise.all([
    fs.promises.stat(PUBLIC_ROOT).catch(() => null),
    fs.promises.stat(path.join(PRIVATE_ROOT, user.username)).catch(() => null),
    receivedShareItems(user),
  ]);
  const items: Item[] = [
    {
      name: "Public",
      path: "public",
      isDir: true,
      size: 0,
      mtime: pub ? Math.floor(pub.mtimeMs) : 0,
      kind: "folder",
    },
    {
      name: "Private",
      path: "private",
      isDir: true,
      size: 0,
      mtime: priv ? Math.floor(priv.mtimeMs) : 0,
      kind: "folder",
    },
  ];
  if (shared.length > 0) {
    items.push({
      name: "Shared with me",
      path: "shared",
      isDir: true,
      size: 0,
      mtime: Math.max(...shared.map((item) => item.mtime)),
      kind: "folder",
    });
  }
  return { path: "", parent: "", items };
}

async function list(user: SessionUser, rel: string) {
  if (!rel) return rootListing(user);
  if (rel === "shared") {
    return { path: "shared", parent: "", items: await receivedShareItems(user) };
  }
  if (rel.startsWith("shared/") && rel.split("/").length === 2) {
    const owner = rel.slice("shared/".length);
    const items = (await receivedShareItems(user)).filter((item) =>
      item.path.startsWith(`shared/${owner}/`),
    );
    return { path: rel, parent: "shared", items };
  }

  const { abs: dir, virtual } = resolveUserPath(user, rel);
  const stat = await fs.promises.stat(dir);
  if (!stat.isDirectory()) throw new Error("Not a folder");

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const items: Item[] = [];
  const visible = entries
    .filter((entry) => !isHidden(entry.name) && !entry.isSymbolicLink())
    .slice(0, 5000);

  // Stat in small batches: 5000 sequential stats is slow on large folders.
  for (let offset = 0; offset < visible.length; offset += 32) {
    const batch = await Promise.all(
      visible.slice(offset, offset + 32).map(async (entry) => {
        const full = path.join(dir, entry.name);
        try {
          const st = await fs.promises.stat(full);
          const isDir = st.isDirectory();
          return {
            name: entry.name,
            path: virtualJoin(virtual, entry.name),
            isDir,
            size: isDir ? 0 : st.size,
            mtime: Math.floor(st.mtimeMs),
            kind: kindOf(entry.name, isDir),
          } satisfies Item;
        } catch {
          return null;
        }
      }),
    );
    for (const item of batch) if (item) items.push(item);
  }
  items.sort((a, b) =>
    a.isDir === b.isDir
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      : a.isDir
        ? -1
        : 1,
  );
  return { path: virtual, parent: virtualParent(virtual), items };
}

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  const rel = new URL(req.url).searchParams.get("path") || "";
  try {
    return NextResponse.json(await list(user, rel));
  } catch (error) {
    return fail(safeError(error, "Could not read folder"), 404);
  }
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const body = (await req.json().catch(() => null)) as
    | { action?: string; path?: string; dir?: string; name?: string; destDir?: string }
    | null;
  if (!body?.action) return fail("Missing action");

  const readOnly = (virtual: string) =>
    virtual === "shared" || virtual.startsWith("shared/");
  const revokePrivateShare = (virtual: string) => {
    if (!virtual.startsWith("private/")) return;
    const rel = virtual.slice("private/".length);
    if (rel) revokeSharesUnder(user.id, rel);
  };

  try {
    if (body.action === "mkdir") {
      if (!body.dir) return fail("Open Public or Private first");
      const name = assertName(body.name || "");
      const target = virtualJoin(body.dir, name);
      if (readOnly(target)) return fail("Shared folders are read-only", 403);
      const { abs } = resolveUserPath(user, target);
      await fs.promises.mkdir(abs);
      audit(user, "folder.create", target, req);
      return NextResponse.json({ ok: true, path: target });
    }

    if (body.action === "rename") {
      const { abs: src, virtual } = resolveUserPath(user, body.path);
      if (readOnly(virtual)) return fail("Shared folders are read-only", 403);
      if (virtual === "public" || virtual === "private") {
        return fail("Cannot rename a space");
      }
      const name = assertName(body.name || "");
      const dest = path.join(path.dirname(src), name);
      if (fs.existsSync(dest)) {
        return fail("A file or folder with that name already exists", 409);
      }
      await fs.promises.rename(src, dest);
      revokePrivateShare(virtual);
      audit(user, "file.rename", `${virtual} -> ${name}`, req);
      return NextResponse.json({
        ok: true,
        path: virtualJoin(virtualParent(virtual), name),
      });
    }

    if (body.action === "move") {
      const { abs: src, virtual } = resolveUserPath(user, body.path);
      if (readOnly(virtual)) return fail("Shared folders are read-only", 403);
      if (virtual === "public" || virtual === "private") {
        return fail("Cannot move a space");
      }
      const { abs: destDir, virtual: destVirtual } = resolveUserPath(
        user,
        body.destDir,
      );
      if (readOnly(destVirtual)) return fail("Shared folders are read-only", 403);
      const dirStat = await fs.promises.stat(destDir);
      if (!dirStat.isDirectory()) return fail("Destination is not a folder");
      if (destDir === src || destDir.startsWith(src + path.sep)) {
        return fail("Cannot move a folder inside itself");
      }
      const dest = uniqueDestination(destDir, path.basename(src));
      await fs.promises.rename(src, dest);
      revokePrivateShare(virtual);
      audit(user, "file.move", `${virtual} -> ${destVirtual}`, req);
      return NextResponse.json({
        ok: true,
        path: virtualJoin(destVirtual, path.basename(dest)),
      });
    }

    if (body.action === "delete") {
      const { abs: src, virtual } = resolveUserPath(user, body.path);
      if (readOnly(virtual)) return fail("Shared folders are read-only", 403);
      if (virtual === "public" || virtual === "private") {
        return fail("Cannot delete a space");
      }
      await fs.promises.lstat(src);
      await moveToTrash(src, virtual, user.id);
      revokePrivateShare(virtual);
      audit(user, "file.delete", virtual, req);
      return NextResponse.json({ ok: true });
    }

    return fail("Unknown action");
  } catch (error) {
    const message = safeError(error, "Operation failed");
    return fail(message, message.includes("exist") ? 409 : 400);
  }
}
