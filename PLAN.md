# OLED//HUNT: plan & wireframe

A small Tweakers-style price tracker for one TV: the **LG OLED 83" G4, G5 and G6**, Dutch market only.
It is free to run, works as an iPhone home-screen app, and sends a push notification every day at 12:00.

---

## 1. Goals

| # | Requirement | How |
|---|-------------|-----|
| 1 | No costs | GitHub Actions (scraper) + GitHub Pages (hosting). Both are free. No servers and no paid APIs. |
| 2 | Runs on iPhone | Installable PWA: Safari → Share → *Add to Home Screen*. Standalone, safe-area aware, works offline. |
| 3 | Daily search at 12:00 | A GitHub Actions cron runs at 10:00 and 11:00 UTC. The script only continues when it is 12:00 in `Europe/Amsterdam`, so the time stays right across DST. |
| 4 | Search on request | The **SCAN** button calls `workflow_dispatch` through the GitHub API with your own token, then streams the run status live. |
| 5 | All shops + refurbished / tweedekans | Store adapters, generic JSON-LD extraction, DuckDuckGo discovery for shops we don't know about, and the Marktplaats API for second-hand listings. |
| 6 | Push at noon | Web Push (VAPID) straight to the installed PWA (iOS 16.4+). Optional fallback: the free **ntfy.sh** app. |
| 7 | Price graph for all 3 TVs | `history.json` stores the daily lowest price per model (new and 2nd-chance). A custom neon SVG chart shows it with touch scrubbing. |
| 8 | Futuristic look + 3D TV | three.js 3D model of the ultra-thin G-series panel. Drag to rotate, pinch to zoom, animated OLED screen. Neon glow and a scanline UI. |

## 2. Architecture

```
                ┌────────────────────── GitHub (free) ───────────────────────┐
 cron 12:00 ──► │  Actions: scrape.yml                                        │
 SCAN button ─► │   1. node scraper/run.mjs                                   │
 (API dispatch) │      ├─ store adapters (Coolblue, MediaMarkt, bol, …)       │
                │      ├─ generic JSON-LD / microdata price extractor         │
                │      ├─ DuckDuckGo discovery  → new shop URLs               │
                │      ├─ Marktplaats API       → 2nd-hand listings           │
                │      └─ Playwright fallback for bot-protected pages         │
                │   2. write data/deals.json + data/history.json, commit      │
                │   3. send Web Push (+ ntfy) with today's best deals         │
                │   4. deploy app/ + data/ to GitHub Pages                    │
                └──────────────────────────────┬──────────────────────────────┘
                                               │ https://<user>.github.io/<repo>/
                                     ┌─────────▼──────────┐
                                     │  iPhone PWA        │
                                     │  • 3D TV (three.js)│
                                     │  • deals list      │
                                     │  • neon chart      │
                                     │  • service worker  │◄── Web Push at 12:00
                                     └────────────────────┘
```

**Secrets never live in the code.**
- Your GitHub token is stored only on your phone (inside the installed app).
- The VAPID keys and push subscriptions are stored as private repository *variables*.
- The app sets these up itself once you paste a token, so setup can be done entirely from the phone.

## 3. Sources (Dutch market)

| Type | Sources |
|------|---------|
| Big retail | Coolblue, MediaMarkt, bol.com, Amazon.nl, LG.com/nl, Expert, EP, BCC |
| TV specialists | HelloTV, Plasmavisie, Van Hunen, TVSpecialisten, Art & Craft, Ovitshop |
| Aggregators | Tweakers Pricewatch, Knibble, TVPedia, Kieskeurig, Vergelijk.nl |
| 2nd chance | Coolblue Tweedekans, MediaMarkt outlet/refurbished, bol tweedekans, Marktplaats |
| Discovery | DuckDuckGo for each model code, restricted to `.nl` shops |

Model codes it matches:
- **G4**: `OLED83G45LW`, `OLED83G44LW`, `OLED83G48LW`
- **G5**: `OLED83G55LW`, `OLED83G54LW`, `OLED83G56LW`
- **G6**: `OLED83G68LW`, `OLED83G67LW`, `OLED83G65LW`

Accessories (wall mounts, stands, remotes) and other sizes are filtered out. Prices outside a sane range are dropped.

## 4. Data model

```jsonc
// data/deals.json
{
  "generatedAt": "2026-09-23T10:00:12Z",
  "trigger": "schedule|manual",
  "models": { "G6": { "name": "LG OLED evo G6 83\"", "year": 2026, "codes": ["OLED83G68LW"] } },
  "offers": [
    { "id": "coolblue:G6:new", "model": "G6", "shop": "Coolblue", "title": "...",
      "price": 4999, "oldPrice": 5299, "condition": "new|refurbished|used",
      "url": "...", "inStock": true, "source": "jsonld", "firstSeen": "...", "lastSeen": "..." }
  ],
  "best": { "G6": { "new": {...offer}, "second": {...offer} } },
  "sources": [ { "name": "Coolblue", "ok": true, "found": 3, "ms": 812 } ]
}
// data/history.json   one point per day per model
{ "G6": [ { "d": "2026-09-23", "new": 4999, "second": 4299, "shop": "Coolblue" } ] }
```

