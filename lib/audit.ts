import { db } from "./db";
import { clientAgent, clientIp } from "./security";

export function audit(
  actor: { id?: number | null; username?: string | null },
  action: string,
  target: string | null,
  req?: { headers: Headers },
) {
  try {
    db()
      .prepare(
        `INSERT INTO audit_log (user_id, username, action, target, ip, user_agent, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor.id ?? null,
        actor.username ?? null,
        action.slice(0, 80),
        target ? target.slice(0, 300) : null,
        req ? clientIp(req) : null,
        req ? clientAgent(req) : null,
        Date.now(),
      );
    db()
      .prepare("DELETE FROM audit_log WHERE at < ?")
      .run(Date.now() - 90 * 24 * 60 * 60 * 1000);
  } catch {
    /* auditing must never break the request */
  }
}
