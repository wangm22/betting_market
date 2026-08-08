// Stateless, HMAC-signed session cookie. No sessions table: the cookie value
// itself is `v1.<userId>.<expiresMs>.<sig>`, and `<sig>` is an HMAC-SHA256
// over `<userId>.<expiresMs>` keyed by SESSION_SECRET — so a valid cookie is
// proof of authenticity without a DB round-trip.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUserById } from "./data/users";
import type { UserRow } from "./types";

const COOKIE_NAME = "bm_session";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// Read lazily (inside functions, not at module scope) so tests can set
// process.env.SESSION_SECRET before first use, and so a missing secret
// fails loudly instead of silently signing with `undefined`.
function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

// Builds the full cookie value. Exported (in addition to being used by
// createSessionCookie) so tests can exercise the sign/verify pair directly
// without going through cookies().
export function signSession(userId: number, expiresMs: number): string {
  const sig = sign(`${userId}.${expiresMs}`);
  return `v1.${userId}.${expiresMs}.${sig}`;
}

// Verifies format, version, expiry, and signature (constant-time compare).
// Returns the userId on success, or null on ANY failure — never throws.
export function verifySessionValue(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, userIdStr, expiresMsStr, sig] = parts;
  if (version !== "v1") return null;
  if (!/^\d+$/.test(userIdStr) || !/^\d+$/.test(expiresMsStr)) return null;

  const userId = Number(userIdStr);
  const expiresMs = Number(expiresMsStr);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(expiresMs)) {
    return null;
  }
  if (expiresMs <= Date.now()) return null;

  const expected = sign(`${userId}.${expiresMs}`);
  const actual = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(actual, expectedBuf)) return null;

  return userId;
}

export async function createSessionCookie(userId: number): Promise<void> {
  const expiresMs = Date.now() + THIRTY_DAYS_MS;
  const store = await cookies();
  store.set(COOKIE_NAME, signSession(userId, expiresMs), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_S,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const userId = verifySessionValue(raw);
  if (userId === null) return null;

  // User may have been deleted since the cookie was issued.
  return getUserById(userId);
}

// For pages: send logged-out visitors to /login, optionally remembering
// where they were headed so login can redirect back via ?next=.
export async function requireUserOrRedirect(
  nextPath?: string,
): Promise<UserRow> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
}

// For server actions: actions can't render a redirect target mid-mutation
// the way a page can, so failing auth here is an error the caller/UI shows.
export async function requireUserOrThrow(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("You must be logged in.");
  return user;
}
