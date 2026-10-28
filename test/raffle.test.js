'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { open } = require('../src/db');
const { AuthService, normalizePhone } = require('../src/auth');
const { RaffleService, computeDraw, sha256, DAY } = require('../src/raffle');

function setup() {
  const db = open(':memory:');
  let now = Date.UTC(2026, 9, 1);
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const auth = new AuthService(db, clock);
  const svc = new RaffleService(db, clock);
  const mk = (phone, name, balance = 0) => {
    const id = auth.register({ phone, name, password: 'secret1' });
    if (balance) svc.topUp(id, balance);
    return id;
  };
  const balance = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  return { db, clock, auth, svc, mk, balance };
}

// The example from the brief: a toy worth 10 AZN, listed at 12 AZN with 1 AZN tickets and a 10-ticket minimum.
const toy = (over = {}) => ({
  title: 'Oyuncaq maşın', description: 'Uşaq üçün yeni oyuncaq maşın, qutusunda.', category: 'kids', city: 'baku',
  item_condition: 'new', delivery: 'pickup', price_total: 1200, ticket_price: 100, min_tickets: 10, duration_days: 7, ...over,
});

test('phone numbers are normalised to +994 format', () => {
  assert.equal(normalizePhone('050 123 45 67'), '+994501234567');
  assert.equal(normalizePhone('+994 (55) 123-45-67'), '+994551234567');
  assert.equal(normalizePhone('12345'), null);
});

test('12 AZN at 1 AZN per ticket creates 12 tickets with the chosen minimum', () => {
  const { svc, mk, db } = setup();
  const seller = mk('0501111111', 'Seller');
  const id = svc.createRaffle(seller, toy());
  const r = db.prepare('SELECT * FROM raffles WHERE id = ?').get(id);
  assert.equal(r.ticket_count, 12);
  assert.equal(r.min_tickets, 10);
  assert.equal(r.seed_hash, sha256(r.server_seed));
});

test('validation rejects bad listings', () => {
  const { svc, mk } = setup();
  const seller = mk('0501111111', 'Seller');
  const err = (over) => { try { svc.createRaffle(seller, toy(over)); } catch (e) { return e.details; } return null; };
  assert.equal(err({ ticket_price: 500, price_total: 1200 }).ticket_price, 'not_divisible');
  assert.equal(err({ min_tickets: 13 }).min_tickets, 'min_range');
  assert.equal(err({ ticket_price: 20 }).ticket_price, 'ticket_price_min');
  assert.equal(err({ price_total: 100, ticket_price: 100 }).ticket_price, 'ticket_count_range');
  // Omitted minimum defaults to all tickets.
  assert.doesNotThrow(() => svc.createRaffle(seller, toy({ min_tickets: undefined })));
});

test('selling out draws immediately; winner confirms; seller paid with 0% commission', () => {
  const { svc, mk, balance, db } = setup();
  const seller = mk('0501111111', 'Seller');
  const a = mk('0502222222', 'Buyer A', 5000);
  const b = mk('0503333333', 'Buyer B', 5000);
  const id = svc.createRaffle(seller, toy());

  assert.deepEqual(svc.buyTickets(a, id, 5), [1, 2, 3, 4, 5]);
  assert.throws(() => svc.buyTickets(b, id, 8), { code: 'not_enough_tickets' });
  assert.throws(() => svc.buyTickets(seller, id, 1), { code: 'own_raffle' });
  svc.buyTickets(b, id, 7);

  const r = svc.getRaffle(id, a);
  assert.equal(r.status, 'drawn');
  assert.ok([a, b].includes(r.winner.user_id));
  assert.equal(balance(seller), 0, 'money stays in escrow until the winner confirms');

  assert.throws(() => svc.confirmReceipt(seller, id), { code: 'forbidden' });
  svc.confirmReceipt(r.winner.user_id, id);
  assert.equal(balance(seller), 1200);
  assert.equal(db.prepare(`SELECT status FROM raffles WHERE id = ?`).get(id).status, 'completed');
});

