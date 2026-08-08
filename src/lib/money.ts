// All prices, settle values, and PnL are integer hundredths ("cents")
// everywhere in the DB and engine. Conversion to/from display strings
// happens only through this module — never via parseFloat arithmetic.

export const MAX_SIZE = 10_000;
// Numeric prices/settles bounded to ±1,000,000.00.
export const MAX_NUMERIC_C = 100_000_000;

// "27.5" -> 2750, "-4.25" -> -425, "60" -> 6000. Rejects >2 decimals,
// junk, and empty strings. Range checks are the caller's job.
export function parseToHundredths(input: string): number | null {
  const s = input.trim();
  if (!/^-?\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [intPart, decPart = ""] = (neg ? s.slice(1) : s).split(".");
  const c = parseInt(intPart, 10) * 100 + (decPart ? parseInt(decPart.padEnd(2, "0"), 10) : 0);
  return neg ? -c : c;
}

// 2750 -> "27.50", -425 -> "-4.25"
export function formatC(c: number): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

// Binary prices are whole probability points, so render without decimals.
export function formatPrice(c: number, type: "binary" | "numeric"): string {
  return type === "binary" ? String(c / 100) : formatC(c);
}

// Sizes are whole contracts, 1..MAX_SIZE.
export function parseSize(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 && n <= MAX_SIZE ? n : null;
}

// Binary prices: integers 1..99 (probability points), stored as hundredths.
export function parseBinaryPriceC(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 99 ? n * 100 : null;
}

// Numeric prices: ≤2 decimals, may be negative, within ±MAX_NUMERIC_C.
export function parseNumericPriceC(input: string): number | null {
  const c = parseToHundredths(input);
  if (c === null) return null;
  return Math.abs(c) <= MAX_NUMERIC_C ? c : null;
}
