-- Petrol Pump CRM schema (Cloudflare D1 / SQLite).
-- Customer, entry and settings records are stored as JSON so the app can add
-- fields without schema changes; updated_at (ms) drives incremental sync and
-- deleted rows are kept as tombstones so other devices learn about deletes.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  active INTEGER NOT NULL DEFAULT 1,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_iter INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE login_failures (
  username TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_user ON login_failures (username, at);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX customers_updated ON customers (updated_at);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX entries_updated ON entries (updated_at);
CREATE INDEX entries_customer ON entries (customer_id);
