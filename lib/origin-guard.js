'use strict';

function originOf(value, requireOriginOnly = true) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') return null;
    if (parsed.username || parsed.password) return null;
    if (requireOriginOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function isTrustedDashboardRequest({ origin, fetchSite, dashboardUrl, forwardedHost, forwardedProto, host, protocol } = {}) {
  const site = String(fetchSite || '').trim().toLowerCase();
  if (site === 'cross-site') return false;

  // Modern browsers mark fetches initiated by the dashboard itself as same-origin.
  // This avoids false rejections when FadeHost rewrites the internal Host header.
  if (site === 'same-origin') return true;

  if (!origin) return true;
  const requestOrigin = originOf(origin);
  if (!requestOrigin) return false;

  const allowed = new Set();
  const configured = originOf(dashboardUrl, false);
  if (configured) allowed.add(configured);

  const proxyHost = firstHeaderValue(forwardedHost);
  const proxyProto = firstHeaderValue(forwardedProto);
  const requestHost = firstHeaderValue(proxyHost || host);
  const requestProto = firstHeaderValue(proxyProto || protocol);
  if (requestHost && requestProto) {
    const inferred = originOf(requestProto.replace(/:$/, '') + '://' + requestHost);
    if (inferred) allowed.add(inferred);
  }

  // When the proxy forwards a public host but not a protocol, compare both
  // standard schemes; the browser Origin still has to match the exact host.
  if (proxyHost && !proxyProto) {
    for (const scheme of ['https', 'http']) {
      const inferred = originOf(scheme + '://' + proxyHost);
      if (inferred) allowed.add(inferred);
    }
  }

  return allowed.has(requestOrigin);
}

module.exports = { isTrustedDashboardRequest };
