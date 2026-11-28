'use strict';

function setBoundedCache(cache, key, value, maxEntries) {
  if (!(cache instanceof Map)) throw new TypeError('cache must be a Map');
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 1));
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}

module.exports = { setBoundedCache };
