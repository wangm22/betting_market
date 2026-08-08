import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import type { MarketStatus, MarketType } from "../types";

// db.ts reads DATABASE_PATH at module load time (it opens the file and runs
// the schema DDL as a side effect of import), so it — and anything that
// transitively imports it, including ./pnl — must only be imported AFTER
// the env var below is set. Hence dynamic imports inside beforeAll rather
// than static imports at the top of this file: a static import would open
// (and possibly create) data/market.db before we get a chance to redirect
// it to a throwaway file.
let dbmod: typeof import("../db");
let pnl: typeof import("./pnl");

const DB_PATH = "/tmp/bm_pnl_test_" + process.pid + ".db";

let aliceId: number;
let bobId: number;
let carolId: number;
let daveId: number;
let binaryMarketId: number;
let numericMarketId: number;
let openMarketId: number;

function insertUser(username: string): number {
  const result = dbmod.db
    .prepare(
      `INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', ?)`,
    )
    .run(username, Date.now());
  return Number(result.lastInsertRowid);
}

function insertMarket(input: {
  creatorId: number;
  title: string;
  type: MarketType;
  unit?: string | null;
  status: MarketStatus;
  settleC?: number | null;
  settledAt?: number | null;
}): number {
  const result = dbmod.db
    .prepare(
      `INSERT INTO markets
         (creator_id, title, description, type, unit, status, settle_c, created_at, settled_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.creatorId,
      input.title,
      input.type,
      input.unit ?? null,
      input.status,
      input.settleC ?? null,
      Date.now(),
      input.settledAt ?? null,
    );
  return Number(result.lastInsertRowid);
}

let nextOrderId = 1;

// Minimal placeholder buy/sell order rows so the trade's FKs (orders table,
// foreign_keys=ON) are satisfied. Their content otherwise doesn't matter to
// the pnl data layer, which only ever reads the trades/markets tables.
function seedTrade(input: {
  marketId: number;
  buyerId: number;
  sellerId: number;
  priceC: number;
  size: number;
}): void {
  const buyOrderId = nextOrderId++;
  const sellOrderId = nextOrderId++;
  const now = Date.now();

  const insertOrder = dbmod.db.prepare(
    `INSERT INTO orders (id, market_id, user_id, side, price_c, size, remaining, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'filled', ?)`,
  );
  insertOrder.run(
    buyOrderId,
    input.marketId,
    input.buyerId,
    "buy",
    input.priceC,
    input.size,
    now,
  );
  insertOrder.run(
    sellOrderId,
    input.marketId,
    input.sellerId,
    "sell",
    input.priceC,
    input.size,
    now,
  );

  dbmod.db
    .prepare(
      `INSERT INTO trades
         (market_id, buy_order_id, sell_order_id, buyer_id, seller_id, price_c, size, taker_side, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'buy', ?)`,
    )
    .run(
      input.marketId,
      buyOrderId,
      sellOrderId,
      input.buyerId,
      input.sellerId,
      input.priceC,
      input.size,
      now,
    );
}

beforeAll(async () => {
  process.env.DATABASE_PATH = DB_PATH;
  dbmod = await import("../db");
  pnl = await import("./pnl");

  aliceId = insertUser("alice");
  bobId = insertUser("bob");
  carolId = insertUser("carol");
  // Zero settled (and zero total) trades — ties carol at pnlC 0 on the
  // leaderboard, exercising the username-ascending tie-break.
  daveId = insertUser("Dave");

  // Settled binary market: bob buys from alice throughout, settle YES
  // (1000). bob: +1600 +2400 +1140 = +5140; alice: -5140.
  binaryMarketId = insertMarket({
    creatorId: aliceId,
    title: "Will it rain tomorrow",
    type: "binary",
    status: "settled",
    settleC: 1000,
    settledAt: 2_000,
  });
  seedTrade({ marketId: binaryMarketId, buyerId: bobId, sellerId: aliceId, priceC: 600, size: 4 });
  seedTrade({ marketId: binaryMarketId, buyerId: bobId, sellerId: aliceId, priceC: 600, size: 6 });
  seedTrade({ marketId: binaryMarketId, buyerId: bobId, sellerId: aliceId, priceC: 620, size: 3 });

  // Settled numeric market: alice buys from bob, settle 27.50.
  // alice: +1500; bob: -1500. Settled later than the binary market, so it
  // should sort first in a "newest settled first" ordering.
  numericMarketId = insertMarket({
    creatorId: bobId,
    title: "Minutes late to the meeting",
    type: "numeric",
    unit: "min",
    status: "settled",
    settleC: 2750,
    settledAt: 3_000,
  });
  seedTrade({ marketId: numericMarketId, buyerId: aliceId, sellerId: bobId, priceC: 2000, size: 2 });

  // Open market: alice ends up net long 6 (buys 10 @ 6, sells 4 @ 7);
  // carol is the counterparty throughout, so she's net short 6. Neither has
  // any realized PnL from this market since it never settles.
  openMarketId = insertMarket({
    creatorId: aliceId,
    title: "Still open",
    type: "binary",
    status: "open",
  });
  seedTrade({ marketId: openMarketId, buyerId: aliceId, sellerId: carolId, priceC: 600, size: 10 });
  seedTrade({ marketId: openMarketId, buyerId: carolId, sellerId: aliceId, priceC: 700, size: 4 });
});

afterAll(() => {
  dbmod.db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
});

describe("getLeaderboard", () => {
  it("includes every registered user, even carol/Dave who never settled a trade", () => {
    const board = pnl.getLeaderboard();
    expect(board).toHaveLength(4);
    expect(board.map((e) => e.userId).sort((a, b) => a - b)).toEqual(
      [aliceId, bobId, carolId, daveId].sort((a, b) => a - b),
    );
  });

  it("sums to exactly 0 across all users (every trade is zero-sum)", () => {
    const board = pnl.getLeaderboard();
    const total = board.reduce((sum, e) => sum + e.pnlC, 0);
    expect(total).toBe(0);
  });

  it("bob +3640 / alice -3640, carol & Dave tied at 0, sorted pnlC desc then username asc", () => {
    const board = pnl.getLeaderboard();
    expect(board).toEqual([
      { userId: bobId, username: "bob", pnlC: 3640, marketsTraded: 2 },
      { userId: carolId, username: "carol", pnlC: 0, marketsTraded: 0 },
      { userId: daveId, username: "Dave", pnlC: 0, marketsTraded: 0 },
      { userId: aliceId, username: "alice", pnlC: -3640, marketsTraded: 2 },
    ]);
  });
});

describe("getUserPortfolio(alice)", () => {
  it("totalPnlC is -3640, matching her leaderboard number", () => {
    const { totalPnlC } = pnl.getUserPortfolio(aliceId);
    expect(totalPnlC).toBe(-3640);
  });

  it("realized has both settled markets, newest settled_at first", () => {
    const { realized } = pnl.getUserPortfolio(aliceId);
    expect(realized).toHaveLength(2);
    expect(realized.map((r) => r.marketId)).toEqual([numericMarketId, binaryMarketId]);
    expect(realized.find((r) => r.marketId === binaryMarketId)?.pnlC).toBe(-5140);
    expect(realized.find((r) => r.marketId === numericMarketId)?.pnlC).toBe(1500);
  });

  it("open shows the open market at netSize +6, avgPriceC 533", () => {
    const { open } = pnl.getUserPortfolio(aliceId);
    expect(open).toEqual([
      {
        marketId: openMarketId,
        title: "Still open",
        type: "binary",
        unit: null,
        netSize: 6,
        avgPriceC: 533,
      },
    ]);
  });
});

describe("getUserPortfolio(carol)", () => {
  it("totalPnlC is 0 and realized is empty (never in a settled trade)", () => {
    const portfolio = pnl.getUserPortfolio(carolId);
    expect(portfolio.totalPnlC).toBe(0);
    expect(portfolio.realized).toEqual([]);
  });

  it("open shows netSize -6, avgPriceC 533 — zero-sum with alice's open notional", () => {
    const { open } = pnl.getUserPortfolio(carolId);
    expect(open).toEqual([
      {
        marketId: openMarketId,
        title: "Still open",
        type: "binary",
        unit: null,
        netSize: -6,
        avgPriceC: 533,
      },
    ]);

    const aliceOpen = pnl.getUserPortfolio(aliceId).open[0];
    expect(aliceOpen.netSize + open[0].netSize).toBe(0);
  });
});

describe("getUserPortfolio(bob)", () => {
  it("totalPnlC is +3640 across both settled markets, no open positions", () => {
    const { totalPnlC, realized, open } = pnl.getUserPortfolio(bobId);
    expect(totalPnlC).toBe(3640);
    expect(realized).toHaveLength(2);
    expect(open).toEqual([]);
  });
});
