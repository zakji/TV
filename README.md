# OLED//HUNT 📺⚡

A free, iPhone-installable deal finder for the **LG OLED evo 83" G4 / G5 / G6**, Dutch market only. It works like Tweakers Pricewatch, but for this one TV.

- 🔎 **Daily scan at 12:00** (Europe/Amsterdam), plus a **SCAN** button for a live scan on demand.
- 🏪 Shops: Coolblue, MediaMarkt, bol, Amazon.nl, LG.com, Expert, EP, BCC, HelloTV, Plasmavisie, Van Hunen and more.
- 🔍 Price-comparison sites: Tweakers, Knibble, TVPedia, Vergelijk.nl and Kieskeurig.
- 🔍 **Web discovery**: searches the web for shops it doesn't know yet.
- ♻️ **Second chance**: Coolblue Tweedekans, refurbished and outlet offers, plus **Marktplaats** second-hand listings.
- 📈 Neon price-history chart for all three models (new and 2nd-chance).
- 🧊 Interactive **3D TV**: drag to rotate, pinch to zoom, tap to switch model.
- 🔔 **Push notifications at 12:00** with the best deals, plus instant alerts on a new all-time low or your target price.
- 💸 **Costs nothing**: GitHub Actions + GitHub Pages. No servers, no paid APIs.

See [PLAN.md](PLAN.md) for the architecture and wireframe.

---

## One-time setup (≈5 minutes, can be done from your iPhone)

### 1. Turn on GitHub Pages
GitHub Pages is free for **public** repos; a private repo needs a paid plan. The repo contains no secrets, so the simplest option is to make it public:
**Settings → General → Danger zone → Change visibility → Public.**

Then go to **Settings → Pages → Build and deployment → Source: _GitHub Actions_**.

### 2. Run the first scan
Go to **Actions → "Scan deals" → Run workflow**. After 2–4 minutes your app is live at:

```
https://<your-username>.github.io/<repo-name>/
```

### 3. Install on your iPhone
1. Open that URL in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Open **OLED Hunt** from your home screen.

### 4. Connect GitHub (unlocks the live SCAN button and push)
1. Create a **fine-grained token** at <https://github.com/settings/personal-access-tokens/new>:
   - Repository access: *Only select repositories* → this repo
   - Permissions:
     - **Actions**: Read & write
     - **Secrets**: Read & write
     - **Variables**: Read & write
     - **Contents**: Read
2. In the installed app: ⚙ → **GitHub link** → paste the token → **Connect**.

The token is stored only on your phone.

### 5. Enable push
In the app: ⚙ → **Enable push** → Allow → **Send test**.

The app does the rest itself:
- It generates VAPID keys on your phone.
- It stores the private key as an **encrypted Actions secret**.
- It stores your subscription as a repo variable.

From then on you get the best deals every day at 12:00.

**Optional backup channel:** install the free [ntfy](https://apps.apple.com/app/ntfy/id1625396347) app, subscribe to a random topic name, and enter that topic in ⚙.

---

## How it works

```
GitHub Actions (cron 12:00 / SCAN button)
  └─ scraper/run.mjs
       ├─ known product pages     (config.mjs → PRODUCT_PAGES)
       ├─ shop search pages       (config.mjs → SEARCH_PAGES)
       ├─ Marktplaats API         (2nd hand)
       ├─ DuckDuckGo/Bing discovery → any .nl shop with schema.org prices
       ├─ generic extractor: JSON-LD → microdata → meta tags → embedded state
       ├─ headless Chrome fallback for bot-protected shops
       └─ writes data/deals.json + data/history.json, sends Web Push / ntfy
  └─ deploys app/ + data/ to GitHub Pages
```

- **Extractor:** each offer is checked for the right model (83" G4/G5/G6 codes), accessories (wall mounts, stands) are rejected, and prices outside a sane range are dropped.
- **Condition:** new, 2nd chance or used is detected from schema.org `itemCondition` and from keywords such as *tweedekans*, *refurbished*, *outlet* or *gebruikt*.
- **Source health:** every source reports its status in the app (🟢/🟡/🔴). When a shop blocks a run, its offers from the last 72 h are kept and marked *stale*.

### Add a shop or product page
Add a line to `PRODUCT_PAGES` in [`scraper/config.mjs`](scraper/config.mjs):
```js
{ url: 'https://www.someshop.nl/lg-oled83g55lw', model: 'G5' },
```
Most shops work without custom code, because they embed schema.org price data.

### Local development
```bash
cd scraper && npm install && npm test        # unit tests
node run.mjs --quick --no-notify             # quick scan (writes data/)
cd .. && npm install && npm run build        # rebuild the 3D bundle (app/tv3d.js)
node scripts/build-site.mjs && npx http-server _site
```

### Repository variables and secrets (set automatically by the app)
| Name | Type | Purpose |
|---|---|---|
| `VAPID_PRIVATE_KEY` | secret | signs Web Push messages |
| `VAPID_PUBLIC_KEY` | variable | public push key |
| `PUSH_SUBSCRIPTIONS` | variable | your device subscription(s) |
| `ALERT_BELOW` | variable | optional price alert (€) |
| `NTFY_TOPIC` | variable | optional ntfy topic |

## Limits
- Shops change their HTML and some block bots. Check the **Sources** panel; extra product URLs in `config.mjs` usually fix it.
- GitHub cron can start 5–20 minutes late at busy times.
- iOS push needs iOS 16.4+ and only works in the installed home-screen app.
