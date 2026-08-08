import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { MAX_NUMERIC_C } from "../money";

// Full acceptance walkthrough from the plan's "Manual walkthrough" section
// (i-want-to-make-joyful-pillow.md), encoded as direct data-layer calls
// instead of driving two browsers. Every number stated in that walkthrough
// is asserted here. Prices/settles/PnL are integer hundredths throughout;
// c(60) -> 6000.
const c = (p: number) => Math.round(p * 100);

// db.ts reads DATABASE_PATH at module load (opening/creating the file as a
// side effect of import), so every module that transitively imports it must
// only be imported AFTER the env var below is set — hence dynamic imports
// inside beforeAll rather than static imports up top. Mirrors
// src/lib/data/pnl.data.test.ts, which uses its own /tmp path so the two
// files (run in separate vitest workers) never interfere with each other or
// with data/market.db.
let dbmod: typeof import("../db");
let users: typeof import("./users");
let markets: typeof import("./markets");
let orders: typeof import("./orders");
let pnl: typeof import("./pnl");

const DB_PATH = "/tmp/bm_walkthrough_" + process.pid + ".db";

beforeAll(async () => {
  process.env.DATABASE_PATH = DB_PATH;
  dbmod = await import("../db");
  users = await import("./users");
  markets = await import("./markets");
  orders = await import("./orders");
  pnl = await import("./pnl");
});

afterAll(() => {
  dbmod.db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
});

const B_TITLE = "Will it rain Friday?";
const N_TITLE = "How many minutes late will Sam be?";

let aliceId: number;
let bobId: number;
let marketBId: number;
let marketNId: number;
let aliceBidOrderId: number; // alice's resting 4-bid on B, captured in step 3

