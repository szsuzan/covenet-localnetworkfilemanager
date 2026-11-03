import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { apiUser, fail, originOk, safeError } from "@/lib/api";
import { audit } from "@/lib/audit";
import {
  assertName,
  resolveUserPath,
  uniqueDestination,
  UPLOAD_ROOT,
  virtualJoin,
} from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Meta = { dir: string; name: string; size: number; userId: number };

const ID = /^[a-zA-Z0-9-]{8,64}$/;

function metaPath(id: string) {
  return path.join(UPLOAD_ROOT, `${id}.json`);
}
function partPath(id: string) {
  return path.join(UPLOAD_ROOT, `${id}.part`);
}
function readMeta(id: string): Meta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8")) as Meta;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  if (!user.canUpload) return fail("Your account cannot upload", 403);

  const body = (await req.json().catch(() => null)) as
    | { action?: string; id?: string; dir?: string; name?: string; size?: number }
    | null;
  if (!body?.action || !body.id || !ID.test(body.id)) return fail("Invalid upload");

  if (body.action === "init") {
    try {
      if (!body.dir) return fail("Open Public or Private first");
      const dir = body.dir;
      if (dir === "shared" || dir.startsWith("shared/")) {
        return fail("Shared folders are read-only", 403);
      }
      const dirAbs = resolveUserPath(user, dir).abs;
      await fs.promises.mkdir(dirAbs, { recursive: true });
      const name = assertName(body.name || "");
      const size = Number(body.size);
      if (!Number.isFinite(size) || size < 0) return fail("Invalid file size");
      const maxBytes = (Number(process.env.MAX_UPLOAD_GB) || 200) * 1024 ** 3;
      if (size > maxBytes) return fail("File exceeds the upload size limit", 413);

      const existing = readMeta(body.id);
      const same =
        existing &&
        existing.userId === user.id &&
        existing.dir === dir &&
        existing.name === name &&
        existing.size === size &&
        fs.existsSync(partPath(body.id));

      if (!same) {
        fs.rmSync(partPath(body.id), { force: true });
        fs.writeFileSync(
          metaPath(body.id),
          JSON.stringify({ dir, name, size, userId: user.id }),
        );
      }
      const offset = fs.existsSync(partPath(body.id))
        ? fs.statSync(partPath(body.id)).size
        : 0;
      return NextResponse.json({ offset });
    } catch (error) {
      return fail(safeError(error, "Could not start upload"));
    }
  }

  const meta = readMeta(body.id);
  if (!meta) return fail("Upload not found", 404);
  if (meta.userId !== user.id) return fail("Upload not found", 404);

  if (body.action === "complete") {
    const part = partPath(body.id);
    const stat = fs.existsSync(part) ? fs.statSync(part) : null;
    if (!stat) return fail("Upload not found", 404);
    if (stat.size !== meta.size) {
      return NextResponse.json({ offset: stat.size, error: "Upload incomplete" }, { status: 409 });
    }
    try {
      if (meta.dir === "shared" || meta.dir.startsWith("shared/")) {
        return fail("Shared folders are read-only", 403);
      }
      const dirAbs = resolveUserPath(user, meta.dir).abs;
      const dest = uniqueDestination(dirAbs, meta.name);
      await fs.promises.rename(part, dest);
      fs.rmSync(metaPath(body.id), { force: true });
      const virtual = virtualJoin(meta.dir, path.basename(dest));
      audit(user, "file.upload", virtual, req);
      return NextResponse.json({ path: virtual });
    } catch (error) {
      return fail(safeError(error, "Could not finish upload"), 500);
    }
  }

  if (body.action === "abort") {
    fs.rmSync(partPath(body.id), { force: true });
    fs.rmSync(metaPath(body.id), { force: true });
    return NextResponse.json({ ok: true });
  }

  return fail("Unknown action");
}

export async function PUT(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);
  if (!user.canUpload) return fail("Your account cannot upload", 403);

  const params = new URL(req.url).searchParams;
  const id = params.get("id") || "";
  const offset = Number(params.get("offset"));
  if (!ID.test(id) || !Number.isFinite(offset)) return fail("Invalid upload");
  const meta = readMeta(id);
  if (!meta || meta.userId !== user.id) return fail("Upload not found", 404);

  const part = partPath(id);
  const current = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (offset !== current) {
    return NextResponse.json({ offset: current, error: "Offset mismatch" }, { status: 409 });
  }

  const chunk = Buffer.from(await req.arrayBuffer());
  if (chunk.length === 0) return NextResponse.json({ offset: current });
  if (chunk.length > 32 * 1024 * 1024) return fail("Chunk too large", 413);
  if (current + chunk.length > meta.size) return fail("Chunk exceeds declared size");

  const handle = await fs.promises.open(part, "a");
  try {
    await handle.write(chunk);
  } finally {
    await handle.close();
  }
  return NextResponse.json({ offset: current + chunk.length });
}
