import { db } from "../db";
import { matchIncoming } from "../engine/match";
import { formatPrice, MAX_NUMERIC_C, MAX_SIZE } from "../money";
import type { MarketType, OrderRow, QuoteLeg, Side, TradeRow } from "../types";
import { getMarket } from "./markets";

export class SelfTradeError extends Error {
  offendingOrderId: number;
  constructor(message: string, offendingOrderId: number) {
    super(message);
    this.name = "SelfTradeError";
    this.offendingOrderId = offendingOrderId;
  }
}

export class MarketClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketClosedError";
  }
}

export interface LegFill {
  priceC: number;
  size: number;
}

export interface LegResult {
  side: Side;
  orderId: number;
  fills: LegFill[];
  filledSize: number;
  restedSize: number;
}

// Row shape returned by the resting-book SELECT below (snake_case, as
// SQLite hands it back).
interface RestingRow {
  id: number;
  user_id: number;
  price_c: number;
  remaining: number;
}

// Defense-in-depth: the create-quote action already validates with
// parseBinaryPriceC/parseNumericPriceC/parseSize before calling submitQuote,
// so these throws should be unreachable from the UI. Kept strict anyway
// since this module is the one place a bad price/size could corrupt the book.
function validateLeg(leg: QuoteLeg, marketType: MarketType): void {
  if (!Number.isInteger(leg.size) || leg.size < 1 || leg.size > MAX_SIZE) {
    throw new Error("Sizes must be whole numbers 1–10,000.");
  }
  if (!Number.isInteger(leg.priceC)) {
    throw new Error("Invalid price.");
  }
  if (marketType === "binary") {
    if (leg.priceC < 1 || leg.priceC > 999) {
      throw new Error("Invalid price.");
    }
  } else if (Math.abs(leg.priceC) > MAX_NUMERIC_C) {
    throw new Error("Invalid price.");
  }
}

// The correctness-critical entry point. Both legs (bid then offer) are
// applied inside ONE transaction: either the whole submission goes through,
// or (self-trade / closed market / bad bid-offer relationship) neither leg
// is entered.
export function submitQuote(
  marketId: number,
  userId: number,
  legs: { bid?: QuoteLeg; offer?: QuoteLeg },
): LegResult[] {
  const run = db.transaction((): LegResult[] => {
    const market = getMarket(marketId);
    if (!market || market.status !== "open") {
      throw new MarketClosedError(
        market ? "This market is settled." : "This market was not found.",
      );
    }

    if (!legs.bid && !legs.offer) {
      throw new Error("At least one leg (bid or offer) is required.");
    }

    if (legs.bid) validateLeg(legs.bid, market.type);
    if (legs.offer) validateLeg(legs.offer, market.type);

    if (legs.bid && legs.offer && !(legs.bid.priceC < legs.offer.priceC)) {
      throw new Error("Your bid must be below your offer.");
    }

    // Bid first, then offer — guarantees the offer (which must be strictly
    // above the bid, checked above) can never immediately cross the bid
    // order this same submission just rested.
    const results: LegResult[] = [];
    if (legs.bid) {
      results.push(processLeg(marketId, userId, "buy", legs.bid, market.type));
    }
    if (legs.offer) {
      results.push(processLeg(marketId, userId, "sell", legs.offer, market.type));
    }
    return results;
  });

  return run();
}

