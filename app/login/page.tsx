import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/security" : "/files");
  return (
    <div className="login-wrap">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">C</div>
          <h1>Cove</h1>
          <p>Private files, kept close.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
