'use strict';
// Core business rules: listing, ticket sales, escrow, draws, refunds and payouts.
const crypto = require('node:crypto');
const { tx } = require('./db');

const CATEGORIES = [
  'electronics', 'phones', 'computers', 'home', 'appliances', 'fashion',
  'kids', 'sports', 'hobby', 'auto_parts', 'jewelry', 'other',
];
const CITIES = [
  'baku', 'ganja', 'sumgait', 'mingachevir', 'lankaran', 'shaki', 'shirvan',
  'nakhchivan', 'quba', 'khirdalan', 'shamakhi', 'other',
];
const CONDITIONS = ['new', 'like_new', 'used'];
const DELIVERY = ['pickup', 'courier', 'both'];

const LIMITS = {
  minTicketPrice: 50, // 0.50 AZN
  minTotal: 100, // 1 AZN
  maxTotal: 10_000_000, // 100 000 AZN
  minTickets: 2,
  maxTickets: 5000,
  minDays: 1,
  maxDays: 30,
  maxImages: 8,
  autoReleaseDays: 7, // winner has this long to confirm receipt or open a dispute
};

const DAY = 24 * 60 * 60 * 1000;

class AppError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Deterministic, publicly verifiable winner selection. The seller and buyers see seed_hash from day one;
// server_seed is revealed after the draw so anyone can recompute the result (see /verify page).
function computeDraw(serverSeed, raffleId, tickets) {
  const digest = sha256(tickets.map((t) => `${t.number}:${t.user_id}`).join('|'));
  const message = `${raffleId}:${tickets.length}:${digest}`;
  const hmac = crypto.createHmac('sha256', serverSeed).update(message).digest('hex');
  const index = parseInt(hmac.slice(0, 13), 16) % tickets.length;
  return { digest, message, hmac, winningNumber: tickets[index].number };
}

function maskName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