function processLeg(
  marketId: number,
  userId: number,
  side: Side,
  leg: QuoteLeg,
  marketType: MarketType,
): LegResult {
  const oppositeSide: Side = side === "buy" ? "sell" : "buy";
  // Best-first for the taker: incoming buy sweeps sells cheapest-first;
  // incoming sell sweeps buys richest-first. Ties broken by id (time
  // priority) — matchIncoming trusts this ordering and never re-sorts.
  const orderByClause =
    side === "buy" ? "price_c ASC, id ASC" : "price_c DESC, id ASC";

  const restingRows = db
    .prepare(
      `SELECT id, user_id, price_c, remaining FROM orders
       WHERE market_id = ? AND status = 'open' AND side = ?
       ORDER BY ${orderByClause}`,
    )
    .all(marketId, oppositeSide) as RestingRow[];

  const matchResult = matchIncoming(
    { userId, side, priceC: leg.priceC, size: leg.size },
    restingRows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      priceC: r.price_c,
      remaining: r.remaining,
    })),
  );

  if (matchResult.rejected) {
    const verb = side === "buy" ? "bid" : "offer";
    throw new SelfTradeError(
      `Your ${verb} at ${formatPrice(leg.priceC, marketType)} would trade against your own resting order — cancel it first. Nothing was submitted.`,
      matchResult.offendingOrderId,
    );
  }

  const { fills, remainderSize } = matchResult;
  const now = Date.now();

  const orderStatus = remainderSize > 0 ? "open" : "filled";
  const insertResult = db
    .prepare(
      `INSERT INTO orders (market_id, user_id, side, price_c, size, remaining, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(marketId, userId, side, leg.priceC, leg.size, remainderSize, orderStatus, now);
  const orderId = Number(insertResult.lastInsertRowid);

  const updateRestingStmt = db.prepare(
    `UPDATE orders SET remaining = remaining - ?, status = ? WHERE id = ?`,
  );
  const insertTradeStmt = db.prepare(
    `INSERT INTO trades
       (market_id, buy_order_id, sell_order_id, buyer_id, seller_id, price_c, size, taker_side, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const legFills: LegFill[] = [];
  let filledSize = 0;

  // Each resting order id appears at most once across `fills` (the engine
  // sweeps each resting order once, fully or partially), so a plain
  // `remaining - size` here is safe — no risk of a double decrement.
  for (const fill of fills) {
    const restingRow = restingRows.find((r) => r.id === fill.restingOrderId);
    const previousRemaining = restingRow?.remaining ?? fill.size;
    const newRemaining = previousRemaining - fill.size;
    updateRestingStmt.run(
      fill.size,
      newRemaining <= 0 ? "filled" : "open",
      fill.restingOrderId,
    );

    const buyOrderId = side === "buy" ? orderId : fill.restingOrderId;
    const sellOrderId = side === "buy" ? fill.restingOrderId : orderId;
    const buyerId = side === "buy" ? userId : fill.makerUserId;
    const sellerId = side === "buy" ? fill.makerUserId : userId;

    insertTradeStmt.run(
      marketId,
      buyOrderId,
      sellOrderId,
      buyerId,
      sellerId,
      fill.priceC,
      fill.size,
      side,
      now,
    );

    legFills.push({ priceC: fill.priceC, size: fill.size });
    filledSize += fill.size;
  }

  return {
    side,
    orderId,
    fills: legFills,
    filledSize,
    restedSize: remainderSize,
  };
}

// Single guarded UPDATE — no read-then-write race: only succeeds if the
// order is still open and owned by this user.
export function cancelOrder(orderId: number, userId: number): boolean {
  const result = db
    .prepare(
      `UPDATE orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'open'`,
    )
    .run(orderId, userId);
  return result.changes === 1;
}

export interface BookLevel {
  priceC: number;
  size: number;
}

export function getBook(
  marketId: number,
): { bids: BookLevel[]; offers: BookLevel[] } {
  const bids = db
    .prepare(
      `SELECT price_c AS priceC, SUM(remaining) AS size FROM orders
       WHERE market_id = ? AND status = 'open' AND side = 'buy'
       GROUP BY price_c HAVING SUM(remaining) > 0
       ORDER BY price_c DESC`,
    )
    .all(marketId) as BookLevel[];

  const offers = db
    .prepare(
      `SELECT price_c AS priceC, SUM(remaining) AS size FROM orders
       WHERE market_id = ? AND status = 'open' AND side = 'sell'
       GROUP BY price_c HAVING SUM(remaining) > 0
       ORDER BY price_c ASC`,
    )
    .all(marketId) as BookLevel[];

  return { bids, offers };
}

export function getUserOpenOrders(marketId: number, userId: number): OrderRow[] {
  return db
    .prepare(
      `SELECT * FROM orders
       WHERE market_id = ? AND user_id = ? AND status = 'open'
       ORDER BY id DESC`,
    )
    .all(marketId, userId) as OrderRow[];
}

export interface OpenOrderView {
  order: OrderRow;
  marketId: number;
  title: string;
  type: MarketType;
  unit: string | null;
}

// Row shape returned by the join below: every OrderRow column via `o.*`,
// plus the three market display fields the profile page needs. No column
// collision — orders has no title/type/unit columns of its own.
interface OpenOrderJoinRow extends OrderRow {
  title: string;
  type: MarketType;
  unit: string | null;
}

// Every resting order a user has across all markets, newest first. Powers
// the profile page's "Open orders" section, which is shown only to the
// profile owner — resting quotes otherwise stay anonymous (same as the
// order book and the market page's "Your open orders"). The
// m.status = 'open' filter is belt-and-suspenders: settleMarket already
// cancels every resting order atomically when a market settles, so this
// should never actually exclude a row in practice.
export function getUserOpenOrdersAcrossMarkets(userId: number): OpenOrderView[] {
  const rows = db
    .prepare(
      `SELECT o.*, m.title, m.type, m.unit
       FROM orders o
       JOIN markets m ON m.id = o.market_id
       WHERE o.user_id = ? AND o.status = 'open' AND m.status = 'open'
       ORDER BY o.id DESC`,
    )
    .all(userId) as OpenOrderJoinRow[];

  return rows.map((row) => ({
    order: {
      id: row.id,
      market_id: row.market_id,
      user_id: row.user_id,
      side: row.side,
      price_c: row.price_c,
      size: row.size,
      remaining: row.remaining,
      status: row.status,
      created_at: row.created_at,
    },
    marketId: row.market_id,
    title: row.title,
    type: row.type,
    unit: row.unit,
  }));
}

export function getTape(
  marketId: number,
  limit = 50,
): (TradeRow & { buyerName: string; sellerName: string })[] {
  return db
    .prepare(
      `SELECT t.*, bu.username AS buyerName, su.username AS sellerName
       FROM trades t
       JOIN users bu ON bu.id = t.buyer_id
       JOIN users su ON su.id = t.seller_id
       WHERE t.market_id = ?
       ORDER BY t.id DESC
       LIMIT ?`,
    )
    .all(marketId, limit) as (TradeRow & { buyerName: string; sellerName: string })[];
}
