'use strict';
// Creates demo users and raffles. Usage: npm run seed  (uses DATA_DIR or ./data)
const path = require('node:path');
const fs = require('node:fs');
const { open } = require('./db');
const { AuthService } = require('./auth');
const { RaffleService } = require('./raffle');

const dataDir = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
const db = open(path.join(dataDir, 'bextim.db'));
const auth = new AuthService(db);
const svc = new RaffleService(db);

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data — delete the data/ folder to reseed.');
  process.exit(0);
}

const admin = auth.register({ phone: '0500000000', name: 'Admin', password: 'admin123' });
db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin);
const users = [
  ['0501112233', 'Aysel Məmmədova'], ['0552223344', 'Rəşad Əliyev'], ['0703334455', 'Nigar Hüseynova'],
  ['0774445566', 'Elvin Quliyev'], ['0995556677', 'Leyla Kərimova'],
].map(([phone, name]) => {
  const id = auth.register({ phone, name, password: 'demo123' });
  svc.topUp(id, 50000);
  return id;
});

const demo = [
  [0, 'iPhone 13 128GB, mavi', 'Əla vəziyyətdədir, batareya 89%. Qutusu və adapteri var. Heç vaxt təmir olunmayıb.', 'phones', 'baku', 'used', 'both', 900, 5, 150, 10],
  [1, 'PlayStation 5 + 2 pult', 'Disk versiyası, 2 orijinal DualSense pult və 3 oyun hədiyyə. Çox az istifadə olunub.', 'electronics', 'baku', 'like_new', 'pickup', 1100, 10, 100, 14],
  [2, 'Uşaq velosipedi 16"', '4-7 yaş üçün, köməkçi təkərlər var. Bir mövsüm sürülüb, heç bir qüsuru yoxdur.', 'kids', 'sumgait', 'used', 'pickup', 120, 2, 50, 7],
  [3, 'Dyson V11 tozsoran', 'Tam komplekt, zəmanət talonu ilə. Hədiyyə gəlib, istifadə olunmayıb.', 'appliances', 'baku', 'new', 'courier', 750, 5, 120, 10],
  [4, 'Apple Watch Series 8', '45mm, qara. Ekran qoruyucu ilə istifadə olunub, cızıq yoxdur.', 'electronics', 'ganja', 'like_new', 'both', 480, 4, 100, 5],
  [0, 'LEGO Technic Porsche 911', 'Açılmamış qutu, 1458 hissə. Kolleksiya üçün ideal hədiyyə.', 'hobby', 'baku', 'new', 'both', 360, 3, 90, 12],
  [1, 'Qış gödəkçəsi The North Face, L', 'Orijinal, 700 doldurma. Bir qış geyinilib.', 'fashion', 'baku', 'used', 'courier', 240, 2, 80, 6],
  [2, 'Oyuncaq ayı (böyük, 1m)', 'Yumşaq, yeni. Ad günü hədiyyəsi üçün əla seçim.', 'kids', 'baku', 'new', 'pickup', 12, 1, 10, 4],
];
for (const [seller, title, description, category, city, cond, delivery, price, ticket, min, days] of demo) {
  const id = svc.createRaffle(users[seller], {
    title, description, category, city, item_condition: cond, delivery,
    price_total: price * 100, ticket_price: ticket * 100, min_tickets: min, duration_days: days,
  });
  // Simulate some sales from other users.
  const count = price / ticket;
  let sold = Math.floor(count * (0.15 + Math.random() * 0.6));
  for (const buyer of users) {
    if (buyer === users[seller] || sold <= 0) continue;
    const q = Math.min(sold, 1 + Math.floor(Math.random() * Math.max(1, sold / 2)));
    try { svc.buyTickets(buyer, id, q); sold -= q; } catch { /* balance exhausted */ }
  }
}
console.log('Seeded. Admin: 050 000 00 00 / admin123 · Demo user: 050 111 22 33 / demo123');
