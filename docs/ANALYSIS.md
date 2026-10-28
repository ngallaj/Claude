# Püşk.az — Market analysis & product design

> Note on sources: raffall.com and tap.az could not be opened directly from the build environment (network
> policy), so this analysis combines Raffall's public help-centre articles found via search, app-store and
> company listings for Tap.az, and general knowledge of both products. Verify fee amounts and current rules on
> the sites themselves before relying on them.

## 1. Raffall.com — how it works

**What it is.** A UK platform (founded 2017) where anyone — individuals, businesses, charities — can "host" a
raffle for an item (cars, houses, tech, experiences, cash). Hosts list a prize, set a ticket price and number of
tickets; entrants buy tickets; Raffall runs the draw and handles the money.

| Area | How Raffall does it |
|---|---|
| **Listing** | Host uploads photos/description, chooses ticket price (min **£0.50**), number of tickets, end date. |
| **Legal model (UK)** | Entries are structured as **prize competitions**, not lotteries, so no Gambling Commission licence is needed. Entrants answer an (optional) **skill question**, and a **free postal entry route** exists. |
| **Minimum ticket target** | Only for "Pro" hosts. If the target is missed the draw *still happens*, but the winner receives **50% of ticket revenue in cash instead of the prize**, and the host's payout is reduced. |
| **Draw** | Automated random number generator; hosts have no control over winner selection. Draws are shown publicly. |
| **Money / escrow** | Raffall holds all funds. The host is **paid only after the winner confirms receipt** of the prize. |
| **Raffall Guarantee** | If the host fails to deliver, the winner receives **75% of ticket revenue** in cash and the host gets nothing. |
| **Fees** | Hosts keep ~**90%** of ticket revenue (≈10% platform fee), plus paid subscription tiers (Pro/Premium) and paid "invites" to promote raffles. |
| **Charity** | Optional — host can donate a share of net revenue to a chosen charity; Raffall pays the charity directly. |
| **Trust** | ID verification of hosts, reviews (Trustpilot ~31k reviews), live draw pages, winner announcements. |

**Takeaways for us:** escrow-until-delivery, automated/verifiable draws, a minimum-ticket mechanic, and a ~10%
take rate are proven. We drop the charity element and replace "winner gets 50% cash if the minimum is missed"
with the simpler rule you asked for: **minimum not reached → no draw, full refund to every buyer**.

## 2. Tap.az — what Azerbaijani users expect

Tap.az (Digital Classifieds MMC, Baku — same group as Turbo.az and Bina.az) is the country's #1 classifieds site
and the #2 shopping app on Google Play in Azerbaijan.

| Area | Tap.az pattern |
|---|---|
| **Business model** | Posting is **free** for most categories; revenue comes from paid boosts — **"İrəli çək"** (bump to top), **VIP** and **Premium** placement — plus paid packages for **shops (Mağazalar)**. |
| **Layout** | Big search bar at the top, **icon grid of categories**, dense **card grid** (photo, price in ₼, title, city, date), VIP cards highlighted. |
| **Filters** | Category → sub-category, **city**, price range, "new/used", delivery, sort by date/price. |
| **Identity** | Accounts tied to an **Azerbaijani mobile number** (+994 50/51/55/70/77/99/10/60) with SMS code. Buyers call/WhatsApp sellers directly. |
| **Languages** | **Azerbaijani (default) and Russian**. |
| **Trust gaps** | No escrow — deals happen in person, cash. Scams and "is it still available?" spam are common; that is exactly the gap a platform that holds the money can fill. |

**Takeaways for us:** copy the familiar UX (search + category icons + card grid + city filter, phone-number
login, AZ/RU languages, ₼ prices), keep listing **free**, and plan VIP/boost as a second revenue stream later.

## 3. Our concept — Püşk.az

*"Əşyanı sat — biletlərə böl — qalib aparsın"* (sell your item — split it into tickets — the winner takes it).

### Core rules (implemented)
1. **Seller lists an item** with a total price and a ticket size. `tickets = total / ticket price`
   (e.g. 12 AZN / 1 AZN = **12 tickets**). The total must divide evenly; 2–5000 tickets; min ticket 0.50 AZN.
2. **Seller sets a minimum** number of tickets (e.g. 10). Default = all tickets.
3. **Buyers pay from their wallet**; money goes into **escrow** (not to the seller).
4. **Draw happens when:**
   - all tickets are sold → instantly; or
   - the minimum is reached → the seller can press "Draw now"; or
   - the deadline passes with the minimum reached → automatically.
5. **Deadline passes below the minimum → automatic 100% refund** to every buyer.
6. **Winner gets the seller's phone**, collects the item, presses **"I received it"** → seller is paid.
   No action within 7 days → auto-release. Problem → winner opens a **dispute**, an admin pays the seller or refunds buyers.
7. **Provably fair draw:** a SHA-256 hash of a secret seed is shown from day one; after the draw the seed is revealed
   and anyone can recompute the winner in their browser (`/#/verify/:id`).
8. **Commission:** stored as a setting, **0% now**. The admin can switch it to 10% in the admin panel. The rate is
   **snapshotted per listing**, so changing it never affects raffles already running. It is deducted from the
   seller's payout (10% of the actual ticket revenue).

### What we took from each site
| From Raffall | From Tap.az |
|---|---|
| Escrow until winner confirms receipt | Phone-number accounts (+994), AZ/RU/EN |
| Automated, verifiable draw | Search bar + category icon grid + card grid |
| Minimum-ticket threshold | City filter, condition, pickup/courier |
| ~10% take rate (later) | Free listing; VIP flag ready for paid promotion |
| Disputes / delivery guarantee | ₼ prices, familiar Azerbaijani wording |

## 4. ⚠️ Legal & compliance — must check before launch

Paid-entry raffles are **legally sensitive in Azerbaijan**. Lotteries and gambling are regulated by the Law
"On Lotteries" and related legislation, and lottery operation has historically been a state-controlled activity
(Azərlotereya). A site where people pay for a *chance* to win an item may be classed as a lottery. Before launch,
get a local lawyer's opinion on:

- whether the model needs a licence or partnership, and whether a **skill question + free entry route** (Raffall's
  UK approach) would change the classification;
- **holding customer money** (wallet/escrow) — this likely needs a licensed payment partner or bank escrow rather
  than the platform holding funds itself (Central Bank of Azerbaijan rules);
- tax treatment of seller income and prizes; consumer-protection and personal-data law;
- age limit (18+), KYC (SMS OTP at minimum; consider ID verification for sellers) and AML limits.

The code keeps payment and draw logic isolated so these changes can be added without a rewrite.

## 5. Roadmap after the MVP
1. Real payments: Kapital Bank / Pasha Bank / Epoint / GoldenPay / Azericard card top-ups and payouts.
2. SMS OTP verification on registration (e.g. via a local SMS gateway).
3. Notifications (SMS / WhatsApp / e-mail) for "tickets bought", "draw done", "you won".
4. Seller ratings & reviews, verified-seller badge.
5. Monetisation: switch commission to 10%, sell VIP / "İrəli çək" boosts, shop accounts.
6. Live-streamed draws for high-value items; external randomness beacon for extra transparency.
7. Mobile apps (the API is already JSON-first).
