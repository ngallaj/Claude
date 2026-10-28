'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { open } = require('./db');
const { AuthService, SESSION_DAYS } = require('./auth');
const { RaffleService, AppError, CATEGORIES, CITIES, CONDITIONS, DELIVERY, LIMITS } = require('./raffle');

const ROOT = path.join(__dirname, '..');
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, v]) => [k, decodeURIComponent(v ?? '')]));
}

function createApp({ db, uploadDir, secureCookies = false }) {
  const auth = new AuthService(db);
  const raffles = new RaffleService(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
    });
    // Basic CSRF protection: state-changing requests must come from our own origin.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      if (new URL(req.headers.origin).host !== host) return res.status(403).json({ error: 'bad_origin' });
    }
    req.token = parseCookies(req.headers.cookie).sid;
    req.user = auth.userForToken(req.token);
    next();
  });

  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'auth_required' }));
  const requireAdmin = (req, res, next) => (req.user?.is_admin ? next() : res.status(403).json({ error: 'forbidden' }));
  const setSession = (res, userId) => {
    res.cookie('sid', auth.createSession(userId), {
      httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: SESSION_DAYS * 86400000, path: '/',
    });
  };
  const id = (req) => Number(req.params.id);

  // Simple in-memory limiter for login/register brute force.
  const attempts = new Map();
  const limit = (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const list = (attempts.get(key) ?? []).filter((t) => now - t < 15 * 60 * 1000);
    if (list.length >= 20) return res.status(429).json({ error: 'too_many_attempts' });
    list.push(now);
    attempts.set(key, list);
    next();
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + IMAGE_TYPES[file.mimetype]),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: LIMITS.maxImages },
    fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
  });

  // ---------- public ----------
  app.get('/api/meta', (req, res) => {
    res.json({ categories: CATEGORIES, cities: CITIES, conditions: CONDITIONS, delivery: DELIVERY, limits: LIMITS, commission_rate: raffles.getCommissionRate() });
  });
  app.get('/api/raffles', (req, res) => res.json(raffles.listRaffles(req.query)));
  app.get('/api/raffles/:id', (req, res) => res.json(raffles.getRaffle(id(req), req.user?.id, { countView: req.query.view === '1' })));

  // ---------- auth ----------
  app.post('/api/auth/register', limit, (req, res) => {
    const userId = auth.register(req.body);
    setSession(res, userId);
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/login', limit, (req, res) => {
    setSession(res, auth.login(req.body));
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.token) auth.destroySession(req.token);
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/me', (req, res) => res.json({ user: req.user }));

  // ---------- account ----------
  app.get('/api/me/tickets', requireUser, (req, res) => res.json(raffles.myTickets(req.user.id)));
  app.get('/api/me/raffles', requireUser, (req, res) => res.json(raffles.myRaffles(req.user.id)));
  app.get('/api/me/transactions', requireUser, (req, res) => res.json(raffles.transactions(req.user.id)));
  app.post('/api/wallet/topup', requireUser, (req, res) => {
    raffles.topUp(req.user.id, Number(req.body.amount) * 100);
    res.json({ ok: true });
  });
  app.post('/api/wallet/withdraw', requireUser, (req, res) => {
    raffles.withdraw(req.user.id, Number(req.body.amount) * 100);
    res.json({ ok: true });
  });

  // ---------- raffles ----------
  app.post('/api/raffles', requireUser, upload.array('images', LIMITS.maxImages), (req, res) => {
    const b = req.body;
    const raffleId = raffles.createRaffle(req.user.id, {
      ...b,
      price_total: Number(b.price_total) * 100,
      ticket_price: Number(b.ticket_price) * 100,
      min_tickets: b.min_tickets === '' || b.min_tickets === undefined ? undefined : Number(b.min_tickets),
      duration_days: Number(b.duration_days),
      images: (req.files ?? []).map((f) => `/uploads/${f.filename}`),
    });
    res.status(201).json({ id: raffleId });
  });
  app.post('/api/raffles/:id/buy', requireUser, (req, res) => res.json({ numbers: raffles.buyTickets(req.user.id, id(req), req.body.quantity) }));
  app.post('/api/raffles/:id/draw', requireUser, (req, res) => { raffles.drawEarly(req.user.id, id(req)); res.json({ ok: true }); });
  app.post('/api/raffles/:id/cancel', requireUser, (req, res) => { raffles.cancelRaffle(req.user.id, id(req)); res.json({ ok: true }); });
  app.post('/api/raffles/:id/confirm', requireUser, (req, res) => { raffles.confirmReceipt(req.user.id, id(req)); res.json({ ok: true }); });
  app.post('/api/raffles/:id/dispute', requireUser, (req, res) => { raffles.openDispute(req.user.id, id(req), req.body.reason); res.json({ ok: true }); });

  // ---------- admin ----------
  app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(raffles.stats()));
  app.put('/api/admin/commission', requireAdmin, (req, res) => res.json({ commission_rate: raffles.setCommissionRate(Number(req.body.percent) / 100) }));
  app.get('/api/admin/raffles', requireAdmin, (req, res) => {
    const status = String(req.query.status ?? 'disputed');
    const rows = db.prepare(`SELECT r.id, r.title, r.status, r.tickets_sold, r.ticket_count, r.ticket_price, r.min_tickets, r.ends_at,
      r.featured, r.dispute_reason, u.name AS seller_name, u.phone AS seller_phone, w.name AS winner_name, w.phone AS winner_phone
      FROM raffles r JOIN users u ON u.id = r.seller_id LEFT JOIN users w ON w.id = r.winner_user_id
      WHERE (? = 'all' OR r.status = ?) ORDER BY r.id DESC LIMIT 200`).all(status, status);
    res.json(rows);
  });
  app.post('/api/admin/raffles/:id/resolve', requireAdmin, (req, res) => { raffles.resolveDispute(id(req), req.body.decision); res.json({ ok: true }); });
  app.post('/api/admin/raffles/:id/cancel', requireAdmin, (req, res) => { raffles.cancelRaffle(req.user.id, id(req), { asAdmin: true }); res.json({ ok: true }); });
  app.post('/api/admin/raffles/:id/feature', requireAdmin, (req, res) => {
    db.prepare('UPDATE raffles SET featured = 1 - featured WHERE id = ?').run(id(req));
    res.json({ ok: true });
  });
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT id, phone, name, balance, is_admin, is_blocked, created_at FROM users ORDER BY id DESC LIMIT 500').all());
  });
  app.post('/api/admin/users/:id/block', requireAdmin, (req, res) => {
    db.prepare('UPDATE users SET is_blocked = 1 - is_blocked WHERE id = ? AND is_admin = 0').run(id(req));
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id(req));
    res.json({ ok: true });
  });
  app.post('/api/admin/tick', requireAdmin, (req, res) => res.json(raffles.tick()));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // ---------- static ----------
  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', fallthrough: false }));
  app.use(express.static(path.join(ROOT, 'public')));
  app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, details: err.details });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'upload_error', details: { images: err.code } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return { app, raffles, auth };
}

if (require.main === module) {
  const dataDir = process.env.DATA_DIR ?? path.join(ROOT, 'data');
  const uploadDir = path.join(dataDir, 'uploads');
  require('node:fs').mkdirSync(uploadDir, { recursive: true });
  const db = open(path.join(dataDir, 'bextim.db'));
  const { app, raffles } = createApp({ db, uploadDir, secureCookies: process.env.NODE_ENV === 'production' });
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  // Draw/refund expired raffles and auto-release payouts every 30 seconds.
  const runTick = () => {
    try {
      const r = raffles.tick();
      if (r.drawn || r.refunded || r.released) console.log('[tick]', r);
    } catch (err) { console.error('[tick]', err); }
  };
  runTick();
  setInterval(runTick, 30_000).unref();

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`Bəxtim.az running on http://localhost:${port}`));
}

module.exports = { createApp };
