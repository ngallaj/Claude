'use strict';
const crypto = require('node:crypto');
const { AppError } = require('./raffle');

const SESSION_DAYS = 30;
const AZ_MOBILE = /^\+994(10|50|51|55|60|70|77|99)\d{7}$/;

// Accepts "050 123 45 67", "994501234567", "+994 50 123-45-67" -> "+994501234567"
function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.startsWith('994')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  const phone = `+994${digits}`;
  return AZ_MOBILE.test(phone) ? phone : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

class AuthService {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
  }

  register({ phone, name, password }) {
    const errors = {};
    const p = normalizePhone(phone);
    name = String(name ?? '').trim();
    if (!p) errors.phone = 'phone_invalid';
    if (name.length < 2 || name.length > 50) errors.name = 'name_length';
    if (String(password ?? '').length < 6) errors.password = 'password_length';
    if (Object.keys(errors).length) throw new AppError('validation', 400, errors);
    if (this.db.prepare('SELECT 1 FROM users WHERE phone = ?').get(p)) throw new AppError('validation', 400, { phone: 'phone_taken' });
    const { lastInsertRowid } = this.db.prepare('INSERT INTO users (phone, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(p, name, hashPassword(String(password)), this.now());
    return Number(lastInsertRowid);
  }

  login({ phone, password }) {
    const p = normalizePhone(phone);
    const user = p && this.db.prepare('SELECT * FROM users WHERE phone = ?').get(p);
    if (!user || !verifyPassword(String(password ?? ''), user.password_hash)) throw new AppError('bad_credentials', 401);
    if (user.is_blocked) throw new AppError('blocked', 403);
    return user.id;
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, this.now() + SESSION_DAYS * 86400000);
    return token;
  }

  destroySession(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  userForToken(token) {
    if (!token) return null;
    return this.db.prepare(`
      SELECT u.id, u.phone, u.name, u.balance, u.is_admin, u.is_blocked, u.created_at FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`).get(token, this.now()) ?? null;
  }
}

module.exports = { AuthService, normalizePhone, hashPassword, SESSION_DAYS };
