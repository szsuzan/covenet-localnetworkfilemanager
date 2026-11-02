import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import SecurityPanel from "@/components/SecurityPanel";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <SecurityPanel user={user} />;
}
