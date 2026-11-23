# MEME RADAR — Cloudflare edge discovery

This is a separate, low-memory discovery service. It does not replace the Node.js scanner, Express dashboard, or Telegram bot running on FadeHost.

## What it does
- Runs every five minutes using a Cloudflare Cron Trigger.
- Reads up to 100 latest Solana pools from GeckoTerminal's public API.
- Stores discovered base-token mints and basic market snapshots in Cloudflare D1.
- Exposes an authenticated JSON API so FadeHost can later import candidates.
- Does not score tokens, send Telegram alerts, trade, or modify FadeHost data.

## Cloudflare resources
1. Create a D1 database named m2meme-discovery.
2. Copy its database ID into wrangler.jsonc, replacing REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID.
3. Create a Worker secret named API_TOKEN. Use a random secret of at least 32 characters. Never commit it to GitHub.
4. Apply the D1 migration:
   npx wrangler@4 d1 migrations apply m2meme-discovery --remote --config cloudflare/wrangler.jsonc
5. Deploy:
   npx wrangler@4 deploy --config cloudflare/wrangler.jsonc

For Cloudflare Git integration, set the deploy command to:
npx wrangler@4 deploy --config cloudflare/wrangler.jsonc

Leave the build command empty. The D1 database must exist and its ID must be filled in before deployment.

## API
- GET /health — public liveness check; does not access D1.
- GET /v1/status — bearer-authenticated scan status and token count.
- GET /v1/candidates?limit=50 — bearer-authenticated latest discovered tokens (maximum 100).
- POST /v1/scan — bearer-authenticated manual discovery run.

Send Authorization: Bearer <API_TOKEN> for all routes except /health.

## Important limitations
- This is discovery and external storage only, not a replacement for MEME RADAR's full scanner.
- GeckoTerminal's public API can rate-limit or change its response. Failures are recorded in scan_runs.
- The current implementation stores one record per mint and refreshes its latest observed pool/market fields. It is not a full historical candle database.
- FadeHost is not connected yet. A later integration must import these candidates idempotently and must not create a second scanner or Telegram polling process.
- Do not deploy until the D1 database ID and API_TOKEN secret are configured.
