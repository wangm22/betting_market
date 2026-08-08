import { db } from "../db";
import {
  avgPriceC,
  foldLeaderboard,
  foldOpenPositions,
  foldUserRealized,
  type SettledTradeRow,
  type UserTradeRow,
} from "../engine/pnl";
import type { MarketType } from "../types";

export interface LeaderboardEntry {
  userId: number;
  username: string;
  pnlC: number;
  marketsTraded: number;
}

export interface OpenPositionView {
  marketId: number;
  title: string;
  type: MarketType;
  unit: string | null;
  netSize: number;
  avgPriceC: number;
}

export interface RealizedView {
  marketId: number;
  title: string;
  type: MarketType;
  unit: string | null;
  settleC: number;
  settledAt: number;
  pnlC: number;
}

// Row shapes exactly as SQLite hands them back (snake_case).
interface SettledTradeQueryRow {
  buyer_id: number;
  seller_id: number;
  price_c: number;
  size: number;
  market_id: number;
  settle_c: number;
}

interface OpenTradeQueryRow {
  buyer_id: number;
  seller_id: number;
  price_c: number;
  size: number;
  market_id: number;
}

interface MarketInfoRow {
  id: number;
  title: string;
  type: MarketType;
  unit: string | null;
  settle_c: number | null;
  settled_at: number | null;
}

// Base query for every trade on a settled market, joined to that market's
// settle value. getUserPortfolio's realized-PnL query reuses this verbatim
// with an extra `AND (buyer_id=? OR seller_id=?)` appended.
const SETTLED_TRADES_QUERY = `
  SELECT t.buyer_id, t.seller_id, t.price_c, t.size, t.market_id, m.settle_c
  FROM trades t
  JOIN markets m ON m.id = t.market_id
  WHERE m.status = 'settled'
`;

function toSettledTradeRow(row: SettledTradeQueryRow): SettledTradeRow {
  return {
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    priceC: row.price_c,
    size: row.size,
    marketId: row.market_id,
    settleC: row.settle_c,
  };
}

function toUserTradeRow(row: OpenTradeQueryRow): UserTradeRow {
  return {
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    priceC: row.price_c,
    size: row.size,
    marketId: row.market_id,
  };
}

// One query for every market id a set of folded positions touches. Markets
// are never deleted, so every id here is expected to resolve; a miss would
// mean the trades log points at a market that's gone — a bug worth throwing
// on loudly rather than silently rendering blank fields.
function getMarketsByIds(ids: number[]): Map<number, MarketInfoRow> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, title, type, unit, settle_c, settled_at FROM markets WHERE id IN (${placeholders})`,
    )
    .all(...ids) as MarketInfoRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

function requireMarket(
  markets: Map<number, MarketInfoRow>,
  marketId: number,
): MarketInfoRow {
  const market = markets.get(marketId);
  if (!market) {
    throw new Error(`Market ${marketId} referenced by a trade was not found.`);
  }
  return market;
}

// Cumulative realized PnL leaderboard across every settled market, sorted
// pnlC desc (ties: username asc, case-insensitive). Every registered user
// appears — even with zero settled trades — so the board reflects the full
// roster, not just people who've cashed out a position.
export function getLeaderboard(): LeaderboardEntry[] {
  const settledRows = (
    db.prepare(SETTLED_TRADES_QUERY).all() as SettledTradeQueryRow[]
  ).map(toSettledTradeRow);
  const folded = foldLeaderboard(settledRows);
  const foldedByUserId = new Map(folded.map((f) => [f.userId, f]));

  const users = db.prepare(`SELECT id, username FROM users`).all() as {
    id: number;
    username: string;
  }[];

  const entries: LeaderboardEntry[] = users.map((user) => {
    const f = foldedByUserId.get(user.id);
    return {
      userId: user.id,
      username: user.username,
      pnlC: f?.pnlC ?? 0,
      marketsTraded: f?.marketsTraded ?? 0,
    };
  });

  entries.sort((a, b) => {
    if (a.pnlC !== b.pnlC) return b.pnlC - a.pnlC;
    const an = a.username.toLowerCase();
    const bn = b.username.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  return entries;
}

// One user's full PnL picture: open positions on still-open markets (marked
// via break-even average price, not a live PnL figure), and realized PnL per
// settled market. totalPnlC is the sum of the realized rows, which by
// construction equals this user's leaderboard number.
export function getUserPortfolio(userId: number): {
  open: OpenPositionView[];
  realized: RealizedView[];
  totalPnlC: number;
} {
  const openTradeRows = (
    db
      .prepare(
        `SELECT t.buyer_id, t.seller_id, t.price_c, t.size, t.market_id
         FROM trades t
         JOIN markets m ON m.id = t.market_id
         WHERE m.status = 'open' AND (t.buyer_id = ? OR t.seller_id = ?)
         ORDER BY t.id ASC`,
      )
      .all(userId, userId) as OpenTradeQueryRow[]
  ).map(toUserTradeRow);

  const openPositions = foldOpenPositions(openTradeRows, userId);
  const openMarkets = getMarketsByIds(openPositions.map((p) => p.marketId));

  const open: OpenPositionView[] = openPositions.map((p) => {
    const market = requireMarket(openMarkets, p.marketId);
    return {
      marketId: p.marketId,
      title: market.title,
      type: market.type,
      unit: market.unit,
      netSize: p.netSize,
      avgPriceC: avgPriceC(p.signedNotionalC, p.netSize),
    };
  });

  const settledRows = (
    db
      .prepare(`${SETTLED_TRADES_QUERY} AND (t.buyer_id = ? OR t.seller_id = ?)`)
      .all(userId, userId) as SettledTradeQueryRow[]
  ).map(toSettledTradeRow);

  const realizedFold = foldUserRealized(settledRows, userId);
  const realizedMarkets = getMarketsByIds(realizedFold.map((r) => r.marketId));

  const realized: RealizedView[] = realizedFold
    .map((r) => {
      const market = requireMarket(realizedMarkets, r.marketId);
      return {
        marketId: r.marketId,
        title: market.title,
        type: market.type,
        unit: market.unit,
        settleC: market.settle_c ?? 0,
        settledAt: market.settled_at ?? 0,
        pnlC: r.pnlC,
      };
    })
    .sort((a, b) => b.settledAt - a.settledAt || b.marketId - a.marketId);

  const totalPnlC = realized.reduce((sum, r) => sum + r.pnlC, 0);

  return { open, realized, totalPnlC };
}
