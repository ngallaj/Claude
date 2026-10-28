'use strict';
// Consistent snapshot of the database plus a mirror of uploaded photos. Keeps the last 14 daily snapshots.
// Usage: DATA_DIR=/var/lib/bextim node src/backup.js /var/backups/bextim
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('./db');

const KEEP = 14;
const dataDir = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data');
const target = process.argv[2];
if (!target) {
  console.error('Usage: node src/backup.js <backup-dir>');
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });

const file = path.join(target, `bextim-${new Date().toISOString().slice(0, 10)}.db`);
fs.rmSync(file, { force: true });
open(path.join(dataDir, 'bextim.db')).exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

const uploads = path.join(dataDir, 'uploads');
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(target, 'uploads'), { recursive: true });

const old = fs.readdirSync(target).filter((f) => /^bextim-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP);
old.forEach((f) => fs.rmSync(path.join(target, f)));
console.log(`Backup written: ${file}`);
