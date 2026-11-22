'use strict';

async function readTextLimited(response, maxBytes = 1024 * 1024) {
  const limit = Math.max(1, Number(maxBytes) || 1024 * 1024);
  const declared = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Réponse HTTP trop volumineuse (' + declared + ' octets; limite ' + limit + ')');
  const body = response?.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('Réponse HTTP supérieure à la limite de ' + limit + ' octets');
    return text;
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        throw new Error('Réponse HTTP supérieure à la limite de ' + limit + ' octets');
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function readJsonLimited(response, maxBytes = 1024 * 1024) {
  // Lightweight response doubles used by unit tests may expose only json().
  // Real Fetch responses expose a readable body and always take the bounded path.
  if ((!response?.body || typeof response.body.getReader !== 'function') && typeof response?.text !== 'function' && typeof response?.json === 'function') return response.json();
  const text = await readTextLimited(response, maxBytes);
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error('Réponse JSON invalide'); }
}

module.exports = { readTextLimited, readJsonLimited };
