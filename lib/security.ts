const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "admin123",
  "admin1234",
  "letmein123",
  "welcome123",
  "changeme123",
  "iloveyou",
]);

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string, username: string) {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 200) return "Password is too long";
  if (COMMON.has(password.toLowerCase())) return "That password is too common";
  if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    return "Password must not contain the username";
  }

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) {
    return "Use at least 3 of: lowercase, uppercase, numbers, symbols";
  }
  return null;
}

const TRUST_PROXY = process.env.TRUST_PROXY === "1";

export function clientIp(req: { headers: Headers }) {
  // Direct HTTP exposure: X-Forwarded-For is spoofable, so do not trust it.
  if (!TRUST_PROXY) return "local";
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

export function clientAgent(req: { headers: Headers }) {
  return (req.headers.get("user-agent") || "").slice(0, 300);
}