describe("acceptance walkthrough — alice & bob across binary market B and numeric market N", () => {
  it("setup: creates alice and bob", () => {
    aliceId = users.createUser("alice", "x").id;
    bobId = users.createUser("bob", "x").id;
    expect(aliceId).toBeGreaterThan(0);
    expect(bobId).toBeGreaterThan(0);
    expect(aliceId).not.toBe(bobId);
  });

  it("1. duplicate username 'ALICE' throws (unique COLLATE NOCASE)", () => {
    expect(() => users.createUser("ALICE", "x")).toThrow();
  });

  it("2. alice creates binary market B; bob creates numeric market N", () => {
    const marketB = markets.createMarket(aliceId, {
      title: B_TITLE,
      description: "",
      type: "binary",
      unit: null,
    });
    const marketN = markets.createMarket(bobId, {
      title: N_TITLE,
      description: "",
      type: "numeric",
      unit: "min",
    });
    marketBId = marketB.id;
    marketNId = marketN.id;

    expect(marketB).toMatchObject({
      type: "binary",
      unit: null,
      status: "open",
      creator_id: aliceId,
    });
    expect(marketN).toMatchObject({
      type: "numeric",
      unit: "min",
      status: "open",
      creator_id: bobId,
    });
  });

  it("3. B: alice's two-sided 4x10/6x10 quote rests both legs, no fills", () => {
    const opening = orders.submitQuote(marketBId, aliceId, {
      bid: { priceC: c(4), size: 10 },
      offer: { priceC: c(6), size: 10 },
    });

    expect(opening).toHaveLength(2);
    expect(opening[0]).toMatchObject({ side: "buy", fills: [], filledSize: 0, restedSize: 10 });
    expect(opening[1]).toMatchObject({ side: "sell", fills: [], filledSize: 0, restedSize: 10 });
    aliceBidOrderId = opening[0].orderId;

    expect(orders.getBook(marketBId)).toEqual({
      bids: [{ priceC: c(4), size: 10 }],
      offers: [{ priceC: c(6), size: 10 }],
    });
  });

  it("4. B: bob's 4.5x5 bid rests below alice's offer", () => {
    const bob45 = orders.submitQuote(marketBId, bobId, { bid: { priceC: c(4.5), size: 5 } });
    expect(bob45).toHaveLength(1);
    expect(bob45[0]).toMatchObject({ side: "buy", fills: [], filledSize: 0, restedSize: 5 });

    expect(orders.getBook(marketBId)).toEqual({
      bids: [
        { priceC: c(4.5), size: 5 },
        { priceC: c(4), size: 10 },
      ],
      offers: [{ priceC: c(6), size: 10 }],
    });
  });

  it("5. B: bob's 6.5x4 bid sweeps alice's offer AT THE RESTING price (6, not 6.5)", () => {
    const bob65 = orders.submitQuote(marketBId, bobId, { bid: { priceC: c(6.5), size: 4 } });
    expect(bob65).toHaveLength(1);
    expect(bob65[0]).toMatchObject({
      side: "buy",
      fills: [{ priceC: c(6), size: 4 }],
      filledSize: 4,
      restedSize: 0,
    });

    expect(orders.getBook(marketBId)).toEqual({
      bids: [
        { priceC: c(4.5), size: 5 },
        { priceC: c(4), size: 10 },
      ],
      offers: [{ priceC: c(6), size: 6 }],
    });

    const tape = orders.getTape(marketBId);
    expect(tape[0]).toMatchObject({
      buyerName: "bob",
      sellerName: "alice",
      price_c: c(6),
      size: 4,
      taker_side: "buy",
    });
  });

  it("6. B: bob cancels his 4.5 bid (found via getUserOpenOrders); re-cancelling is a no-op", () => {
    const bobOpen = orders.getUserOpenOrders(marketBId, bobId);
    expect(bobOpen).toHaveLength(1);
    expect(bobOpen[0].price_c).toBe(c(4.5));

    expect(orders.cancelOrder(bobOpen[0].id, bobId)).toBe(true);
    expect(orders.getBook(marketBId)).toEqual({
      bids: [{ priceC: c(4), size: 10 }],
      offers: [{ priceC: c(6), size: 6 }],
    });

    // Already cancelled: the guarded UPDATE matches 0 rows.
    expect(orders.cancelOrder(bobOpen[0].id, bobId)).toBe(false);
  });

  it("7. B: alice's 4x5 offer is rejected (would cross her own resting 4 bid) with NO side effects", () => {
    const bookBefore = orders.getBook(marketBId);
    const tapeBefore = orders.getTape(marketBId);
    const aliceOrdersBefore = orders.getUserOpenOrders(marketBId, aliceId);

    expect(bookBefore).toEqual({
      bids: [{ priceC: c(4), size: 10 }],
      offers: [{ priceC: c(6), size: 6 }],
    });
    expect(tapeBefore).toHaveLength(1);
    expect(aliceOrdersBefore).toHaveLength(2);

    let caught: unknown;
    try {
      orders.submitQuote(marketBId, aliceId, { offer: { priceC: c(4), size: 5 } });
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof orders.SelfTradeError)) {
      throw new Error("expected submitQuote to throw SelfTradeError");
    }
    expect(caught.offendingOrderId).toBe(aliceBidOrderId);

    // Nothing was submitted: book, tape, and alice's open orders are all
    // byte-for-byte identical to before the rejected call.
    expect(orders.getBook(marketBId)).toEqual(bookBefore);
    expect(orders.getTape(marketBId)).toEqual(tapeBefore);
    expect(orders.getUserOpenOrders(marketBId, aliceId)).toEqual(aliceOrdersBefore);
  });

  it("8. B: alice rests 6.2x5; bob's 6.3x9 sweeps two levels (6@6 + 3@6.2); alice cancels the 2 left", () => {
    const aliceOffer62 = orders.submitQuote(marketBId, aliceId, {
      offer: { priceC: c(6.2), size: 5 },
    });
    expect(aliceOffer62[0]).toMatchObject({ side: "sell", fills: [], filledSize: 0, restedSize: 5 });
    const aliceSecondOfferId = aliceOffer62[0].orderId;

    expect(orders.getBook(marketBId)).toEqual({
      bids: [{ priceC: c(4), size: 10 }],
      offers: [
        { priceC: c(6), size: 6 },
        { priceC: c(6.2), size: 5 },
      ],
    });

    const bobSweep63 = orders.submitQuote(marketBId, bobId, { bid: { priceC: c(6.3), size: 9 } });
    expect(bobSweep63[0]).toMatchObject({
      side: "buy",
      fills: [
        { priceC: c(6), size: 6 },
        { priceC: c(6.2), size: 3 },
      ],
      filledSize: 9,
      restedSize: 0,
    });

    expect(orders.getBook(marketBId)).toEqual({
      bids: [{ priceC: c(4), size: 10 }],
      offers: [{ priceC: c(6.2), size: 2 }],
    });

    expect(orders.cancelOrder(aliceSecondOfferId, aliceId)).toBe(true);
    expect(orders.getBook(marketBId)).toEqual({
      bids: [{ priceC: c(4), size: 10 }],
      offers: [],
    });

    // Cross-market "Open orders" view (the profile page's data source): the
    // just-cancelled 6.2 offer no longer appears, and neither does the 6x10
    // offer (now fully filled) — alice's original 4x10 bid is her only
    // order left open anywhere.
    const aliceOpenAfterCancel = orders.getUserOpenOrdersAcrossMarkets(aliceId);
    expect(aliceOpenAfterCancel).toHaveLength(1);
    expect(aliceOpenAfterCancel[0]).toMatchObject({
      marketId: marketBId,
      title: B_TITLE,
      type: "binary",
      unit: null,
    });
    expect(aliceOpenAfterCancel[0].order).toMatchObject({
      id: aliceBidOrderId,
      side: "buy",
      price_c: c(4),
      size: 10,
      remaining: 10,
    });
    expect(aliceOpenAfterCancel.some((o) => o.order.id === aliceSecondOfferId)).toBe(false);

    // The 3 lots that already traded before the remainder was cancelled
    // stay on the tape: step 5's 1 trade + this step's 2 trades = 3 total.
    const tape = orders.getTape(marketBId);
    expect(tape).toHaveLength(3);
    expect(tape.some((t) => t.price_c === c(6.2) && t.size === 3)).toBe(true);
  });

  it("9. B: a quote with bid >= offer (5x1 / 5x1) is rejected whole", () => {
    expect(() =>
      orders.submitQuote(marketBId, aliceId, {
        bid: { priceC: c(5), size: 1 },
        offer: { priceC: c(5), size: 1 },
      }),
    ).toThrow("Your bid must be below your offer.");
  });

  it("10. B: alice settles YES (1000); resting orders cancel; market closes for good", () => {
    markets.settleMarket(marketBId, aliceId, 1000);

    const bAfterSettle = markets.getMarket(marketBId);
    expect(bAfterSettle?.status).toBe("settled");
    expect(bAfterSettle?.settle_c).toBe(1000);
    expect(typeof bAfterSettle?.settled_at).toBe("number");

    expect(orders.getUserOpenOrders(marketBId, aliceId)).toEqual([]);
    expect(orders.getUserOpenOrders(marketBId, bobId)).toEqual([]);
    expect(orders.getBook(marketBId)).toEqual({ bids: [], offers: [] });

    expect(() =>
      orders.submitQuote(marketBId, bobId, { bid: { priceC: c(1), size: 1 } }),
    ).toThrow(orders.MarketClosedError);

    expect(() => markets.settleMarket(marketBId, aliceId, 1000)).toThrow(/already settled/i);
  });

  it("11. non-creator settle is rejected; market stays open", () => {
    const throwawayId = markets.createMarket(aliceId, {
      title: "Throwaway market",
      description: "",
      type: "binary",
      unit: null,
    }).id;

    expect(() => markets.settleMarket(throwawayId, bobId, 0)).toThrow();
    expect(markets.getMarket(throwawayId)?.status).toBe("open");
  });

  it("12. N: alice rests 20x3/30x3; bob's 18x2 offer crosses at the RESTING price (20, not 18)", () => {
    const aliceQuoteN = orders.submitQuote(marketNId, aliceId, {
      bid: { priceC: c(20), size: 3 },
      offer: { priceC: c(30), size: 3 },
    });
    expect(aliceQuoteN[0]).toMatchObject({ side: "buy", fills: [], filledSize: 0, restedSize: 3 });
    expect(aliceQuoteN[1]).toMatchObject({ side: "sell", fills: [], filledSize: 0, restedSize: 3 });

    expect(orders.getBook(marketNId)).toEqual({
      bids: [{ priceC: c(20), size: 3 }],
      offers: [{ priceC: c(30), size: 3 }],
    });

    const bobOffer18 = orders.submitQuote(marketNId, bobId, { offer: { priceC: c(18), size: 2 } });
    expect(bobOffer18[0]).toMatchObject({
      side: "sell",
      fills: [{ priceC: c(20), size: 2 }],
      filledSize: 2,
      restedSize: 0,
    });

    expect(orders.getBook(marketNId)).toEqual({
      bids: [{ priceC: c(20), size: 1 }],
      offers: [{ priceC: c(30), size: 3 }],
    });

    // Cross-market "Open orders" view (the profile page's data source):
    // alice's partially-filled 20 bid (remaining 1 of 3) and her untouched
    // 30 offer (3 of 3), newest first — the offer was submitted second
    // within the same two-sided submitQuote call, so it has the higher id.
    const aliceOpenN = orders.getUserOpenOrdersAcrossMarkets(aliceId);
    expect(aliceOpenN).toHaveLength(2);
    expect(aliceOpenN[0]).toMatchObject({ marketId: marketNId, title: N_TITLE, type: "numeric", unit: "min" });
    expect(aliceOpenN[0].order).toMatchObject({ side: "sell", price_c: c(30), size: 3, remaining: 3 });
    expect(aliceOpenN[1]).toMatchObject({ marketId: marketNId, title: N_TITLE, type: "numeric", unit: "min" });
    expect(aliceOpenN[1].order).toMatchObject({ side: "buy", price_c: c(20), size: 3, remaining: 1 });
  });

  it("13. mid-game portfolios: one open N position each, one realized B entry each", () => {
    const aliceP = pnl.getUserPortfolio(aliceId);
    expect(aliceP.open).toEqual([
      { marketId: marketNId, title: N_TITLE, type: "numeric", unit: "min", netSize: 2, avgPriceC: c(20) },
    ]);
    expect(aliceP.realized).toHaveLength(1);
    // Hand math: bob bought 4@6 (+1600) + 6@6 (+2400) + 3@6.2 (+1140)
    // = +5140 for bob; alice is the exact negation.
    expect(aliceP.realized.find((r) => r.marketId === marketBId)?.pnlC).toBe(-5140);

    const bobP = pnl.getUserPortfolio(bobId);
    expect(bobP.open).toEqual([
      { marketId: marketNId, title: N_TITLE, type: "numeric", unit: "min", netSize: -2, avgPriceC: c(20) },
    ]);
    expect(bobP.realized).toHaveLength(1);
    expect(bobP.realized.find((r) => r.marketId === marketBId)?.pnlC).toBe(5140);
  });

  it("14. N: bob settles at 27.50; alice's resting N orders cancel; +1500/-1500 realized", () => {
    markets.settleMarket(marketNId, bobId, 2750);

    expect(orders.getUserOpenOrders(marketNId, aliceId)).toEqual([]);
    expect(orders.getBook(marketNId)).toEqual({ bids: [], offers: [] });

    // Settlement cancels every resting order atomically — alice (and bob)
    // now have nothing open anywhere across either market.
    expect(orders.getUserOpenOrdersAcrossMarkets(aliceId)).toEqual([]);
    expect(orders.getUserOpenOrdersAcrossMarkets(bobId)).toEqual([]);

    expect(pnl.getUserPortfolio(aliceId).realized.find((r) => r.marketId === marketNId)?.pnlC).toBe(1500);
    expect(pnl.getUserPortfolio(bobId).realized.find((r) => r.marketId === marketNId)?.pnlC).toBe(-1500);
  });

  it("15. final leaderboard: bob +3640 / alice -3640, sums to 0, 2 markets traded each", () => {
    const board = pnl.getLeaderboard();
    expect(board).toEqual([
      { userId: bobId, username: "bob", pnlC: 3640, marketsTraded: 2 },
      { userId: aliceId, username: "alice", pnlC: -3640, marketsTraded: 2 },
    ]);
    expect(board.reduce((sum, e) => sum + e.pnlC, 0)).toBe(0);

    const aliceFinal = pnl.getUserPortfolio(aliceId);
    expect(aliceFinal.totalPnlC).toBe(-3640);
    expect(aliceFinal.open).toEqual([]);
    expect(pnl.getUserPortfolio(bobId).totalPnlC).toBe(3640);
  });

  it("16. settlement bounds are enforced for both market types", () => {
    const freshBinaryId = markets.createMarket(aliceId, {
      title: "Fresh binary bounds check",
      description: "",
      type: "binary",
      unit: null,
    }).id;
    expect(() => markets.settleMarket(freshBinaryId, aliceId, 500)).toThrow();
    expect(markets.getMarket(freshBinaryId)?.status).toBe("open");

    const freshNumericId = markets.createMarket(aliceId, {
      title: "Fresh numeric bounds check",
      description: "",
      type: "numeric",
      unit: "x",
    }).id;
    expect(() => markets.settleMarket(freshNumericId, aliceId, MAX_NUMERIC_C + 1)).toThrow();
    expect(() => markets.settleMarket(freshNumericId, aliceId, -(MAX_NUMERIC_C + 1))).toThrow();
    expect(markets.getMarket(freshNumericId)?.status).toBe("open");
  });

  it("17. listMarkets: settled markets carry correct settle_c, open count is right, B's book is flushed", () => {
    const { open, settled } = markets.listMarkets();

    expect(open).toHaveLength(3); // throwaway (#11) + the two bounds-check markets (#16)
    expect(settled).toHaveLength(2); // B + N

    const bSummary = settled.find((s) => s.market.id === marketBId);
    expect(bSummary?.market.settle_c).toBe(1000);
    expect(bSummary?.bestBidC).toBeNull();
    expect(bSummary?.bestOfferC).toBeNull();
    expect(bSummary?.lastPriceC).toBe(c(6.2)); // last trade on B was the 3-lot fill @ 6.2 in step 8

    const nSummary = settled.find((s) => s.market.id === marketNId);
    expect(nSummary?.market.settle_c).toBe(2750);
  });
});
