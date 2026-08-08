"use server";

// Auth actions only. A later agent appends market/order/settlement actions
// to this same file — keep additions here scoped to register/login/logout.

import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { clearSessionCookie, createSessionCookie } from "@/lib/session";
import { createUser, getUserByUsername } from "@/lib/data/users";
// Additions below this line support the market/order/settlement actions
// appended at the end of this file; the auth actions above are unchanged.
import { revalidatePath } from "next/cache";
import { AuthError, requireUserOrThrow } from "@/lib/session";
import { createMarket, getMarket, settleMarket } from "@/lib/data/markets";
import { cancelOrder, submitQuote, type LegFill, type LegResult } from "@/lib/data/orders";
import {
  formatPrice,
  parseBinaryPriceC,
  parseNumericPriceC,
  parseSize,
  parseToHundredths,
} from "@/lib/money";
import type { MarketType, QuoteLeg, Side } from "@/lib/types";

export type ActionState = { error?: string; message?: string };

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export async function registerAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!USERNAME_RE.test(username)) {
    return {
      error:
        "Username must be 3-20 characters: letters, numbers, underscore only.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (confirm !== password) {
    return { error: "Passwords do not match." };
  }

  let userId: number;
  try {
    const user = createUser(username, hashPassword(password));
    userId = user.id;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { error: "That username is taken." };
    }
    throw err;
  }

  await createSessionCookie(userId);
  redirect("/markets");
}

export async function loginAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    // Same message for "no such user" and "wrong password" so login can't
    // be used to enumerate registered usernames.
    return { error: "Invalid username or password." };
  }

  await createSessionCookie(user.id);

  // Open-redirect guard: only ever redirect to a same-site path.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/markets";
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Markets, orders, and settlement. Every action below re-validates the
// session (and, for settlement, ownership) itself — never trust that a page
// only rendering a form to an authorized viewer is enough, since actions are
// reachable directly.
// ---------------------------------------------------------------------------

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const UNIT_MAX = 20;

function isMarketType(value: string): value is MarketType {
  return value === "binary" || value === "numeric";
}

export async function createMarketAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof AuthError) return { error: "You must be logged in." };
    throw err;
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const unitRaw = String(formData.get("unit") ?? "").trim();

  if (!title || title.length > TITLE_MAX) {
    return { error: `Title must be 1-${TITLE_MAX} characters.` };
  }
  if (description.length > DESCRIPTION_MAX) {
    return { error: `Description must be at most ${DESCRIPTION_MAX} characters.` };
  }
  if (!isMarketType(type)) {
    return { error: "Choose a market type." };
  }
  if (unitRaw.length > UNIT_MAX) {
    return { error: `Unit must be at most ${UNIT_MAX} characters.` };
  }

  const unit = type === "numeric" && unitRaw.length > 0 ? unitRaw : null;

  let market;
  try {
    market = createMarket(user.id, { title, description, type, unit });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create market." };
  }

  redirect(`/markets/${market.id}`);
}

type LegFieldLabel = "Bid" | "Offer";

// Parses one leg's raw price/size strings against the market's type. Returns
// a tagged union instead of throwing so the action can return a clean
// { error } without a try/catch per leg.
function parseLeg(
  priceInput: string,
  sizeInput: string,
  label: LegFieldLabel,
  marketType: MarketType,
): { leg: QuoteLeg } | { error: string } {
  const priceC =
    marketType === "binary" ? parseBinaryPriceC(priceInput) : parseNumericPriceC(priceInput);
  if (priceC === null) {
    if (marketType === "binary") {
      return {
        error: `${label} price must be between 0.01 and 9.99 (up to 2 decimals).`,
      };
    }
    // Well-formed but rejected means it failed the range check, not the format.
    const outOfRange = parseToHundredths(priceInput) !== null;
    return {
      error: outOfRange
        ? `${label} price must be between -1,000,000 and 1,000,000.`
        : `${label} price must be a number with at most 2 decimals.`,
    };
  }

  const size = parseSize(sizeInput);
  if (size === null) {
    return { error: "Sizes must be whole numbers 1–10,000." };
  }

  return { leg: { priceC, size } };
}

function formatFillsPhrase(side: Side, fills: LegFill[], marketType: MarketType): string {
  const verb = side === "buy" ? "bought" : "sold";
  const fillStrs = fills.map((f) => `${f.size} @ ${formatPrice(f.priceC, marketType)}`);
  return `${verb} ${fillStrs.join(" and ")}`;
}

function formatRestPhrase(
  side: Side,
  restedSize: number,
  limitPriceC: number,
  hasFills: boolean,
  marketType: MarketType,
): string {
  const noun = side === "buy" ? "bid" : "offer";
  const qualifier = hasFills ? "more " : "";
  return `${noun} for ${restedSize} ${qualifier}resting at ${formatPrice(limitPriceC, marketType)}`;
}

