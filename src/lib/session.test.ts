import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./auth";
import { signSession, verifySessionValue } from "./session";

// signSession/verifySessionValue read SESSION_SECRET lazily, so setting it
// here (rather than via .env.local) is enough — no module reset needed.
process.env.SESSION_SECRET = "test-session-secret-do-not-use-in-prod";

describe("signSession / verifySessionValue", () => {
  it("round-trips: verify(sign(userId)) returns that userId", () => {
    const value = signSession(7, Date.now() + 60_000);
    expect(verifySessionValue(value)).toBe(7);
  });

  it("rejects a tampered payload (userId changed after signing)", () => {
    const value = signSession(7, Date.now() + 60_000);
    const [version, , expiresMs, sig] = value.split(".");
    const tampered = `${version}.8.${expiresMs}.${sig}`;
    expect(verifySessionValue(tampered)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const value = signSession(7, Date.now() + 60_000);
    const last = value[value.length - 1];
    const flipped = last === "A" ? "B" : "A";
    const tampered = value.slice(0, -1) + flipped;
    expect(verifySessionValue(tampered)).toBeNull();
  });

  it("rejects an expired session", () => {
    const value = signSession(7, Date.now() - 1);
    expect(verifySessionValue(value)).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(verifySessionValue("")).toBeNull();
    expect(verifySessionValue("garbage")).toBeNull();
    expect(verifySessionValue("v1.7.not-a-number.sig")).toBeNull();
    expect(verifySessionValue("v2.7.9999999999999.sig")).toBeNull(); // wrong version
    expect(verifySessionValue("v1.7.9999999999999")).toBeNull(); // missing segment
  });
});

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its hash", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("rejects malformed stored strings without throwing", () => {
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "not-the-right-format")).toBe(false);
    expect(verifyPassword("anything", "s2:short:short")).toBe(false);
    expect(
      verifyPassword("anything", `s1:${"00".repeat(16)}:${"00".repeat(64)}`),
    ).toBe(false); // wrong version prefix
  });
});