test('commission is snapshotted at listing time and deducted on payout', () => {
  const { svc, mk, balance, db } = setup();
  const seller = mk('0501111111', 'Seller');
  const buyer = mk('0502222222', 'Buyer', 5000);
  const before = svc.createRaffle(seller, toy());
  svc.setCommissionRate(0.1);
  const after = svc.createRaffle(seller, toy());

  svc.buyTickets(buyer, before, 12);
  svc.confirmReceipt(buyer, before);
  assert.equal(balance(seller), 1200, 'old listing keeps 0%');

  svc.buyTickets(buyer, after, 12);
  svc.confirmReceipt(buyer, after);
  assert.equal(balance(seller), 1200 + 1080, 'new listing pays 10%');
  assert.equal(db.prepare(`SELECT SUM(amount) AS s FROM transactions WHERE type = 'commission'`).get().s, 120);
});

test('deadline with minimum reached draws; below minimum refunds everyone', () => {
  const { svc, mk, balance, clock } = setup();
  const seller = mk('0501111111', 'Seller');
  const a = mk('0502222222', 'Buyer A', 5000);
  const ok = svc.createRaffle(seller, toy());
  const low = svc.createRaffle(seller, toy());
  svc.buyTickets(a, ok, 10);
  svc.buyTickets(a, low, 9);
  assert.equal(balance(a), 5000 - 1900);

  clock.advance(7 * DAY + 1);
  assert.throws(() => svc.buyTickets(a, ok, 1), { code: 'not_active' });
  assert.deepEqual(svc.tick(), { drawn: 1, refunded: 1, released: 0 });
  assert.equal(svc.getRaffle(ok).status, 'drawn');
  assert.equal(svc.getRaffle(low).status, 'refunded');
  assert.equal(balance(a), 5000 - 1000);

  // Winner never confirms -> auto-release after 7 days.
  clock.advance(7 * DAY);
  assert.equal(svc.tick().released, 1);
  assert.equal(balance(seller), 1000);
});

test('seller can draw early only after minimum; can cancel only with no sales', () => {
  const { svc, mk } = setup();
  const seller = mk('0501111111', 'Seller');
  const a = mk('0502222222', 'Buyer A', 5000);
  const id = svc.createRaffle(seller, toy());
  assert.doesNotThrow(() => svc.cancelRaffle(seller, svc.createRaffle(seller, toy())));
  svc.buyTickets(a, id, 9);
  assert.throws(() => svc.drawEarly(seller, id), { code: 'min_not_reached' });
  assert.throws(() => svc.cancelRaffle(seller, id), { code: 'has_tickets' });
  svc.buyTickets(a, id, 1);
  assert.equal(svc.drawEarly(seller, id).user_id, a);
});

test('dispute blocks payout; admin refund returns money to buyers', () => {
  const { svc, mk, balance } = setup();
  const seller = mk('0501111111', 'Seller');
  const a = mk('0502222222', 'Buyer A', 5000);
  const id = svc.createRaffle(seller, toy());
  svc.buyTickets(a, id, 12);
  svc.openDispute(a, id, 'Satıcı əşyanı vermir, cavab vermir');
  assert.throws(() => svc.confirmReceipt(a, id), { code: 'invalid_state' });
  svc.resolveDispute(id, 'refund');
  assert.equal(balance(a), 5000);
  assert.equal(balance(seller), 0);
});

test('insufficient balance is rejected without side effects', () => {
  const { svc, mk, balance, db } = setup();
  const seller = mk('0501111111', 'Seller');
  const a = mk('0502222222', 'Buyer A', 300);
  const id = svc.createRaffle(seller, toy());
  assert.throws(() => svc.buyTickets(a, id, 4), { code: 'insufficient_balance' });
  assert.equal(balance(a), 300);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
});

test('draw is reproducible from the revealed seed', () => {
  const seed = crypto.randomBytes(32).toString('hex');
  const tickets = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, user_id: (i % 3) + 1 }));
  const a = computeDraw(seed, 7, tickets);
  assert.deepEqual(a, computeDraw(seed, 7, tickets));
  assert.ok(a.winningNumber >= 1 && a.winningNumber <= 12);
});
