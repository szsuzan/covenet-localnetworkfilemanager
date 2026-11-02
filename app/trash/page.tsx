import { requireUser } from "@/lib/auth";
import { ensureCleanupScheduler } from "@/lib/cleanup";
import TrashPanel from "@/components/TrashPanel";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const user = await requireUser();
  ensureCleanupScheduler();
  return <TrashPanel user={user} />;
}