class RaffleService {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
  }

  // ---------- settings ----------
  getCommissionRate() {
    return Number(this.db.prepare(`SELECT value FROM settings WHERE key = 'commission_rate'`).get().value);
  }

  setCommissionRate(rate) {
    rate = Number(rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) throw new AppError('invalid_commission');
    this.db.prepare(`UPDATE settings SET value = ? WHERE key = 'commission_rate'`).run(String(rate));
    return rate;
  }

  // ---------- wallet ----------
  _credit(userId, raffleId, type, amount, note) {
    if (userId != null) this.db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
    this.db.prepare('INSERT INTO transactions (user_id, raffle_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, raffleId, type, amount, note ?? null, this.now());
  }

  // Demo top-up. In production this is called from the payment provider callback (Azericard, Epoint, etc.).
  topUp(userId, amount) {
    amount = Math.round(Number(amount));
    if (!Number.isInteger(amount) || amount < 100 || amount > 1_000_000) throw new AppError('invalid_amount');
    return tx(this.db, () => this._credit(userId, null, 'topup', amount));
  }

  withdraw(userId, amount) {
    amount = Math.round(Number(amount));
    return tx(this.db, () => {
      const { balance } = this.db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      if (!Number.isInteger(amount) || amount < 100) throw new AppError('invalid_amount');
      if (amount > balance) throw new AppError('insufficient_balance');
      this._credit(userId, null, 'withdrawal', -amount);
    });
  }

  // ---------- listing ----------
  validateInput(input) {
    const errors = {};
    const title = String(input.title ?? '').trim();
    const description = String(input.description ?? '').trim();
    const priceTotal = Math.round(Number(input.price_total));
    const ticketPrice = Math.round(Number(input.ticket_price));
    const days = Number(input.duration_days);
    const images = Array.isArray(input.images) ? input.images : [];

    if (title.length < 5 || title.length > 80) errors.title = 'title_length';
    if (description.length < 20 || description.length > 3000) errors.description = 'description_length';
    if (!CATEGORIES.includes(input.category)) errors.category = 'required';
    if (!CITIES.includes(input.city)) errors.city = 'required';
    if (!CONDITIONS.includes(input.item_condition)) errors.item_condition = 'required';
    if (!DELIVERY.includes(input.delivery)) errors.delivery = 'required';
    if (!Number.isInteger(priceTotal) || priceTotal < LIMITS.minTotal || priceTotal > LIMITS.maxTotal) errors.price_total = 'price_range';
    if (!Number.isInteger(ticketPrice) || ticketPrice < LIMITS.minTicketPrice) errors.ticket_price = 'ticket_price_min';
    if (!errors.price_total && !errors.ticket_price && priceTotal % ticketPrice !== 0) errors.ticket_price = 'not_divisible';

    const ticketCount = errors.price_total || errors.ticket_price ? 0 : priceTotal / ticketPrice;
    if (ticketCount && (ticketCount < LIMITS.minTickets || ticketCount > LIMITS.maxTickets)) errors.ticket_price = 'ticket_count_range';

    const minTickets = input.min_tickets === undefined || input.min_tickets === '' ? ticketCount : Number(input.min_tickets);
    if (ticketCount && (!Number.isInteger(minTickets) || minTickets < 1 || minTickets > ticketCount)) errors.min_tickets = 'min_range';
    if (!Number.isInteger(days) || days < LIMITS.minDays || days > LIMITS.maxDays) errors.duration_days = 'days_range';
    if (images.length > LIMITS.maxImages) errors.images = 'too_many_images';

    if (Object.keys(errors).length) throw new AppError('validation', 400, errors);
    return { title, description, priceTotal, ticketPrice, ticketCount, minTickets, days, images };
  }

  createRaffle(sellerId, input) {
    const v = this.validateInput(input);
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const now = this.now();
    const { lastInsertRowid } = this.db.prepare(`
      INSERT INTO raffles (seller_id, title, description, category, city, item_condition, delivery, images,
        price_total, ticket_price, ticket_count, min_tickets, commission_rate, ends_at, seed_hash, server_seed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sellerId, v.title, v.description, input.category, input.city, input.item_condition, input.delivery,
      JSON.stringify(v.images), v.priceTotal, v.ticketPrice, v.ticketCount, v.minTickets,
      this.getCommissionRate(), now + v.days * DAY, sha256(serverSeed), serverSeed, now,
    );
    return Number(lastInsertRowid);
  }

  cancelRaffle(userId, raffleId, { asAdmin = false } = {}) {
    return tx(this.db, () => {
      const r = this._raffle(raffleId);
      if (!asAdmin && r.seller_id !== userId) throw new AppError('forbidden', 403);
      if (r.status !== 'active') throw new AppError('not_active');
      if (r.tickets_sold > 0) {
        if (!asAdmin) throw new AppError('has_tickets');
        this._refundAll(r, 'cancelled');
        return;
      }
      this.db.prepare(`UPDATE raffles SET status = 'cancelled', completed_at = ? WHERE id = ?`).run(this.now(), r.id);
    });
  }

  _raffle(id) {
    const r = this.db.prepare('SELECT * FROM raffles WHERE id = ?').get(id);
    if (!r) throw new AppError('not_found', 404);
    return r;
  }

  // ---------- tickets ----------
  buyTickets(userId, raffleId, quantity) {
    quantity = Number(quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new AppError('invalid_quantity');
    return tx(this.db, () => {
      const r = this._raffle(raffleId);
      if (r.status !== 'active' || r.ends_at <= this.now()) throw new AppError('not_active');
      if (r.seller_id === userId) throw new AppError('own_raffle');
      const left = r.ticket_count - r.tickets_sold;
      if (quantity > left) throw new AppError('not_enough_tickets', 400, { left });
      const cost = quantity * r.ticket_price;
      const user = this.db.prepare('SELECT balance, is_blocked FROM users WHERE id = ?').get(userId);
      if (user.is_blocked) throw new AppError('blocked', 403);
      if (user.balance < cost) throw new AppError('insufficient_balance', 400, { need: cost - user.balance });

      const now = this.now();
      const insert = this.db.prepare('INSERT INTO tickets (raffle_id, number, user_id, purchased_at) VALUES (?, ?, ?, ?)');
      const numbers = [];
      for (let i = 1; i <= quantity; i++) {
        const n = r.tickets_sold + i;
        insert.run(r.id, n, userId, now);
        numbers.push(n);
      }
      this.db.prepare('UPDATE raffles SET tickets_sold = tickets_sold + ? WHERE id = ?').run(quantity, r.id);
      this._credit(userId, r.id, 'ticket_purchase', -cost, `#${numbers[0]}${quantity > 1 ? `–${numbers.at(-1)}` : ''}`);

      // Sold out: draw immediately.
      if (r.tickets_sold + quantity === r.ticket_count) this._draw(r.id);
      return numbers;
    });
  }

  // ---------- draw / refund ----------
  _draw(raffleId) {
    const r = this._raffle(raffleId);
    const tickets = this.db.prepare('SELECT id, number, user_id FROM tickets WHERE raffle_id = ? ORDER BY number').all(r.id);
    const { winningNumber } = computeDraw(r.server_seed, r.id, tickets);
    const winner = tickets.find((t) => t.number === winningNumber);
    this.db.prepare(`UPDATE raffles SET status = 'drawn', winner_ticket_id = ?, winner_user_id = ?, drawn_at = ? WHERE id = ?`)
      .run(winner.id, winner.user_id, this.now(), r.id);
    return winner;
  }

  _refundAll(r, finalStatus) {
    const owners = this.db.prepare('SELECT user_id, COUNT(*) AS n FROM tickets WHERE raffle_id = ? GROUP BY user_id').all(r.id);
    for (const o of owners) this._credit(o.user_id, r.id, 'refund', o.n * r.ticket_price);
    this.db.prepare('UPDATE raffles SET status = ?, completed_at = ? WHERE id = ?').run(finalStatus, this.now(), r.id);
  }

  // Seller may draw before the deadline once the minimum is reached.
  drawEarly(userId, raffleId) {
    return tx(this.db, () => {
      const r = this._raffle(raffleId);
      if (r.seller_id !== userId) throw new AppError('forbidden', 403);
      if (r.status !== 'active') throw new AppError('not_active');
      if (r.tickets_sold < r.min_tickets) throw new AppError('min_not_reached');
      return this._draw(r.id);
    });
  }

  // ---------- after the draw ----------
  _release(r) {
    const revenue = r.tickets_sold * r.ticket_price;
    const commission = Math.round(revenue * r.commission_rate);
    this._credit(r.seller_id, r.id, 'payout', revenue - commission);
    if (commission > 0) this._credit(null, r.id, 'commission', commission);
    this.db.prepare(`UPDATE raffles SET status = 'completed', completed_at = ? WHERE id = ?`).run(this.now(), r.id);
  }

  confirmReceipt(userId, raffleId) {
    return tx(this.db, () => {
      const r = this._raffle(raffleId);
      if (r.winner_user_id !== userId) throw new AppError('forbidden', 403);
      if (r.status !== 'drawn') throw new AppError('invalid_state');
      this._release(r);
    });
  }

  openDispute(userId, raffleId, reason) {
    reason = String(reason ?? '').trim();
    if (reason.length < 10) throw new AppError('validation', 400, { reason: 'reason_length' });
    return tx(this.db, () => {
      const r = this._raffle(raffleId);
      if (r.winner_user_id !== userId) throw new AppError('forbidden', 403);
      if (r.status !== 'drawn') throw new AppError('invalid_state');
      this.db.prepare(`UPDATE raffles SET status = 'disputed', dispute_reason = ? WHERE id = ?`).run(reason.slice(0, 1000), r.id);
    });
  }

  resolveDispute(raffleId, decision) {
    return tx(this.db, () => {
      const r = this._raffle(raffleId);
      if (r.status !== 'disputed') throw new AppError('invalid_state');
      if (decision === 'release') this._release(r);
      else if (decision === 'refund') this._refundAll(r, 'refunded');
      else throw new AppError('invalid_decision');
    });
  }

  // Scheduled job: draw or refund expired raffles; auto-release payouts the winner never acted on.
  tick() {
    const now = this.now();
    const result = { drawn: 0, refunded: 0, released: 0 };
    const expired = this.db.prepare(`SELECT * FROM raffles WHERE status = 'active' AND ends_at <= ?`).all(now);
    for (const r of expired) {
      tx(this.db, () => {
        if (r.tickets_sold >= r.min_tickets && r.tickets_sold > 0) { this._draw(r.id); result.drawn++; }
        else { this._refundAll(r, 'refunded'); result.refunded++; }
      });
    }
    const stale = this.db.prepare(`SELECT * FROM raffles WHERE status = 'drawn' AND drawn_at <= ?`).all(now - LIMITS.autoReleaseDays * DAY);
    for (const r of stale) { tx(this.db, () => this._release(r)); result.released++; }
    return result;
  }

  // ---------- queries ----------
  _publicRaffle(r) {
    const seller = this.db.prepare('SELECT id, name, created_at FROM users WHERE id = ?').get(r.seller_id);
    return {
      id: r.id, title: r.title, description: r.description, category: r.category, city: r.city,
      item_condition: r.item_condition, delivery: r.delivery, images: JSON.parse(r.images),
      price_total: r.price_total, ticket_price: r.ticket_price, ticket_count: r.ticket_count,
      min_tickets: r.min_tickets, tickets_sold: r.tickets_sold, commission_rate: r.commission_rate,
      ends_at: r.ends_at, status: r.status, seed_hash: r.seed_hash, featured: !!r.featured, views: r.views,
      created_at: r.created_at, drawn_at: r.drawn_at,
      seller: { id: seller.id, name: maskName(seller.name), since: seller.created_at },
    };
  }

  listRaffles(f = {}) {
    const where = [];
    const args = [];
    const status = f.status === 'finished' ? `status IN ('drawn','completed','disputed')` : `status = 'active'`;
    where.push(status);
    if (CATEGORIES.includes(f.category)) { where.push('category = ?'); args.push(f.category); }
    if (CITIES.includes(f.city)) { where.push('city = ?'); args.push(f.city); }
    if (f.q) { where.push('(title LIKE ? OR description LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
    if (f.max_ticket) { where.push('ticket_price <= ?'); args.push(Math.round(Number(f.max_ticket) * 100)); }
    if (f.min_price) { where.push('price_total >= ?'); args.push(Math.round(Number(f.min_price) * 100)); }
    if (f.max_price) { where.push('price_total <= ?'); args.push(Math.round(Number(f.max_price) * 100)); }
    if (f.seller) { where.push('seller_id = ?'); args.push(Number(f.seller)); }
    const order = {
      ending: 'ends_at ASC',
      newest: 'created_at DESC',
      cheap_ticket: 'ticket_price ASC',
      progress: 'CAST(tickets_sold AS REAL) / ticket_count DESC',
    }[f.sort] ?? 'featured DESC, created_at DESC';
    const limit = Math.min(Number(f.limit) || 48, 100);
    const offset = Math.max(Number(f.offset) || 0, 0);
    const rows = this.db.prepare(`SELECT * FROM raffles WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM raffles WHERE ${where.join(' AND ')}`).get(...args);
    return { total: n, items: rows.map((r) => this._publicRaffle(r)) };
  }

  getRaffle(id, viewerId, { countView = false } = {}) {
    if (countView) this.db.prepare('UPDATE raffles SET views = views + 1 WHERE id = ?').run(id);
    const r = this._raffle(id);
    const out = this._publicRaffle(r);
    const tickets = this.db.prepare(`
      SELECT t.number, t.user_id, t.purchased_at, u.name FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.raffle_id = ? ORDER BY t.number`).all(r.id);
    out.participants = tickets.map((t) => ({ number: t.number, user_id: t.user_id, name: maskName(t.name), at: t.purchased_at }));
    out.my_tickets = viewerId ? tickets.filter((t) => t.user_id === viewerId).map((t) => t.number) : [];
    out.is_seller = viewerId === r.seller_id;
    if (r.winner_ticket_id) {
      const w = this.db.prepare('SELECT t.number, u.id, u.name, u.phone FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(r.winner_ticket_id);
      out.winner = { number: w.number, user_id: w.id, name: maskName(w.name) };
      out.is_winner = viewerId === w.id;
      out.server_seed = r.server_seed; // revealed after the draw for verification
      // Seller and winner need each other's contact details to hand over the item.
      if (out.is_seller) out.winner.phone = w.phone;
      if (out.is_winner) out.seller.phone = this.db.prepare('SELECT phone FROM users WHERE id = ?').get(r.seller_id).phone;
      out.auto_release_at = r.drawn_at + LIMITS.autoReleaseDays * DAY;
    }
    if (out.is_seller || out.is_winner) out.dispute_reason = r.dispute_reason;
    return out;
  }

  myTickets(userId) {
    return this.db.prepare(`
      SELECT r.*, COUNT(t.id) AS mine, GROUP_CONCAT(t.number) AS numbers FROM tickets t JOIN raffles r ON r.id = t.raffle_id
      WHERE t.user_id = ? GROUP BY r.id ORDER BY MAX(t.purchased_at) DESC`).all(userId)
      .map((r) => ({ ...this._publicRaffle(r), my_count: r.mine, my_numbers: r.numbers.split(',').map(Number), won: r.winner_user_id === userId }));
  }

  myRaffles(userId) {
    return this.db.prepare('SELECT * FROM raffles WHERE seller_id = ? ORDER BY created_at DESC').all(userId).map((r) => this._publicRaffle(r));
  }

  transactions(userId) {
    return this.db.prepare(`
      SELECT tr.id, tr.type, tr.amount, tr.note, tr.created_at, tr.raffle_id, r.title FROM transactions tr
      LEFT JOIN raffles r ON r.id = tr.raffle_id WHERE tr.user_id = ? ORDER BY tr.id DESC LIMIT 200`).all(userId);
  }

  stats() {
    const q = (sql) => this.db.prepare(sql).get();
    return {
      users: q('SELECT COUNT(*) AS n FROM users').n,
      active: q(`SELECT COUNT(*) AS n FROM raffles WHERE status = 'active'`).n,
      completed: q(`SELECT COUNT(*) AS n FROM raffles WHERE status = 'completed'`).n,
      disputed: q(`SELECT COUNT(*) AS n FROM raffles WHERE status = 'disputed'`).n,
      tickets_sold: q('SELECT COUNT(*) AS n FROM tickets').n,
      escrow: q(`SELECT COALESCE(SUM(tickets_sold * ticket_price), 0) AS n FROM raffles WHERE status IN ('active','drawn','disputed')`).n,
      commission_earned: q(`SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type = 'commission'`).n,
      gmv: q(`SELECT COALESCE(SUM(tickets_sold * ticket_price), 0) AS n FROM raffles WHERE status = 'completed'`).n,
      commission_rate: this.getCommissionRate(),
    };
  }
}

module.exports = { RaffleService, AppError, computeDraw, sha256, CATEGORIES, CITIES, CONDITIONS, DELIVERY, LIMITS, DAY };
