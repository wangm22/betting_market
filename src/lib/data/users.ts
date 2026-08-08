import { db } from "../db";
import type { UserRow } from "../types";

// Unique-constraint violations (duplicate username, case-insensitive via the
// column's COLLATE NOCASE) are left to propagate as better-sqlite3's
// SqliteError with `.code === "SQLITE_CONSTRAINT_UNIQUE"` — callers
// (registerAction) catch that specific code.
export function createUser(username: string, passwordHash: string): UserRow {
  const result = db
    .prepare(
      `INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
    )
    .run(username, passwordHash, Date.now());

  const user = getUserById(Number(result.lastInsertRowid));
  if (!user) {
    throw new Error("Failed to load user immediately after insert.");
  }
  return user;
}

// `=` is case-insensitive here because `users.username` is declared
// COLLATE NOCASE in the schema.
export function getUserByUsername(username: string): UserRow | null {
  const row = db
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get(username) as UserRow | undefined;
  return row ?? null;
}

export function getUserById(id: number): UserRow | null {
  const row = db
    .prepare(`SELECT * FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  return row ?? null;
}
