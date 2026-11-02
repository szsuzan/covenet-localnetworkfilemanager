import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { type NextRequest } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { resolveUserPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 500;

async function addDirectory(
  archive: ZipFile,
  absDir: string,
  prefix: string,
) {
  const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow links outside the space
    const full = path.join(absDir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await addDirectory(archive, full, name);
    } else if (entry.isFile()) {
      archive.addFile(full, name);
    }
  }
}

export async function GET(req: NextRequest) {
  const user = await apiUser();
  if (!user) return fail("Not signed in", 401);

  const params = new URL(req.url).searchParams;
  const requested = params.getAll("path").filter(Boolean).slice(0, MAX_ITEMS);
  if (requested.length === 0) return fail("Nothing to download");

  const entries: Array<{ abs: string; name: string; isDir: boolean }> = [];
  for (const rel of requested) {
    try {
      const { abs } = resolveUserPath(user, rel);
      const stat = await fs.promises.stat(abs);
      entries.push({ abs, name: path.basename(abs), isDir: stat.isDirectory() });
    } catch {
      return fail(`Not found: ${rel}`, 404);
    }
  }

  const archive = new ZipFile();
  const output = archive.outputStream as unknown as Readable;
  output.on("error", () => output.destroy());
  req.signal.addEventListener("abort", () => output.destroy());

  for (const entry of entries) {
    if (entry.isDir) {
      await addDirectory(archive, entry.abs, entry.name);
    } else {
      archive.addFile(entry.abs, entry.name);
    }
  }
  archive.end();

  const filename =
    entries.length === 1
      ? `${entries[0].name.replace(/[^\w.-]+/g, "_")}.zip`
      : "CoveNet-selection.zip";

  return new Response(Readable.toWeb(output) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
