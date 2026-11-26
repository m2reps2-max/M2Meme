'use strict';

const MAX_MARKET_FIELD_AGE_MS = 15 * 60 * 1000;

function marketFieldFresh(token, key, now = Date.now(), maxAgeMs = MAX_MARKET_FIELD_AGE_MS) {
  const value = token?.marketFieldsObservedAt?.[key];
  const at = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= maxAgeMs;
}

function freshMarketView(token, now = Date.now()) {
  const fresh = (key, value) => marketFieldFresh(token, key, now) ? value : null;
  return {
    ...token,
    volume: {
      ...(token?.volume || {}),
      m5: fresh('volumeM5', token?.volume?.m5),
      h1: fresh('volumeH1', token?.volume?.h1),
      h24: fresh('volumeH24', token?.volume?.h24)
    },
    txns: {
      ...(token?.txns || {}),
      m5: fresh('txnsM5', token?.txns?.m5),
      h1: fresh('txnsH1', token?.txns?.h1),
      h24: fresh('txnsH24', token?.txns?.h24)
    },
    priceChange: {
      ...(token?.priceChange || {}),
      m5: fresh('priceChangeM5', token?.priceChange?.m5),
      h1: fresh('priceChangeH1', token?.priceChange?.h1),
      h24: fresh('priceChangeH24', token?.priceChange?.h24)
    }
  };
}

module.exports = { marketFieldFresh, freshMarketView, MAX_MARKET_FIELD_AGE_MS };
