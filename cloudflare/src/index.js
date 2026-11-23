const GECKO_URL = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function authorized(request, env) {
  const expected = String(env.API_TOKEN || "");
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function tokenAddress(pool) {
  const relationship = pool?.relationships?.base_token?.data?.id;
  if (typeof relationship === "string" && relationship.startsWith("solana_")) return relationship.slice(7);
  const address = pool?.attributes?.base_token_address || pool?.attributes?.token_address;
  return typeof address === "string" ? address : "";
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function discover(env) {
  const response = await fetch(GECKO_URL, {
    headers: { accept: "application/json", "user-agent": "M2Meme-Cloudflare-Discovery/1.0" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error("GeckoTerminal HTTP " + response.status);
  const payload = await response.json();
  const pools = Array.isArray(payload?.data) ? payload.data.slice(0, 100) : [];
  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  for (const pool of pools) {
    const address = tokenAddress(pool);
    if (!address || address.length < 32 || address.length > 64) {
      skipped++;
      continue;
    }
    const attrs = pool.attributes || {};
    const poolAddress = String(attrs.address || pool.id || "").slice(0, 100);
    const name = String(attrs.name || "").slice(0, 160);
    const price = numeric(attrs.base_token_price_usd);
    const reserve = numeric(attrs.reserve_in_usd);
    const volume24h = numeric(attrs.volume_usd?.h24);
    const result = await env.DB.prepare(
      "INSERT INTO discovered_tokens (mint, pool_address, name, price_usd, liquidity_usd, volume_24h_usd, first_seen_at, last_seen_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'geckoterminal') ON CONFLICT(mint) DO UPDATE SET pool_address = excluded.pool_address, name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE discovered_tokens.name END, price_usd = COALESCE(excluded.price_usd, discovered_tokens.price_usd), liquidity_usd = COALESCE(excluded.liquidity_usd, discovered_tokens.liquidity_usd), volume_24h_usd = COALESCE(excluded.volume_24h_usd, discovered_tokens.volume_24h_usd), last_seen_at = excluded.last_seen_at"
    ).bind(address, poolAddress, name, price, reserve, volume24h, now, now).run();
    if (result.meta?.changes === 1) inserted++;
  }

  await env.DB.prepare(
    "INSERT INTO scan_runs (ran_at, source, pools_received, inserted_count, skipped_count, status) VALUES (?, 'geckoterminal', ?, ?, ?, 'ok')"
  ).bind(now, pools.length, inserted, skipped).run();

  return { ok: true, ranAt: now, poolsReceived: pools.length, inserted, skipped };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "m2meme-cloudflare-discovery", timestamp: new Date().toISOString() });
  }
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);

  if (request.method === "GET" && url.pathname === "/v1/status") {
    const latest = await env.DB.prepare("SELECT ran_at, pools_received, inserted_count, skipped_count, status FROM scan_runs ORDER BY id DESC LIMIT 1").first();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM discovered_tokens").first();
    return json({ ok: true, totalDiscovered: count?.total || 0, latestScan: latest || null });
  }

  if (request.method === "GET" && url.pathname === "/v1/candidates") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const rows = await env.DB.prepare("SELECT mint, pool_address AS poolAddress, name, price_usd AS priceUsd, liquidity_usd AS liquidityUsd, volume_24h_usd AS volume24hUsd, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, source FROM discovered_tokens ORDER BY last_seen_at DESC LIMIT ?").bind(limit).all();
    return json({ ok: true, count: rows.results?.length || 0, candidates: rows.results || [] });
  }

  if (request.method === "POST" && url.pathname === "/v1/scan") {
    try {
      return json(await discover(env));
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      await env.DB.prepare("INSERT INTO scan_runs (ran_at, source, pools_received, inserted_count, skipped_count, status, error) VALUES (?, 'geckoterminal', 0, 0, 0, 'error', ?)").bind(new Date().toISOString(), message).run();
      return json({ ok: false, error: message }, 502);
    }
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({ error: "Internal error", detail: String(error?.message || error).slice(0, 200) }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(discover(env).catch(async error => {
      const message = String(error?.message || error).slice(0, 300);
      await env.DB.prepare("INSERT INTO scan_runs (ran_at, source, pools_received, inserted_count, skipped_count, status, error) VALUES (?, 'geckoterminal', 0, 0, 0, 'error', ?)").bind(new Date().toISOString(), message).run();
      console.error("[scheduled discovery]", message);
    }));
  }
};
