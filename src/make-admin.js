'use strict';
// Gives admin rights to an already registered user.
// Usage: DATA_DIR=/var/lib/bextim node src/make-admin.js 0501234567
const path = require('node:path');
const { open } = require('./db');
const { normalizePhone } = require('./auth');

const phone = normalizePhone(process.argv[2]);
if (!phone) {
  console.error('Usage: node src/make-admin.js <phone>   (register on the website first)');
  process.exit(1);
}
const db = open(path.join(process.env.DATA_DIR ?? path.join(__dirname, '..', 'data'), 'bextim.db'));
const { changes } = db.prepare('UPDATE users SET is_admin = 1 WHERE phone = ?').run(phone);
console.log(changes ? `${phone} is now an admin.` : `No user with ${phone}. Register on the website first.`);
process.exit(changes ? 0 : 1);