## 5. Wireframe (iPhone, portrait)

```
┌───────────────────────────────────────┐
│ ▓ status bar (safe-area)              │
│ OLED//HUNT          ● LIVE  ⚙         │ ← glowing logo, sync dot, settings
│ last scan 12:00 · 14 shops · 23 deals │
├───────────────────────────────────────┤
│                                       │
│      ╔═══════════════════════╗        │
│      ║  ~~ animated OLED ~~  ║        │ ← interactive 3D TV (three.js)
│      ║   €4.299  G5 83"      ║        │   drag = rotate · pinch = zoom
│      ╚═══════════════════════╝        │   the screen shows the best price
│        ⟲ drag to rotate               │
├───────────────────────────────────────┤
│ [  G4  ] [  G5  ] [  G6  ] [ ALL ]    │ ← neon segmented control
├───────────────────────────────────────┤
│ ┌── BEST NOW ─────────────────────┐   │
│ │ G5 · Coolblue       €4.299 ▼7%  │   │ ← hero card, pulsing border
│ │ NEW · in stock      [ OPEN ↗ ]  │   │
│ └─────────────────────────────────┘   │
│ ┌ G4 ┐ ┌ G5 ┐ ┌ G6 ┐                 │ ← per-model tiles: lowest new /
│ │3.6k│ │4.3k│ │5.1k│                 │   lowest 2nd-chance
│ └────┘ └────┘ └────┘                 │
├───────────────────────────────────────┤
│ PRICE HISTORY      [30D][90D][ALL]    │
│   ╭─╮      G4 ── cyan                 │ ← neon SVG lines, touch scrub
│ ──╯ ╰──╮   G5 ── magenta              │   tooltip on drag
│        ╰── G6 ── lime                 │
├───────────────────────────────────────┤
│ DEALS            sort: price ▾        │
│ [New] [2nd chance] [Used]             │ ← filter chips
│ ▸ Coolblue      G5 NEW      €4.299 ↗  │
│ ▸ MediaMarkt    G5 NEW      €4.499 ↗  │
│ ▸ Coolblue 2nd  G4 TWEEDEK. €3.349 ↗  │
│ ▸ Marktplaats   G4 USED     €2.750 ↗  │
│   …                                   │
├───────────────────────────────────────┤
│ SOURCES  ●●●●○●●●  12/14 OK           │ ← source health, expandable
└───────────────────────────────────────┘
          ┌──────────────────┐
          │  ⟳  SCAN NOW     │ ← floating neon button (thumb zone)
          └──────────────────┘            shows progress ring while running

SETTINGS sheet (slides up):
  • Notifications  [Enable push]   status: ✓ subscribed
  • Alert me when price below  [ €4.000 ]
  • GitHub link: repo zakji/TV · token [••••••] [Test]
  • ntfy topic (optional)
  • Install help (Add to Home Screen steps)
```

UX notes, collected from Reddit (r/PWA, r/webdev, r/iOSProgramming) and PWA template repos such as `magicbell-io/webpush-ios-template`:
- iOS only allows push in the **installed** home-screen app. Notification permission has to be requested from a tap, never on load. The app shows an install hint when it is running in Safari.
- Use `viewport-fit=cover` and `env(safe-area-inset-*)`, and keep primary actions in the bottom thumb zone.
- Always call `event.waitUntil(showNotification…)` in the service worker, or iOS revokes the subscription.
- Respect `prefers-reduced-motion`: the 3D view stops auto-rotating and animations are dimmed.
- Use big tap targets (≥44 px) and haptic-like micro-animations on press.
- Cache the app shell offline and use stale-while-revalidate for the data.

## 6. Build steps
1. Scraper (`scraper/`): fetch → extract → normalise → dedupe → history → push.
2. PWA (`app/`): shell, 3D TV, cards, chart, deal list, settings, service worker, manifest, icons.
3. Workflows: `scrape.yml` (cron + manual + deploy) and `pages.yml` (deploy on app change).
4. Test locally with headless Chromium at iPhone 15 size, then push.

## 7. Limits (honest)
- Shops change their HTML and some block bots. Each source reports its own health in the app, so breakage is visible and not silent.
- GitHub cron can start 5–20 minutes late at busy times.
- GitHub Pages on a **private** repo needs a paid plan. Make the repo public; it contains no secrets. Alternatively, connect it to Cloudflare Pages for free.
