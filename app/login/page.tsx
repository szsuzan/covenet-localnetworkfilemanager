import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/security" : "/files");
  return (
    <div className="auth-shell">
      <section className="auth-hero">
        <div className="brand auth-brand">
          <div className="brand-mark">C</div>
          <span>Cove</span>
        </div>
        <div className="auth-copy">
          <span className="auth-kicker">Your private file space</span>
          <h1>
            Everything you keep,
            <br />
            close at hand.
          </h1>
          <p>
            A calm home for photos, videos and documents — shared with the people
            you choose, private by default.
          </p>
          <ul className="auth-points">
            <li>Public and private spaces</li>
            <li>Fast streaming on your network</li>
            <li>Reachable anywhere with Tailscale</li>
          </ul>
        </div>
        <div className="auth-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="auth-panel">
        <div className="login-theme">
          <ThemeToggle />
        </div>
        <div className="login-card">
          <div className="login-brand">
            <div className="brand-mark">C</div>
            <h1>Welcome back</h1>
            <p>Sign in to continue to Cove</p>
          </div>
          <LoginForm />
        </div>
        <p className="auth-foot">Cove · private file server</p>
        <p className="auth-foot">
          <a href="/cove-ca.crt" download>
            Install the Cove certificate
          </a>
        </p>
      </section>
    </div>
  );
}
