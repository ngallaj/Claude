'use strict';
// SQLite storage (built into Node >= 22.13). All money is stored as integer qəpik (1 AZN = 100 qəpik).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS raffles (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  item_condition TEXT NOT NULL,
  delivery TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  price_total INTEGER NOT NULL,
  ticket_price INTEGER NOT NULL,
  ticket_count INTEGER NOT NULL,
  min_tickets INTEGER NOT NULL,
  tickets_sold INTEGER NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL,
  ends_at INTEGER NOT NULL,
  -- active -> drawn -> completed | disputed -> completed/refunded ; active -> refunded | cancelled
  status TEXT NOT NULL DEFAULT 'active',
  seed_hash TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  winner_ticket_id INTEGER,
  winner_user_id INTEGER,
  drawn_at INTEGER,
  completed_at INTEGER,
  dispute_reason TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status, ends_at);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  raffle_id INTEGER NOT NULL REFERENCES raffles(id),
  number INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purchased_at INTEGER NOT NULL,
  UNIQUE (raffle_id, number)
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  raffle_id INTEGER REFERENCES raffles(id),
  -- topup | withdrawal | ticket_purchase | refund | payout | commission
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('commission_rate', '0');
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside a transaction; nested calls join the outer transaction.
function tx(db, fn) {
  if (db.__inTx) return fn();
  db.exec('BEGIN IMMEDIATE');
  db.__inTx = true;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.__inTx = false;
  }
}

module.exports = { open, tx };
