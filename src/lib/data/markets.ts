import { db } from "../db";
import { MAX_NUMERIC_C } from "../money";
import type { MarketRow, MarketType } from "../types";

// Creates an open market. `unit` is only ever meaningful for numeric
// markets; callers (the create-market action) are responsible for forcing
// it to null for binary markets.
export function createMarket(
  creatorId: number,
  input: {
    title: string;
    description: string;
    type: MarketType;
    unit: string | null;
  },
): MarketRow {
  const result = db
    .prepare(
      `INSERT INTO markets (creator_id, title, description, type, unit, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      creatorId,
      input.title,
      input.description,
      input.type,
      input.unit,
      Date.now(),
    );

  const market = getMarket(Number(result.lastInsertRowid));
  if (!market) {
    throw new Error("Failed to load market immediately after insert.");
  }
  return market;
}

export function getMarket(id: number): MarketRow | null {
  const row = db.prepare(`SELECT * FROM markets WHERE id = ?`).get(id) as
    | MarketRow
    | undefined;
  return row ?? null;
}

export interface MarketSummary {
  market: MarketRow;
  creatorName: string;
  bestBidC: number | null;
  bestOfferC: number | null;
  lastPriceC: number | null;
}

// `m.*` supplies every MarketRow column verbatim (snake_case, matching the
// interface); the four extra aliases are computed per-market via correlated
// subqueries. The app is tiny, so this is fine without a bigger rewrite.
const SUMMARY_QUERY = `
  SELECT
    m.*,
    u.username AS creatorName,
    (SELECT MAX(price_c) FROM orders
       WHERE market_id = m.id AND status = 'open' AND side = 'buy')  AS bestBidC,
    (SELECT MIN(price_c) FROM orders
       WHERE market_id = m.id AND status = 'open' AND side = 'sell') AS bestOfferC,
    (SELECT price_c FROM trades
       WHERE market_id = m.id ORDER BY id DESC LIMIT 1)              AS lastPriceC
  FROM markets m
  JOIN users u ON u.id = m.creator_id
  WHERE m.status = ?
  ORDER BY m.id DESC
`;

interface SummaryRow extends MarketRow {
  creatorName: string;
  bestBidC: number | null;
  bestOfferC: number | null;
  lastPriceC: number | null;
}

function rowToSummary(row: SummaryRow): MarketSummary {
  const { creatorName, bestBidC, bestOfferC, lastPriceC, ...market } = row;
  return { market, creatorName, bestBidC, bestOfferC, lastPriceC };
}

// Newest first within each bucket.
export function listMarkets(): {
  open: MarketSummary[];
  settled: MarketSummary[];
} {
  const open = (db.prepare(SUMMARY_QUERY).all("open") as SummaryRow[]).map(
    rowToSummary,
  );
  const settled = (
    db.prepare(SUMMARY_QUERY).all("settled") as SummaryRow[]
  ).map(rowToSummary);
  return { open, settled };
}

// One transaction: validate, then atomically settle the market and cancel
// every resting open order. Trades are immutable history and are never
// touched — PnL is folded from them on read.
export function settleMarket(
  marketId: number,
  userId: number,
  settleC: number,
): void {
  const run = db.transaction(() => {
    const market = getMarket(marketId);
    if (!market) {
      throw new Error("Market not found.");
    }
    if (market.status === "settled") {
      throw new Error("This market is already settled.");
    }
    if (market.creator_id !== userId) {
      throw new Error("Only the market creator can settle this market.");
    }

    if (market.type === "binary") {
      if (settleC !== 0 && settleC !== 1000) {
        throw new Error("Binary markets settle to YES (10) or NO (0).");
      }
    } else {
      if (!Number.isInteger(settleC) || Math.abs(settleC) > MAX_NUMERIC_C) {
        throw new Error(
          "Settle value must be a number with at most 2 decimals.",
        );
      }
    }

    db.prepare(
      `UPDATE markets SET status = 'settled', settle_c = ?, settled_at = ? WHERE id = ?`,
    ).run(settleC, Date.now(), marketId);

    db.prepare(
      `UPDATE orders SET status = 'cancelled' WHERE market_id = ? AND status = 'open'`,
    ).run(marketId);
  });

  run();
}
