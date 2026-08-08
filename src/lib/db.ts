import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_DDL } from "./schema";

// DATABASE_PATH override exists for tests; production uses data/market.db.
const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "market.db");

type DB = InstanceType<typeof Database>;

// globalThis singleton so dev-server HMR doesn't reopen handles.
const g = globalThis as unknown as { __bmDb?: DB };

function open(): DB {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  d.exec(SCHEMA_DDL);
  return d;
}

export const db: DB = (g.__bmDb ??= open());
