# Deploying Bəxtim.az on your own domain

Time needed: about 30 minutes. Cost: about €5–6 a month for the server (the HTTPS certificate is free).

The site needs a server that **stays on all the time**, because it keeps its database and photos on disk and runs
a timer that performs draws and refunds. Static hosts such as Netlify, Vercel or GitHub Pages will **not** work.

```
Visitor ──https──▶ your domain ──DNS──▶ your server: Caddy (HTTPS) ──▶ Node.js app ──▶ SQLite + photos
```

## Step 1. Rent a small server (VPS)
Any provider with **Ubuntu 24.04** works. Pick the location closest to Azerbaijan:

| Provider | Plan | Price |
|---|---|---|
| Hetzner Cloud | CX22 (2 CPU, 4 GB) | ~€4–5/month |
| DigitalOcean | Basic Droplet 1 GB, Frankfurt | ~$6/month |
| A local Azerbaijani host | Any VPS with Ubuntu | varies |

> Azerbaijan's personal-data law may require storing citizens' data locally. Ask your lawyer while you're checking
> the raffle rules (see ANALYSIS.md §4). If it does, choose a local Azerbaijani VPS; the steps below are the same.

When creating the server, add your SSH key (or set a root password). Write down the server's **IP address**.

## Step 2. Point the domain at the server (DNS)
In your domain registrar's control panel, open **DNS settings** and add two records:

| Type | Name / Host | Value |
|---|---|---|
| A | `@` (the domain itself) | your server IP |
| A | `www` | your server IP |

Delete any other A records for `@` or `www` (for example a "parking page"). Changes take from a few minutes to a
few hours. To check, run `ping yourdomain.az` from your computer; it should show your server's IP.

## Step 3. Put the code on the server
Connect from your computer (Terminal on Mac/Linux, PowerShell on Windows):

```bash
ssh root@YOUR_SERVER_IP
```

Then download the code. The site currently lives on the branch `claude/elegant-bohr-gdj7an`:

```bash
git clone -b claude/elegant-bohr-gdj7an https://github.com/ngallaj/claude.git bextim
```

If the repository is private, GitHub will ask for a username and password. Use your GitHub username and a
**personal access token** (GitHub → Settings → Developer settings → Personal access tokens) as the password.

## Step 4. Run the installer
Replace the domain and e-mail with yours (the e-mail is used for certificate expiry notices only):

```bash
cd bextim && sudo bash deploy/install.sh yourdomain.az you@example.com
```

It installs Node.js 22 and Caddy, starts the site as a background service that restarts automatically, gets the
HTTPS certificate, sets up a daily backup and turns on the firewall. At the end it prints
`Done! Open https://yourdomain.az`.

## Step 5. Make yourself the admin
1. Open your site, click **Qeydiyyat** (Sign up) and register with your own phone number.
2. On the server, run (with your number):

```bash
sudo -u bextim DATA_DIR=/var/lib/bextim node /opt/bextim/src/make-admin.js 0501234567
```

3. Log out and back in: the **Admin** link appears. The commission (0% now, 10% later) is set there.

Do **not** run `npm run seed` on the live server: it creates demo users with public passwords.

## Updating the site later
```bash
cd ~/bextim && git pull && sudo bash deploy/install.sh yourdomain.az you@example.com
```
Data and photos live in `/var/lib/bextim` and are never touched by updates.

## Useful commands
| What | Command |
|---|---|
| Is the site running? | `systemctl status bextim` |
| See the app's log | `journalctl -u bextim -n 100` |
| Restart the app | `sudo systemctl restart bextim` |
| HTTPS / Caddy log | `journalctl -u caddy -n 100` |
| Backups (last 14 days) | `ls /var/backups/bextim` |

**Restoring a backup:** `sudo systemctl stop bextim`, then copy a file over the database
(`sudo cp /var/backups/bextim/bextim-2026-11-01.db /var/lib/bextim/bextim.db`), delete the `-wal`/`-shm` files next
to it, `sudo chown bextim:bextim /var/lib/bextim/*` and `sudo systemctl start bextim`.
Also copy backups off the server now and then (for example `scp` to your computer) in case the server itself is lost.

## Alternative: a hosting platform instead of a VPS
The repository has a `Dockerfile`, so it also runs on platforms like **Railway**, **Fly.io** or **Render**: create
an app from the GitHub repo, **attach a persistent volume mounted at `/data`** (without it, all data is wiped on
every deploy), then add your domain in the platform's settings and create the DNS record it shows you. These cost a
little more (~$5–20/month), but you don't manage a server.

## ⚠️ Before taking real money
The site works, but it is still an MVP:
- **Payments are simulated.** "Balansı artır" (Top up) adds money for free, so anyone can buy tickets with fake
  balance. Launch publicly only as a test/beta until a real payment provider is connected (Epoint, GoldenPay,
  Azericard or a bank).
- **No SMS verification** of phone numbers yet.
- **Get legal advice** on raffle regulation in Azerbaijan first (see ANALYSIS.md §4).
