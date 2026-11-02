import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compareSync, hashSync } from "bcryptjs";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  can_upload INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, path)
);
CREATE TABLE IF NOT EXISTS watch_progress (
  user_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  position REAL NOT NULL,
  duration REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, path)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT,
  ip TEXT,
  user_agent TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);
CREATE TABLE IF NOT EXISTS login_throttle (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
`;

const globalForDb = globalThis as unknown as { __coveDb?: DatabaseSync };

function ensureColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function open(): DatabaseSync {
  if (globalForDb.__coveDb) return globalForDb.__coveDb;
  const database = new DatabaseSync(path.join(dataDir, "app.db"));
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(SCHEMA);

  // Migrations for databases created before these columns existed.
  ensureColumn(database, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "users", "totp_secret", "TEXT");
  ensureColumn(database, "users", "totp_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "sessions", "last_seen", "INTEGER NOT NULL DEFAULT 0");
  database.prepare("UPDATE sessions SET last_seen = ? WHERE last_seen = 0").run(Date.now());

  const seeded = database.prepare("SELECT COUNT(*) AS c FROM users").get() as {
    c: number;
  };
  if (seeded.c === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    database
      .prepare(
        `INSERT INTO users (username, password_hash, role, can_upload, must_change_password, created_at)
         VALUES (?, ?, 'admin', 1, 1, ?)`,
      )
      .run(username, hashSync(password, 12), Date.now());
    console.log(
      `[init] created admin account "${username}" — you will be asked to change its password`,
    );
  } else {
    // Force a password change if the seeded admin still has the default password.
    const username = process.env.ADMIN_USERNAME || "admin";
    const defaultPassword = process.env.ADMIN_PASSWORD || "admin123";
    const admin = database
      .prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .get(username) as { id: number; password_hash: string } | undefined;
    if (admin && compareSync(defaultPassword, admin.password_hash)) {
      database
        .prepare("UPDATE users SET must_change_password = 1 WHERE id = ?")
        .run(admin.id);
    }
  }

  database.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  database
    .prepare("DELETE FROM login_throttle WHERE first_at < ?")
    .run(Date.now() - 7 * 24 * 60 * 60 * 1000);
  globalForDb.__coveDb = database;
  return database;
}

export function db(): DatabaseSync {
  return open();
}

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "user";
  can_upload: number;
  disabled: number;
  must_change_password: number;
  totp_secret: string | null;
  totp_enabled: number;
  created_at: number;
};

export type SessionUser = {
  id: number;
  username: string;
  role: "admin" | "user";
  canUpload: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
};
