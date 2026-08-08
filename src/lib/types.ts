export type Side = "buy" | "sell";
export type MarketType = "binary" | "numeric";
export type MarketStatus = "open" | "settled";
export type OrderStatus = "open" | "filled" | "cancelled";

// Row shapes exactly as stored in SQLite. All *_c fields are integer
// hundredths; timestamps are unix milliseconds.
export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
}

export interface MarketRow {
  id: number;
  creator_id: number;
  title: string;
  description: string;
  type: MarketType;
  unit: string | null;
  status: MarketStatus;
  settle_c: number | null;
  created_at: number;
  settled_at: number | null;
}

export interface OrderRow {
  id: number;
  market_id: number;
  user_id: number;
  side: Side;
  price_c: number;
  size: number;
  remaining: number;
  status: OrderStatus;
  created_at: number;
}

export interface TradeRow {
  id: number;
  market_id: number;
  buy_order_id: number;
  sell_order_id: number;
  buyer_id: number;
  seller_id: number;
  price_c: number;
  size: number;
  taker_side: Side;
  created_at: number;
}

// One side of a two-sided quote submission.
export interface QuoteLeg {
  priceC: number;
  size: number;
}
