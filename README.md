# MEME RADAR

Private, mobile-friendly dashboard shell and Telegram entry bot for researching early meme-coin opportunities. **This V1 is an authenticated dashboard foundation, not a live market scanner and not a trading bot.** No token data, scores, wallet intelligence, or alerts are fabricated.

## Requirements
- Node.js 20+
- HTTPS in production
- A Telegram bot token is optional

## Deploy on FadeHost
1. Upload the repository files to the app directory.
2. Set the environment variables from `.env.example` in the FadeHost panel.
3. Set `DASHBOARD_ACCESS_CODE` to the shared access code you want users to enter.
4. Generate `DASHBOARD_SESSION_SECRET` once with:
   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   Keep this value stable across restarts. Do not commit it.
5. Set `DASHBOARD_URL` to the public HTTPS URL of the dashboard.
6. Install dependencies with `npm install`, then start with `npm start`.

## Telegram
Set `BOT_TOKEN`. The bot responds to `/start`, `/dashboard`, and `/help` with a link to the dashboard. Configure the bot's public username in Telegram separately.

## Access and sessions
- One shared access code is used by all users.
- The code is checked server-side and is never sent to dashboard JavaScript.
- Successful login sets a signed, HttpOnly, SameSite=Strict cookie with a 10-year browser lifetime and no server-side idle timeout.
- Sessions survive app restarts as long as `DASHBOARD_SESSION_SECRET` remains unchanged.
- Changing `DASHBOARD_ACCESS_CODE` invalidates existing sessions on the next request.
- Changing `DASHBOARD_SESSION_SECRET` also invalidates sessions.
- A browser can still clear cookies; no website can guarantee a session survives cookie deletion or device/browser resets.
- Login attempts are rate-limited per IP in memory; counters reset when the process restarts.
- HTTPS is required in production so the session cookie can be Secure.

## Current V1 scope
Included: private login, persistent signed session, protected dashboard/API, Telegram entry bot, responsive dashboard navigation, health endpoint.
Not included yet: live chain ingestion, token discovery, on-chain scoring, holder analysis, wallet clustering, rug-pull/security provider integration, social listening, notifications, or automatic trading. Sections marked "à connecter" are placeholders, not live data.

## Security
Use a long random access code and session secret. Never share either in source code, screenshots, or GitHub. A shared code cannot identify individual users; anyone who knows it can access the dashboard. Add a reverse proxy/WAF and persistent rate-limit storage before opening access widely.
