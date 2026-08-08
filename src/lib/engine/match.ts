// Pure matching engine. No imports of db/fs/anything stateful — this module
// only computes what the sweep across a pre-sorted resting book should do.
// The data layer (lib/data/orders.ts) is responsible for loading the book in
// the right order, applying the result inside a transaction, and persisting
// resting orders/trades.

import type { Side } from "../types";

export interface RestingOrder {
  id: number;
  userId: number;
  priceC: number;
  remaining: number;
}

export interface Incoming {
  userId: number;
  side: Side;
  priceC: number;
  size: number;
}

export interface Fill {
  restingOrderId: number;
  makerUserId: number;
  priceC: number;
  size: number;
}

export type MatchResult =
  | { rejected: "SELF_TRADE"; offendingOrderId: number }
  | { rejected?: undefined; fills: Fill[]; remainderSize: number };

// buy: taker will pay up to takerPriceC, so any resting offer at or below
// that price crosses. sell: taker will accept down to takerPriceC, so any
// resting bid at or above that price crosses.
export function crosses(side: Side, takerPriceC: number, restingPriceC: number): boolean {
  return side === "buy" ? restingPriceC <= takerPriceC : restingPriceC >= takerPriceC;
}

// `restingOpposite` must already be sorted best-first by the caller (price
// then id ASC for time priority) — this function never sorts or mutates it.
export function matchIncoming(incoming: Incoming, restingOpposite: RestingOrder[]): MatchResult {
  // Phase 1 — self-trade guard, strict "would cross" rule. Walk the
  // crossable range best-first; if the incoming user owns any order in that
  // range, reject before producing a single fill — even if another user's
  // order earlier in priority would have absorbed the whole incoming size.
  for (const resting of restingOpposite) {
    if (resting.remaining <= 0) continue; // tolerate defensively; not expected from caller
    if (!crosses(incoming.side, incoming.priceC, resting.priceC)) break;
    if (resting.userId === incoming.userId) {
      return { rejected: "SELF_TRADE", offendingOrderId: resting.id };
    }
  }

  // Phase 2 — sweep. Fill at the RESTING order's price (taker gets price
  // improvement), walking levels until the remainder is exhausted or the
  // next order no longer crosses.
  const fills: Fill[] = [];
  let remainder = incoming.size;
  for (const resting of restingOpposite) {
    if (remainder === 0) break;
    if (resting.remaining <= 0) continue;
    if (!crosses(incoming.side, incoming.priceC, resting.priceC)) break;

    const size = Math.min(remainder, resting.remaining);
    fills.push({
      restingOrderId: resting.id,
      makerUserId: resting.userId,
      priceC: resting.priceC,
      size,
    });
    remainder -= size;
  }

  return { fills, remainderSize: remainder };
}
