# Bəxtim.az (bextim.az)

A raffle marketplace for Azerbaijan. People list their belongings, the price is split into tickets, others buy
tickets, and a random winner takes the item. It is like Raffall.com without the charity element, with Tap.az-style
UX for the local market.

> Example: a toy worth 10 AZN is listed at **12 AZN** with **1 AZN** tickets → **12 tickets**. The seller sets a
> **minimum of 10**. Once 10 are sold the seller may draw; all 12 sold → instant draw; deadline with < 10 sold →
> everyone is refunded automatically.

See **[docs/ANALYSIS.md](docs/ANALYSIS.md)** for the Raffall and Tap.az analysis, the product rules and the
legal checklist.

## Features
- Listing with photos, category, city, condition and delivery, plus a live ticket calculator (tickets, minimum, payout)
- Wallet and **escrow**: the seller is paid only after the winner confirms receipt (auto-release after 7 days)
- Minimum-ticket threshold, early draw by the seller, automatic refunds when the minimum isn't reached
- **Provably fair draw** (commit–reveal with SHA-256/HMAC) and an in-browser verification page
- Disputes resolved by an admin (pay the seller or refund the buyers)
- **Commission setting**: 0% now, changeable to 10% in the admin panel; each listing keeps the rate it was created with
- Admin panel: stats, commission, raffle moderation (VIP flag, cancel with refund), blocking users
- Azerbaijani, Russian and English; +994 phone-number accounts; mobile-friendly layout

## Run it
Requires **Node.js 22.13+** (uses the built-in `node:sqlite`).

```bash
npm install
```
```bash
npm run seed    # optional demo data
```
```bash
npm start       # http://localhost:3000
```
```bash
npm test
```

Demo accounts after seeding:
- Admin: `050 000 00 00` / `admin123`
- User: `050 111 22 33` / `demo123` (other demo users: `055 222 33 44`, `070 333 44 55`, `077 444 55 66`, `099 555 66 77`)

Environment variables: `PORT` (default 3000), `DATA_DIR` (default `./data`: SQLite file and uploads),
`NODE_ENV=production` (secure cookies), `TRUST_PROXY` (when behind nginx and similar proxies).

## Structure
```
src/raffle.js   business rules: listing, tickets, escrow, draw, refunds, payouts, commission
src/auth.js     phone/password accounts, sessions
src/db.js       SQLite schema (money stored in qəpik)
src/server.js   Express API + static frontend + 30s scheduler (draws/refunds/auto-release)
src/seed.js     demo data
public/         single-page frontend (vanilla JS, no build step), i18n.js has AZ/RU/EN
test/           node:test suite for the raffle rules
```

## Not production-ready yet
- **Payments are simulated** ("Top up" adds balance). Integrate a licensed provider (Epoint, GoldenPay, Azericard, bank escrow).
- No SMS verification yet.
- **Get legal advice** on lottery/raffle regulation in Azerbaijan before launch (see docs/ANALYSIS.md §4).
