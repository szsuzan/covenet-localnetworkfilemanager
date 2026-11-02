import { requireAdmin } from "@/lib/auth";
import { ensureCleanupScheduler } from "@/lib/cleanup";
import AdminPanel from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireAdmin();
  ensureCleanupScheduler();
  return <AdminPanel me={user} />;
}
