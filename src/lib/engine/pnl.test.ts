import { describe, expect, test } from "vitest";
import {
  avgPriceC,
  foldLeaderboard,
  foldOpenPositions,
  foldUserRealized,
  tradePnlC,
  type SettledTradeRow,
  type UserTradeRow,
} from "./pnl";

// Readability helper: "60" (points/dollars) -> 6000 (integer hundredths).
const c = (p: number) => Math.round(p * 100);

// ---------------------------------------------------------------------------
// 1. tradePnlC basics
// ---------------------------------------------------------------------------
describe("tradePnlC", () => {
  test("buyer pnl is (settleC - priceC) * size", () => {
    const settleC = c(50);
    const priceC = c(30);
    const size = 7;
    expect(tradePnlC(settleC, priceC, size)).toBe((settleC - priceC) * size);
    expect(tradePnlC(settleC, priceC, size)).toBe(14000);
  });

  test("a buyer/seller pair sums to exactly 0", () => {
    const buyerPnl = tradePnlC(c(50), c(30), 7);
    const sellerPnl = -buyerPnl;
    expect(buyerPnl + sellerPnl).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Binary settlement
// ---------------------------------------------------------------------------
describe("binary settlement", () => {
  test("buy 10 @ 3.7, settle YES (1000) -> +6300", () => {
    expect(tradePnlC(c(10), c(3.7), 10)).toBe(6300);
  });

  test("same trade, settle NO (0) -> -3700", () => {
    expect(tradePnlC(c(0), c(3.7), 10)).toBe(-3700);
  });
});

// ---------------------------------------------------------------------------
// 3. Numeric fractional settle — exact integer math, no float drift
// ---------------------------------------------------------------------------
describe("numeric fractional settle", () => {
  test("buy 2 @ 20.00, settle 27.5 -> +1500 exactly", () => {
    expect(tradePnlC(c(27.5), c(20.0), 2)).toBe(1500);
  });

  test("buy 3 @ 0.10, settle 0.40 -> exactly 90 (float-drift trap)", () => {
    expect(tradePnlC(c(0.4), c(0.1), 3)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// 4. Negative settle
// ---------------------------------------------------------------------------
describe("negative settle", () => {
  test("sell 4 @ -2.00, settle -4.25 -> seller pnl = +900", () => {
    const priceC = c(-2.0);
    const settleC = c(-4.25);
    expect(priceC).toBe(-200);
    expect(settleC).toBe(-425);

    const buyerPnl = tradePnlC(settleC, priceC, 4);
    const sellerPnl = -buyerPnl;
    expect(sellerPnl).toBe((priceC - settleC) * 4);
    expect(sellerPnl).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// 5. Round trip locks in PnL regardless of settle value
// ---------------------------------------------------------------------------
describe("round trip", () => {
  test("buy 10 @ 60 then sell 10 @ 70 (same market) nets +10000 at any settle", () => {
    const marketId = 1;
    const userId = 1;
    const other1 = 2;
    const other2 = 3;

    const rowsAt = (settleC: number): SettledTradeRow[] => [
      // user is buyer in this row
      { buyerId: userId, sellerId: other1, priceC: c(60), size: 10, marketId, settleC },
      // user is seller in this row
      { buyerId: other2, sellerId: userId, priceC: c(70), size: 10, marketId, settleC },
    ];

    for (const settleC of [c(55), c(90)]) {
      expect(foldUserRealized(rowsAt(settleC), userId)).toEqual([
        { marketId, pnlC: 10000 },
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. foldOpenPositions — net long, break-even average price
// ---------------------------------------------------------------------------
describe("foldOpenPositions: net long", () => {
  test("buy 10 @ 60, sell 4 @ 70 -> netSize +6, break-even 53.33", () => {
    const marketId = 1;
    const userId = 1;
    const rows: UserTradeRow[] = [
      { buyerId: userId, sellerId: 2, priceC: c(60), size: 10, marketId },
      { buyerId: 3, sellerId: userId, priceC: c(70), size: 4, marketId },
    ];

    const result = foldOpenPositions(rows, userId);
    expect(result).toEqual([{ marketId, netSize: 6, signedNotionalC: 32000 }]);
    expect(avgPriceC(32000, 6)).toBe(5333);

    // Demonstrate that 5333 is (near) the break-even settle: pnl on the two
    // legs almost exactly cancels, off only by the rounding of avgPriceC.
    const settleC = 5333;
    const buyLegPnl = tradePnlC(settleC, c(60), 10);
    const sellLegPnl = -tradePnlC(settleC, c(70), 4);
    expect(buyLegPnl).toBe(-6670);
    expect(sellLegPnl).toBe(6668);
    expect(buyLegPnl + sellLegPnl).toBe(-2);
    expect(Math.abs(buyLegPnl + sellLegPnl)).toBeLessThanOrEqual(6 / 2 + 1);
  });
});

// ---------------------------------------------------------------------------
// 7. foldOpenPositions — net short
// ---------------------------------------------------------------------------
describe("foldOpenPositions: net short", () => {
  test("sell 8 @ 45, buy 3 @ 40 -> netSize -5, avg 48.00", () => {
    const marketId = 1;
    const userId = 1;
    const rows: UserTradeRow[] = [
      { buyerId: 2, sellerId: userId, priceC: c(45), size: 8, marketId },
      { buyerId: userId, sellerId: 3, priceC: c(40), size: 3, marketId },
    ];

    const result = foldOpenPositions(rows, userId);
    expect(result).toEqual([{ marketId, netSize: -5, signedNotionalC: -24000 }]);
    expect(avgPriceC(-24000, -5)).toBe(4800);
  });
});

// ---------------------------------------------------------------------------
// 8. foldOpenPositions — net-zero position is omitted
// ---------------------------------------------------------------------------
describe("foldOpenPositions: net-zero omitted", () => {
  test("buy 5 @ 50 then sell 5 @ 55 on an open market emits no entry", () => {
    const marketId = 1;
    const userId = 1;
    const rows: UserTradeRow[] = [
      { buyerId: userId, sellerId: 2, priceC: c(50), size: 5, marketId },
      { buyerId: 3, sellerId: userId, priceC: c(55), size: 5, marketId },
    ];

    expect(foldOpenPositions(rows, userId)).toEqual([]);
  });

  test("rows on a market where the user nets to zero are omitted, others kept", () => {
    const userId = 1;
    const rows: UserTradeRow[] = [
      { buyerId: userId, sellerId: 2, priceC: c(50), size: 5, marketId: 1 },
      { buyerId: 3, sellerId: userId, priceC: c(55), size: 5, marketId: 1 },
      { buyerId: userId, sellerId: 4, priceC: c(20), size: 2, marketId: 2 },
    ];

    expect(foldOpenPositions(rows, userId)).toEqual([
      { marketId: 2, netSize: 2, signedNotionalC: 4000 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 9. foldLeaderboard — multi-market, 3-user fixture
// ---------------------------------------------------------------------------
describe("foldLeaderboard", () => {
  test("per-user totals, distinct marketsTraded, sorted desc, sums to exactly 0", () => {
    const rows: SettledTradeRow[] = [
      // market 10, binary settle YES (1000): user1 buys from user2
      { buyerId: 1, sellerId: 2, priceC: c(3), size: 10, marketId: 10, settleC: c(10) },
      // market 20, numeric settle 50.00: user2 buys from user3
      { buyerId: 2, sellerId: 3, priceC: c(40), size: 5, marketId: 20, settleC: c(50) },
      // market 20, same settle: user3 buys from user1
      { buyerId: 3, sellerId: 1, priceC: c(45), size: 8, marketId: 20, settleC: c(50) },
    ];

    // Hand computation:
    // row1: pnl = (1000-300)*10 = 7000 -> user1 +7000, user2 -7000
    // row2: pnl = (5000-4000)*5 = 5000   -> user2 +5000,  user3 -5000
    // row3: pnl = (5000-4500)*8 = 4000   -> user3 +4000,  user1 -4000
    // user1 total = 7000 - 4000 = 3000, markets {10,20} = 2
    // user2 total = -7000 + 5000 = -2000, markets {10,20} = 2
    // user3 total = -5000 + 4000 = -1000, markets {20} = 1
    const result = foldLeaderboard(rows);

    expect(result).toEqual([
      { userId: 1, pnlC: 3000, marketsTraded: 2 },
      { userId: 3, pnlC: -1000, marketsTraded: 1 },
      { userId: 2, pnlC: -2000, marketsTraded: 2 },
    ]);

    const grandTotal = result.reduce((sum, r) => sum + r.pnlC, 0);
    expect(grandTotal).toBe(0);
  });

  test("ties broken by userId ascending", () => {
    const rows: SettledTradeRow[] = [
      // Two independent zero-sum pairs that land both non-participants at 0.
      { buyerId: 5, sellerId: 6, priceC: c(10), size: 1, marketId: 1, settleC: c(10) },
      { buyerId: 8, sellerId: 7, priceC: c(20), size: 1, marketId: 2, settleC: c(20) },
    ];
    // Both trades settle exactly at their price -> everyone's pnl is 0.
    const result = foldLeaderboard(rows);
    expect(result.map((r) => r.userId)).toEqual([5, 6, 7, 8]);
    expect(result.every((r) => r.pnlC === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Nothing is silently ignored: seller-only users still show up
// ---------------------------------------------------------------------------
describe("seller-only participation is not silently dropped", () => {
  const rows: SettledTradeRow[] = [
    { buyerId: 1, sellerId: 9, priceC: c(20), size: 5, marketId: 100, settleC: c(30) },
  ];
  // pnl (buyer) = (3000-2000)*5 = 5000 -> seller = -5000

  test("foldLeaderboard includes the seller-only user with negative pnl", () => {
    const result = foldLeaderboard(rows);
    const seller = result.find((r) => r.userId === 9);
    expect(seller).toBeDefined();
    expect(seller).toEqual({ userId: 9, pnlC: -5000, marketsTraded: 1 });
  });

  test("foldUserRealized for the seller-only user shows negative pnl", () => {
    expect(foldUserRealized(rows, 9)).toEqual([{ marketId: 100, pnlC: -5000 }]);
  });

  test("foldUserRealized ignores rows where the user is neither buyer nor seller", () => {
    expect(foldUserRealized(rows, 999)).toEqual([]);
  });

  test("foldOpenPositions ignores rows where the user is neither buyer nor seller", () => {
    const openRows: UserTradeRow[] = [
      { buyerId: 1, sellerId: 2, priceC: c(20), size: 5, marketId: 100 },
    ];
    expect(foldOpenPositions(openRows, 999)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Extra: a user who is buyer in some rows and seller in others of the SAME
// market, across MULTIPLE markets, in first-appearance order.
// ---------------------------------------------------------------------------
describe("foldUserRealized: first-appearance ordering across markets", () => {
  test("markets appear in the order first seen in rows, not sorted", () => {
    const userId = 1;
    const rows: SettledTradeRow[] = [
      { buyerId: userId, sellerId: 2, priceC: c(10), size: 1, marketId: 50, settleC: c(15) },
      { buyerId: 3, sellerId: userId, priceC: c(10), size: 1, marketId: 20, settleC: c(15) },
      { buyerId: userId, sellerId: 4, priceC: c(5), size: 2, marketId: 50, settleC: c(15) },
    ];

    const result = foldUserRealized(rows, userId);
    expect(result.map((r) => r.marketId)).toEqual([50, 20]);
    // market 50: (15-10)*1 + (15-5)*2 = 5 + 20 = 25 -> c: 500+2000=2500
    expect(result[0]).toEqual({ marketId: 50, pnlC: 2500 });
    // market 20: user is seller -> -(15-10)*1 = -500
    expect(result[1]).toEqual({ marketId: 20, pnlC: -500 });
  });
});

// ---------------------------------------------------------------------------
// Extra: avgPriceC standalone rounding behavior
// ---------------------------------------------------------------------------
describe("avgPriceC", () => {
  test("rounds to nearest integer hundredth", () => {
    expect(avgPriceC(32000, 6)).toBe(5333);
    expect(avgPriceC(-24000, -5)).toBe(4800);
    expect(avgPriceC(100, 1)).toBe(100);
  });
});