// Builds e.g. "Bought 6 @ 60 and 3 @ 62; bid for 5 more resting at 63." from
// the per-leg results, using the original leg inputs for the resting limit
// price (LegResult itself doesn't carry it).
function buildQuoteMessage(
  results: LegResult[],
  legs: { bid?: QuoteLeg; offer?: QuoteLeg },
  marketType: MarketType,
): string {
  const legPhrases = results.map((result) => {
    const leg = result.side === "buy" ? legs.bid : legs.offer;
    const limitPriceC = leg ? leg.priceC : 0;
    const phrases: string[] = [];
    if (result.fills.length > 0) {
      phrases.push(formatFillsPhrase(result.side, result.fills, marketType));
    }
    if (result.restedSize > 0) {
      phrases.push(
        formatRestPhrase(
          result.side,
          result.restedSize,
          limitPriceC,
          result.fills.length > 0,
          marketType,
        ),
      );
    }
    return phrases.join("; ");
  });

  const message = legPhrases.join("; ");
  return message.charAt(0).toUpperCase() + message.slice(1) + ".";
}

export async function submitQuoteAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof AuthError) return { error: "You must be logged in." };
    throw err;
  }

  const marketId = Number(formData.get("marketId"));
  if (!Number.isInteger(marketId)) {
    return { error: "Invalid market." };
  }

  const market = getMarket(marketId);
  if (!market) {
    return { error: "Market not found." };
  }

  const bidPrice = String(formData.get("bidPrice") ?? "").trim();
  const bidSize = String(formData.get("bidSize") ?? "").trim();
  const offerPrice = String(formData.get("offerPrice") ?? "").trim();
  const offerSize = String(formData.get("offerSize") ?? "").trim();

  const bidPresent = bidPrice !== "" || bidSize !== "";
  const offerPresent = offerPrice !== "" || offerSize !== "";

  if (bidPresent && (bidPrice === "" || bidSize === "")) {
    return { error: "Bid needs both a price and a size." };
  }
  if (offerPresent && (offerPrice === "" || offerSize === "")) {
    return { error: "Offer needs both a price and a size." };
  }
  if (!bidPresent && !offerPresent) {
    return { error: "Enter a bid, an offer, or both." };
  }

  const legs: { bid?: QuoteLeg; offer?: QuoteLeg } = {};

  if (bidPresent) {
    const parsed = parseLeg(bidPrice, bidSize, "Bid", market.type);
    if ("error" in parsed) return { error: parsed.error };
    legs.bid = parsed.leg;
  }
  if (offerPresent) {
    const parsed = parseLeg(offerPrice, offerSize, "Offer", market.type);
    if ("error" in parsed) return { error: parsed.error };
    legs.offer = parsed.leg;
  }

  let results: LegResult[];
  try {
    results = submitQuote(marketId, user.id, legs);
  } catch (err) {
    if (err instanceof Error) return { error: err.message };
    throw err;
  }

  revalidatePath(`/markets/${marketId}`);
  return { message: buildQuoteMessage(results, legs, market.type) };
}

export async function cancelOrderAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof AuthError) return { error: "You must be logged in." };
    throw err;
  }

  const orderId = Number(formData.get("orderId"));
  const marketId = Number(formData.get("marketId"));
  if (!Number.isInteger(orderId) || !Number.isInteger(marketId)) {
    return { error: "Invalid order." };
  }

  const cancelled = cancelOrder(orderId, user.id);
  if (!cancelled) {
    return { error: "Order already filled or cancelled." };
  }

  revalidatePath(`/markets/${marketId}`);
  revalidatePath(`/users/${user.username}`);
  return { message: "Order cancelled." };
}

export async function settleMarketAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof AuthError) return { error: "You must be logged in." };
    throw err;
  }

  const marketId = Number(formData.get("marketId"));
  if (!Number.isInteger(marketId)) {
    return { error: "Invalid market." };
  }

  const market = getMarket(marketId);
  if (!market) {
    return { error: "Market not found." };
  }

  let settleC: number;
  if (market.type === "binary") {
    const outcome = String(formData.get("outcome") ?? "");
    if (outcome !== "yes" && outcome !== "no") {
      return { error: "Choose an outcome." };
    }
    settleC = outcome === "yes" ? 1000 : 0;
  } else {
    const value = String(formData.get("value") ?? "");
    const parsed = parseNumericPriceC(value);
    if (parsed === null) {
      return { error: "Settle value must be a number with at most 2 decimals." };
    }
    settleC = parsed;
  }

  try {
    settleMarket(marketId, user.id, settleC);
  } catch (err) {
    if (err instanceof Error) return { error: err.message };
    throw err;
  }

  revalidatePath(`/markets/${marketId}`);
  revalidatePath("/markets");
  revalidatePath("/leaderboard");
  return { message: "Market settled." };
}
