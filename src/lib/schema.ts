// DDL kept as a TS string (not a .sql file) so it survives Next's server
// bundling without runtime file-path lookups. Idempotent: safe to run on
// every boot.
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS markets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id  INTEGER NOT NULL REFERENCES users(id),
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  type        TEXT    NOT NULL CHECK (type IN ('binary','numeric')),
  unit        TEXT,
  status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  settle_c    INTEGER,
  created_at  INTEGER NOT NULL,
  settled_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status, id DESC);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id  INTEGER NOT NULL REFERENCES markets(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  side       TEXT    NOT NULL CHECK (side IN ('buy','sell')),
  price_c    INTEGER NOT NULL,
  size       INTEGER NOT NULL CHECK (size > 0),
  remaining  INTEGER NOT NULL CHECK (remaining >= 0),
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_book ON orders(market_id, side, price_c, id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);

CREATE TABLE IF NOT EXISTS trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id     INTEGER NOT NULL REFERENCES markets(id),
  buy_order_id  INTEGER NOT NULL REFERENCES orders(id),
  sell_order_id INTEGER NOT NULL REFERENCES orders(id),
  buyer_id      INTEGER NOT NULL REFERENCES users(id),
  seller_id     INTEGER NOT NULL REFERENCES users(id),
  price_c       INTEGER NOT NULL,
  size          INTEGER NOT NULL CHECK (size > 0),
  taker_side    TEXT    NOT NULL CHECK (taker_side IN ('buy','sell')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_trades_buyer  ON trades(buyer_id);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades(seller_id);
`;
