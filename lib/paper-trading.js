'use strict';

const MAX_POSITIONS = 5;
const MAX_TRADES = 200;
const SLOT_USD = 100;
const ENTRY_SLIPPAGE = 0.005;
const EXIT_SLIPPAGE = 0.005;
const FEE_RATE = 0.003;
const STOP_LOSS_PCT = -25;
const TAKE_PROFIT_PCT = 60;
const MAX_HOLD_MS = 24 * 60 * 60 * 1000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function isoTime(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function ensureBook(state) {
  if (!state.paperTrading || typeof state.paperTrading !== 'object' || Array.isArray(state.paperTrading)) {
    state.paperTrading = { enabled: true, initialCapitalUsd: 1000, cashUsd: 1000, positions: [], trades: [], createdAt: new Date().toISOString() };
  }
  const book = state.paperTrading;
  book.enabled = book.enabled !== false;
  book.initialCapitalUsd = Math.max(100, number(book.initialCapitalUsd) || 1000);
  book.cashUsd = Math.max(0, number(book.cashUsd) ?? book.initialCapitalUsd);
  book.positions = Array.isArray(book.positions) ? book.positions.slice(-MAX_POSITIONS) : [];
  book.trades = Array.isArray(book.trades) ? book.trades.slice(-MAX_TRADES) : [];
  return book;
}
function latestPrice(token) {
  const history = Array.isArray(token?.history) ? token.history : [];
  const latest = history.length ? history[history.length - 1] : null;
  const price = number(latest?.priceUsd) ?? number(token?.priceUsd);
  const at = isoTime(latest?.at || token?.updatedAt);
  return price > 0 && at ? { price, at, atMs: Date.parse(at) } : null;
}
function closePosition(book, position, market, now, reason) {
  const exitPrice = market.price * (1 - EXIT_SLIPPAGE);
  const gross = position.quantity * exitPrice;
  const exitFee = gross * FEE_RATE;
  const proceeds = gross - exitFee;
  const pnlUsd = proceeds - position.costUsd;
  const pnlPct = position.costUsd > 0 ? pnlUsd / position.costUsd * 100 : 0;
  book.cashUsd += proceeds;
  book.trades.push({
    mint: position.mint, symbol: position.symbol, name: position.name,
    openedAt: position.openedAt, closedAt: new Date(now).toISOString(),
    entryPrice: position.entryPrice, exitPrice, notionalUsd: position.notionalUsd,
    costUsd: position.costUsd, proceedsUsd: proceeds,
    pnlUsd: Number(pnlUsd.toFixed(4)), pnlPct: Number(pnlPct.toFixed(3)),
    reason, feesUsd: Number((position.entryFeeUsd + exitFee).toFixed(4))
  });
  if (book.trades.length > MAX_TRADES) book.trades.splice(0, book.trades.length - MAX_TRADES);
}
function stepPaperTrading(state, selection, now = Date.now()) {
  const book = ensureBook(state);
  if (!book.enabled) return summary(book, now, 'paused');
  const tokens = state.tokens && typeof state.tokens === 'object' ? state.tokens : {};
  const prices = new Map();
  for (const token of Object.values(tokens)) {
    if (!token?.mint) continue;
    const market = latestPrice(token);
    if (market) prices.set(token.mint, market);
  }

  const stillOpen = [];
  for (const position of book.positions) {
    const market = prices.get(position.mint);
    if (!market || market.atMs > now + 60000 || now - market.atMs > 15 * 60 * 1000) {
      stillOpen.push(position);
      continue;
    }
    const markReturnPct = (market.price / position.entryPrice - 1) * 100;
    const ageMs = now - Date.parse(position.openedAt);
    const reason = markReturnPct <= STOP_LOSS_PCT ? 'stop_loss'
      : markReturnPct >= TAKE_PROFIT_PCT ? 'take_profit'
      : ageMs >= MAX_HOLD_MS ? 'time_limit' : null;
    if (reason) closePosition(book, position, market, now, reason);
    else {
      position.markPrice = market.price;
      position.markReturnPct = Number(markReturnPct.toFixed(3));
      position.lastMarkedAt = market.at;
      stillOpen.push(position);
    }
  }
  book.positions = stillOpen;

  const openMints = new Set(book.positions.map(position => position.mint));
  const candidates = Array.isArray(selection?.best) ? selection.best : [];
  for (const candidate of candidates) {
    if (book.positions.length >= MAX_POSITIONS) break;
    if (!candidate?.mint || openMints.has(candidate.mint)) continue;
    const market = prices.get(candidate.mint);
    const token = tokens[candidate.mint];
    const jupiter = token?.jupiterPrice;
    const jupiterAt = Date.parse(jupiter?.checkedAt || '');
    if (!market || market.atMs > now + 60000 || now - market.atMs > 5 * 60 * 1000) continue;
    if (!Number.isFinite(jupiterAt) || now - jupiterAt > 5 * 60 * 1000 || !Number.isFinite(Number(jupiter?.priceUsd)) || Number(jupiter.priceUsd) <= 0) continue;
    if (Number.isFinite(Number(jupiter.divergencePct)) && Math.abs(Number(jupiter.divergencePct)) > 15) continue;
    const notionalUsd = Math.min(SLOT_USD, book.cashUsd / (1 + FEE_RATE));
    if (notionalUsd < 10) break;
    const entryPrice = market.price * (1 + ENTRY_SLIPPAGE);
    const quantity = notionalUsd / entryPrice;
    const entryFeeUsd = notionalUsd * FEE_RATE;
    const costUsd = notionalUsd + entryFeeUsd;
    if (costUsd > book.cashUsd) continue;
    book.cashUsd -= costUsd;
    book.positions.push({
      mint: candidate.mint, symbol: String(candidate.symbol || '').slice(0, 24),
      name: String(candidate.name || '').slice(0, 64), openedAt: new Date(now).toISOString(),
      sourceMarketAt: market.at, referencePrice: market.price, entryPrice,
      quantity, notionalUsd, entryFeeUsd, costUsd, markPrice: market.price,
      markReturnPct: Number(((market.price / entryPrice - 1) * 100).toFixed(3))
    });
    openMints.add(candidate.mint);
  }
  book.updatedAt = new Date(now).toISOString();
  return summary(book, now, 'active');
}
function summary(book, now, status) {
  const unrealizedUsd = book.positions.reduce((sum, position) => {
    const price = number(position.markPrice) || position.entryPrice;
    return sum + position.quantity * price * (1 - EXIT_SLIPPAGE) * (1 - FEE_RATE) - position.costUsd;
  }, 0);
  const realizedUsd = book.trades.reduce((sum, trade) => sum + (number(trade.pnlUsd) || 0), 0);
  const equityUsd = book.cashUsd + book.positions.reduce((sum, position) => sum + position.quantity * (number(position.markPrice) || position.entryPrice) * (1 - EXIT_SLIPPAGE) * (1 - FEE_RATE), 0);
  return {
    status, enabled: book.enabled, generatedAt: new Date(now).toISOString(),
    initialCapitalUsd: Number(book.initialCapitalUsd.toFixed(2)),
    cashUsd: Number(book.cashUsd.toFixed(2)), equityUsd: Number(equityUsd.toFixed(2)),
    realizedPnlUsd: Number(realizedUsd.toFixed(2)), unrealizedPnlUsd: Number(unrealizedUsd.toFixed(2)),
    totalPnlUsd: Number((realizedUsd + unrealizedUsd).toFixed(2)),
    openPositions: book.positions.length, closedTrades: book.trades.length,
    winRatePct: book.trades.length ? Number((book.trades.filter(trade => trade.pnlUsd > 0).length / book.trades.length * 100).toFixed(1)) : null,
    positions: book.positions.slice().reverse().map(position => ({ ...position })),
    recentTrades: book.trades.slice(-20).reverse().map(trade => ({ ...trade })),
    methodology: {
      entrySlippagePct: ENTRY_SLIPPAGE * 100, exitSlippagePct: EXIT_SLIPPAGE * 100,
      feePerSidePct: FEE_RATE * 100, stopLossPct: STOP_LOSS_PCT,
      takeProfitPct: TAKE_PROFIT_PCT, maxHoldingHours: 24,
      positionLimit: MAX_POSITIONS, fixedSlotUsd: SLOT_USD,
      note: 'Simulation uniquement. Les prix viennent des snapshots observés; les frais et le slippage sont des hypothèses fixes, pas des cotations exécutables.'
    }
  };
}
function getPaperTradingSummary(state, now = Date.now()) {
  const book = ensureBook(state);
  return summary(book, now, book.enabled ? 'active' : 'paused');
}\nfunction setPaperTradingEnabled(state, enabled) {
  const book = ensureBook(state);
  book.enabled = enabled === true;
  book.updatedAt = new Date().toISOString();
  return book.enabled;
}
module.exports = { stepPaperTrading, getPaperTradingSummary, setPaperTradingEnabled, ensureBook };
