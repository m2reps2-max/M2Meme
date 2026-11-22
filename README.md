# MEME RADAR V2 — Solana intelligence scanner

A private, read-only meme-coin research dashboard. V2 adds a live discovery pipeline, token ranking with coverage, token detail analysis, optional security checks, optional watched-wallet activity, optional X mention lookup, watchlist, alert history, and Telegram notifications. **No automatic trading or transaction signing is implemented.**

## What is live and what needs a key

| Provider | Role | Key required |
|---|---|---|
| DexScreener | Public latest token profiles, boosted tokens, pair/price/liquidity/volume/transaction data | No |
| PumpPortal | WebSocket stream for newly created Pump.fun tokens | Yes (`PUMPPORTAL_API_KEY`) |
| Birdeye | Token security observations, authority flags and holder concentration | Yes (`BIRDEYE_API_KEY`) |
| Helius | Recent transaction history for wallets added to Smart Money watchlist | Yes (`HELIUS_API_KEY`) |
| X API | On-demand recent public mentions for a token symbol | Yes (`X_BEARER_TOKEN`) |
| Telegram | Alerts to a private chat or channel | `BOT_TOKEN` + `TELEGRAM_CHAT_ID` |

DexScreener's public latest-profile/boost feeds are not a complete index of every new token. PumpPortal is the new-token launch stream in this implementation. If no PumpPortal key is configured, discovery is limited to tokens visible in DexScreener's latest profiles/boost lists. API coverage, provider limits and delays apply.

## Scoring and risk

The score is calculated only from available inputs, with a visible coverage percentage. Weights: social mentions 20, on-chain activity 20, market/liquidity 15, watched-wallet activity 15, narrative 10, security 15, timing 5. Unknown inputs are omitted from the denominator; they are never silently treated as safe or positive. A token with insufficient coverage has low confidence. The security provider's observations are not an independent audit, and no score predicts price performance. A freeze authority observation or very high top-holder concentration can hard-block a candidate from the opportunity list.

The wallet module monitors only addresses you add. It does not automatically know which wallets are profitable. X mention lookup searches a token symbol, so homonyms and ticker collisions are possible. Social and wallet data are signals, not proof.

## FadeHost deployment

1. Upload the repository files to the app directory or connect the GitHub repository.
2. Use Node.js 20 or newer.
3. Set the variables from `.env.example` in the FadeHost panel. Never paste API keys into GitHub or dashboard code.
4. Set a strong `DASHBOARD_ACCESS_CODE` (12+ characters).
5. Generate `DASHBOARD_SESSION_SECRET` once with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`; keep it stable across restarts.
6. Set `DASHBOARD_URL` to the public HTTPS dashboard URL and `NODE_ENV=production`.
7. Install with `npm install`, then run `npm start`.
8. The scanner creates `data/store.json` automatically. Ensure FadeHost preserves the app's `data/` directory across restarts and deployments.

## Telegram

Set `BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Commands: `/start`, `/dashboard`, `/scan`, `/opportunities`, `/help`. The bot sends qualifying alerts to the configured chat. Use the Telegram test action from the dashboard Settings page to test delivery.

## Dashboard access

One shared access code. It is verified server-side and is not exposed to the browser. A signed HttpOnly cookie has a 10-year browser lifetime and no server-side idle timeout. Sessions survive restarts if `DASHBOARD_SESSION_SECRET` stays unchanged. A browser can still clear cookies. Changing the access code or session secret invalidates existing sessions.

## Important limitations

- This is an analytics and alerting tool only. No private keys, swap execution, automatic buying or selling, or trade signing.
- DexScreener's latest feeds are discovery sources, not every launch on Solana.
- PumpPortal, Birdeye, Helius and X features stay unavailable until their respective keys are configured in FadeHost.
- Birdeye's risk fields are provider-reported observations. Unknown values remain unknown; LP locks and sellability are not independently proven.
- Smart Money is a watchlist of wallets chosen by the user, not a curated profitable-wallet database.
- Social mentions are symbol searches and can contain unrelated projects.
- The scanner stores data locally in `data/store.json`; use persistent storage/backups on the host.
