import { requireUser } from "@/lib/auth";
import { ensureCleanupScheduler } from "@/lib/cleanup";
import FileBrowser from "@/components/FileBrowser";

export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; view?: string; q?: string }>;
}) {
  const user = await requireUser();
  ensureCleanupScheduler();
  const { path, view, q } = await searchParams;
  return (
    <FileBrowser
      user={user}
      initialPath={path || ""}
      initialView={view}
      initialQuery={q || ""}
    />
  );
}
