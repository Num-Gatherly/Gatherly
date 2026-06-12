# Gatherly V2

Event advertising + verified engagement analytics for ER:LC roleplay servers.
One repo is the whole product: static frontend (`/public`) + serverless API (`/netlify/functions`), hosted together on Netlify with Netlify Blobs as storage. No database to set up.

---

## What's new in V2

- **Full redesign.** "Dispatch at night" theme: ink-navy surfaces, signal-blue radar accent, amber reserved for LIVE states. Clash Display + General Sans via Fontshare. Animated radar sweep on the homepage with real event blips, scroll-reveal animations, recently-completed ticker, live event counter.
- **Events end on time.** Hard 90-minute maximum, end-time preview when creating, and listings leave the discovery feed the instant they end.
- **The analytics engine.** Reports now include: Event Health Score (0-100), player lifecycle funnel (views, reveals, entries, 30-min retention), concurrency timeline rebuilt from join/leave logs, scenario benchmarking against the whole platform, attendance forecasting after 3 reported events, momentum index after 5, staff intelligence (command leaderboard, idle staff, mod-call response time), and an AI summary written by Claude.
- **Report delivery.** Bot DM (opt-in), Discord webhook fallback, plus an optional second recipient per event (Discord user ID, DM'd by the bot).
- **Banner uploads.** Drag-and-drop, enforced at exactly 1200x480px and under 2MB. Dimensions are re-validated server-side by parsing the file bytes, so the client check cannot be bypassed.
- **Admin control room.** Server-verified staff roles. Edit/reschedule/delete any event, toggle boosts, suspend users, revoke API keys, change plans, edit homepage copy live, and a full audit log of every staff action.
- **Security hardening.** Strict Content-Security-Policy (no inline scripts anywhere), HSTS, frame denial, HMAC sessions compared in constant time, AES-256-GCM key encryption, blob-backed rate limits on creation/uploads/reports/contact, honeypot fields, daily listing caps, suspended-user lockout.
- **Fixed bugs from V1.** Stripe plan names (`sergeant`/`commander`) now match the site so checkout actually fires. ER:LC keys are scrubbed of whitespace, quotes, and invisible characters before use, which was the most common cause of "broken token" reports.
- **Legal.** Comprehensive Terms of Service + Privacy Policy drafts written for Australian Consumer Law and the Australian Privacy Principles, covering Discord/Roblox/PRC platform compliance, Stripe-only card handling, and self-service data deletion. Have a solicitor review before charging real money.

## Repo map

| Folder | What it is |
|---|---|
| `public/` | The website. Each page's JS lives in `public/js/pages/` (CSP forbids inline scripts). |
| `public/css/style.css` | The entire design system. |
| `public/js/app.js` | Shared frontend: nav, radar, reveals, countdowns, API helper. |
| `public/js/report.js` | The report renderer + 1200x630 share-card export. |
| `netlify/functions/` | The API: auth, events, erlc (reports), admin, image, billing, contact, tickets. |
| `netlify/lib/util.js` | Sessions, encryption, rate limiting, audit log, stores. |
| `netlify.toml` | Routes + security headers. |

Every push to `main` auto-deploys. Edit the file you need and push.

## Setup

1. **GitHub:** create a repo, upload everything in this folder.
2. **Netlify:** Add new site → Import from GitHub → pick the repo. Build settings auto-read from `netlify.toml`. Deploy.
3. **Discord OAuth app:** at discord.com/developers create an app, OAuth2 → add redirect exactly `https://YOUR-SITE/api/auth?action=callback`, scope `identify`.
4. **Environment variables** (Netlify → Site configuration → Environment variables):

### Required

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Any long random string (40+ chars). Signs sessions and encrypts stored ER:LC keys. Changing it invalidates saved keys. |
| `SITE_URL` | Your live URL, no trailing slash. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | From your Discord OAuth app. |

### Optional

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | AI summaries on every report (uses `claude-sonnet-4-6`). |
| `EXEC_SETUP_CODE` | One-time code to claim the first executive role at `/admin`. |
| `DISCORD_BOT_TOKEN` | Bot DMs for report delivery (host + extra recipient). The recipient must share a server with the bot. |
| `STRIPE_SECRET_KEY` + `STRIPE_PRICE_SERGEANT` + `STRIPE_PRICE_COMMANDER` | Card checkout (weekly recurring Price IDs). |
| `ROBUX_GAMEPASS_SERGEANT` / `ROBUX_GAMEPASS_COMMANDER` | Robux gamepass verification. |
| `CONTACT_DISCORD_WEBHOOK` | Support form messages posted to a Discord channel. |

Until optional keys are set, those features return clear "not configured" messages instead of pretending to work.

## First admin

Set `EXEC_SETUP_CODE`, log in, open `/admin`, and enter the code to claim the executive role. Executives promote/demote admins and approve admin requests; all staff actions are audit-logged.

## Honest limitations

- ER:LC join logs are recent-history only, so reports are most accurate when generated during or shortly after the event.
- Bot DMs require the recipient to share a server with your bot and allow member DMs (a Discord platform rule, not ours).
- Stripe checkout works; automatic downgrade when a subscription lapses needs a Stripe webhook handler (roadmap).
- Rate limiting is blob-backed and coarse. For serious DDoS protection put Cloudflare in front of the Netlify domain.

## Local development

```bash
npm install
npx netlify dev   # site + functions at localhost:8888
```
