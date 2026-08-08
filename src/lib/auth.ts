// Password hashing via scrypt (node:crypto, default cost params). Pure
// module — no Next.js or DB imports — so it's trivially unit-testable.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const KEY_BYTES = 64;

// "s2:<16-byte salt hex>:<64-byte hash hex>". Versioned prefix so the
// scheme/params can change later without breaking old hashes.
export function hashPassword(pw: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pw, salt, KEY_BYTES);
  return `s2:${salt.toString("hex")}:${hash.toString("hex")}`;
}

// Parses `stored`, recomputes the hash with the same salt, and compares in
// constant time. Never throws — any malformed input just fails verification.
export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const parts = stored.split(":");
    if (parts.length !== 3) return false;
    const [version, saltHex, hashHex] = parts;
    if (version !== "s2") return false;

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
      return false;
    }

    const actual = scryptSync(pw, salt, KEY_BYTES);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
