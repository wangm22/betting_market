import { describe, it, expect } from "vitest";
import { crosses, matchIncoming, type RestingOrder, type Incoming } from "./match";

// All prices in this file are integer hundredths; `c(60)` -> 6000.
const c = (p: number) => p * 100;

describe("crosses", () => {
  it("buy crosses when resting price <= taker price", () => {
    expect(crosses("buy", c(65), c(60))).toBe(true);
    expect(crosses("buy", c(65), c(65))).toBe(true);
    expect(crosses("buy", c(65), c(70))).toBe(false);
  });

  it("sell crosses when resting price >= taker price", () => {
    expect(crosses("sell", c(65), c(70))).toBe(true);
    expect(crosses("sell", c(65), c(65))).toBe(true);
    expect(crosses("sell", c(65), c(60))).toBe(false);
  });
});

describe("matchIncoming", () => {
  it("1. empty book: buy 5 @ 60 vs [] rests entirely", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(60), size: 5 };
    expect(matchIncoming(incoming, [])).toEqual({ fills: [], remainderSize: 5 });
  });

  it("2. no cross: buy 5 @ 60 vs offer 5 @ 65 rests untouched", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(60), size: 5 };
    const offers: RestingOrder[] = [{ id: 1, userId: 2, priceC: c(65), remaining: 5 }];
    expect(matchIncoming(incoming, offers)).toEqual({ fills: [], remainderSize: 5 });
  });

  it("2b. mirror: sell 5 @ 70 vs bid 5 @ 65 rests untouched", () => {
    const incoming: Incoming = { userId: 1, side: "sell", priceC: c(70), size: 5 };
    const bids: RestingOrder[] = [{ id: 1, userId: 2, priceC: c(65), remaining: 5 }];
    expect(matchIncoming(incoming, bids)).toEqual({ fills: [], remainderSize: 5 });
  });

  it("3. fills at RESTING price, not taker's limit price", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(70), size: 5 };
    const offers: RestingOrder[] = [{ id: 1, userId: 2, priceC: c(65), remaining: 5 }];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [{ restingOrderId: 1, makerUserId: 2, priceC: c(65), size: 5 }],
      remainderSize: 0,
    });
  });

  it("4. taker partial: incoming larger than the resting order", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(65), size: 10 };
    const offers: RestingOrder[] = [{ id: 1, userId: 2, priceC: c(60), remaining: 4 }];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [{ restingOrderId: 1, makerUserId: 2, priceC: c(60), size: 4 }],
      remainderSize: 6,
    });
  });

  it("5. maker partial: resting order larger than incoming", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(65), size: 3 };
    const offers: RestingOrder[] = [{ id: 1, userId: 2, priceC: c(60), remaining: 10 }];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [{ restingOrderId: 1, makerUserId: 2, priceC: c(60), size: 3 }],
      remainderSize: 0,
    });
  });

  it("6. multi-level sweep with price-time priority", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(65), size: 12 };
    const offers: RestingOrder[] = [
      { id: 1, userId: 2, priceC: c(60), remaining: 5 },
      { id: 2, userId: 3, priceC: c(60), remaining: 5 },
      { id: 3, userId: 2, priceC: c(62), remaining: 5 },
    ];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [
        { restingOrderId: 1, makerUserId: 2, priceC: c(60), size: 5 },
        { restingOrderId: 2, makerUserId: 3, priceC: c(60), size: 5 },
        { restingOrderId: 3, makerUserId: 2, priceC: c(62), size: 2 },
      ],
      remainderSize: 0,
    });
  });

  it("7. sweep stops at the taker's limit", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(65), size: 10 };
    const offers: RestingOrder[] = [
      { id: 1, userId: 2, priceC: c(60), remaining: 5 },
      { id: 2, userId: 2, priceC: c(70), remaining: 5 },
    ];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [{ restingOrderId: 1, makerUserId: 2, priceC: c(60), size: 5 }],
      remainderSize: 5,
    });
  });

  it("8. exact fill on both sides", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(60), size: 5 };
    const offers: RestingOrder[] = [{ id: 1, userId: 2, priceC: c(60), remaining: 5 }];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [{ restingOrderId: 1, makerUserId: 2, priceC: c(60), size: 5 }],
      remainderSize: 0,
    });
  });

  it("9. self-trade simple: buy side", () => {
    const incoming: Incoming = { userId: 7, side: "buy", priceC: c(60), size: 5 };
    const offers: RestingOrder[] = [{ id: 9, userId: 7, priceC: c(60), remaining: 5 }];
    expect(matchIncoming(incoming, offers)).toEqual({
      rejected: "SELF_TRADE",
      offendingOrderId: 9,
    });
  });

  it("9b. self-trade simple: sell side mirror", () => {
    const incoming: Incoming = { userId: 7, side: "sell", priceC: c(60), size: 5 };
    const bids: RestingOrder[] = [{ id: 9, userId: 7, priceC: c(60), remaining: 5 }];
    expect(matchIncoming(incoming, bids)).toEqual({
      rejected: "SELF_TRADE",
      offendingOrderId: 9,
    });
  });

  it("10. self-trade STRICT: rejected even though an earlier order would fully absorb it", () => {
    const incoming: Incoming = { userId: 7, side: "buy", priceC: c(61), size: 3 };
    const offers: RestingOrder[] = [
      { id: 1, userId: 2, priceC: c(60), remaining: 5 }, // would fully absorb 3 lots
      { id: 2, userId: 7, priceC: c(61), remaining: 5 }, // but this is the taker's own order
    ];
    expect(matchIncoming(incoming, offers)).toEqual({
      rejected: "SELF_TRADE",
      offendingOrderId: 2,
    });
  });

  it("11. no rejection when own order is not crossable", () => {
    const incoming: Incoming = { userId: 7, side: "buy", priceC: c(60), size: 5 };
    const offers: RestingOrder[] = [{ id: 1, userId: 7, priceC: c(70), remaining: 5 }];
    expect(matchIncoming(incoming, offers)).toEqual({ fills: [], remainderSize: 5 });
  });

  it("12. sell-side mirror of the multi-level sweep", () => {
    const incoming: Incoming = { userId: 1, side: "sell", priceC: c(58), size: 12 };
    const bids: RestingOrder[] = [
      { id: 1, userId: 2, priceC: c(62), remaining: 5 },
      { id: 2, userId: 3, priceC: c(62), remaining: 5 },
      { id: 3, userId: 2, priceC: c(60), remaining: 5 },
    ];
    expect(matchIncoming(incoming, bids)).toEqual({
      fills: [
        { restingOrderId: 1, makerUserId: 2, priceC: c(62), size: 5 },
        { restingOrderId: 2, makerUserId: 3, priceC: c(62), size: 5 },
        { restingOrderId: 3, makerUserId: 2, priceC: c(60), size: 2 },
      ],
      remainderSize: 0,
    });
  });

  it("13. tolerates resting orders with remaining <= 0 without emitting zero-size fills", () => {
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(65), size: 5 };
    const offers: RestingOrder[] = [
      { id: 1, userId: 2, priceC: c(60), remaining: 0 },
      { id: 2, userId: 3, priceC: c(60), remaining: 5 },
    ];
    expect(matchIncoming(incoming, offers)).toEqual({
      fills: [{ restingOrderId: 2, makerUserId: 3, priceC: c(60), size: 5 }],
      remainderSize: 0,
    });
  });

  it("14. does not mutate the input array or resting order objects", () => {
    const offers: RestingOrder[] = [
      { id: 1, userId: 2, priceC: c(60), remaining: 5 },
      { id: 2, userId: 3, priceC: c(62), remaining: 5 },
    ];
    const snapshot = offers.map((o) => ({ ...o }));
    const incoming: Incoming = { userId: 1, side: "buy", priceC: c(65), size: 3 };

    matchIncoming(incoming, offers);

    expect(offers).toEqual(snapshot);
    expect(offers.length).toBe(2);
  });
});
