// Pure PnL / position math. No I/O, no db imports — positions and PnL are
// always derived on read from the immutable trades log, never stored, and
// this module is the single source of truth for that derivation.
//
// All prices, settle values, and PnL are integer hundredths end to end, so
// every fold here is exact integer arithmetic (no floating-point drift).
// The only place a rounding decision is made is avgPriceC's display value.

// A trade joined with its market's settle value (settled markets only).
export interface SettledTradeRow {
  buyerId: number;
  sellerId: number;
  priceC: number;
  size: number;
  marketId: number;
  settleC: number;
}

// A trade on any market (used for open-position folds).
export interface UserTradeRow {
  buyerId: number;
  sellerId: number;
  priceC: number;
  size: number;
  marketId: number;
}

// Buyer's realized PnL in hundredths for one trade; the seller's is the
// exact negation of this value.
export function tradePnlC(settleC: number, priceC: number, size: number): number {
  return (settleC - priceC) * size;
}

// Cumulative realized PnL per user across all settled trades.
// Returns one entry per user appearing in rows (as buyer and/or seller),
// sorted pnlC DESC (ties: userId ASC). marketsTraded counts only DISTINCT
// settled markets the user appears in.
export function foldLeaderboard(
  rows: SettledTradeRow[]
): { userId: number; pnlC: number; marketsTraded: number }[] {
  const stats = new Map<number, { pnlC: number; markets: Set<number> }>();

  const bump = (userId: number, deltaC: number, marketId: number): void => {
    let entry = stats.get(userId);
    if (!entry) {
      entry = { pnlC: 0, markets: new Set<number>() };
      stats.set(userId, entry);
    }
    entry.pnlC += deltaC;
    entry.markets.add(marketId);
  };

  for (const row of rows) {
    const pnlC = tradePnlC(row.settleC, row.priceC, row.size);
    bump(row.buyerId, pnlC, row.marketId);
    bump(row.sellerId, -pnlC, row.marketId);
  }

  return Array.from(stats.entries())
    .map(([userId, { pnlC, markets }]) => ({
      userId,
      pnlC,
      marketsTraded: markets.size,
    }))
    .sort((a, b) => b.pnlC - a.pnlC || a.userId - b.userId);
}

// Per-market realized PnL for one user, in the order markets first appear
// in rows. Rows where the user is neither buyer nor seller are ignored.
export function foldUserRealized(
  rows: SettledTradeRow[],
  userId: number
): { marketId: number; pnlC: number }[] {
  const order: number[] = [];
  const totals = new Map<number, number>();

  for (const row of rows) {
    const isBuyer = row.buyerId === userId;
    const isSeller = row.sellerId === userId;
    if (!isBuyer && !isSeller) continue;

    const pnlC = tradePnlC(row.settleC, row.priceC, row.size);
    let delta = 0;
    if (isBuyer) delta += pnlC;
    if (isSeller) delta -= pnlC;

    if (!totals.has(row.marketId)) {
      totals.set(row.marketId, 0);
      order.push(row.marketId);
    }
    totals.set(row.marketId, totals.get(row.marketId)! + delta);
  }

  return order.map((marketId) => ({ marketId, pnlC: totals.get(marketId)! }));
}

// Net open positions for one user from trades on OPEN markets.
// netSize = bought − sold (positive = long, negative = short).
// signedNotionalC = Σ(priceC × size) over buys − Σ(priceC × size) over sells.
// Markets where netSize === 0 are omitted. Order: first appearance in rows.
export function foldOpenPositions(
  rows: UserTradeRow[],
  userId: number
): { marketId: number; netSize: number; signedNotionalC: number }[] {
  const order: number[] = [];
  const totals = new Map<number, { netSize: number; signedNotionalC: number }>();

  for (const row of rows) {
    const isBuyer = row.buyerId === userId;
    const isSeller = row.sellerId === userId;
    if (!isBuyer && !isSeller) continue;

    if (!totals.has(row.marketId)) {
      totals.set(row.marketId, { netSize: 0, signedNotionalC: 0 });
      order.push(row.marketId);
    }
    const entry = totals.get(row.marketId)!;
    const notionalC = row.priceC * row.size;
    if (isBuyer) {
      entry.netSize += row.size;
      entry.signedNotionalC += notionalC;
    }
    if (isSeller) {
      entry.netSize -= row.size;
      entry.signedNotionalC -= notionalC;
    }
  }

  return order
    .map((marketId) => ({ marketId, ...totals.get(marketId)! }))
    .filter((p) => p.netSize !== 0);
}

// Break-even average entry price in integer hundredths (display value).
// Caller guarantees netSize !== 0.
export function avgPriceC(signedNotionalC: number, netSize: number): number {
  return Math.round(signedNotionalC / netSize);
}
