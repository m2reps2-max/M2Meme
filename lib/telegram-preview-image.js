'use strict';

const { createCanvas } = require('@napi-rs/canvas');
const { HORIZONS } = require('./telegram-performance');

const WIDTH = 1200;
const HEIGHT = 630;

function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const rounded = Number(value.toFixed(1));
  return (rounded > 0 ? '+' : '') + rounded.toFixed(1) + '%';
}

function buildTelegramPreviewMetrics(entry, now = Date.now()) {
  const publishedAt = Number(entry?.publishedAt) || 0;
  const observedAt = Number(entry?.lastCurrentObservedAt) || 0;
  const currentPrice = Number(entry?.lastCurrentPriceUsd);
  const basePrice = Number(entry?.basePriceUsd);
  const currentFresh = observedAt > 0 && observedAt <= now + 30000
    && now - observedAt <= 5 * 60 * 1000
    && Number.isFinite(currentPrice) && currentPrice > 0
    && Number.isFinite(basePrice) && basePrice > 0;
  const currentReturn = currentFresh ? (currentPrice / basePrice - 1) * 100 : null;
  const cells = HORIZONS.map(({ key, offsetMs, toleranceMs }) => {
    const outcome = entry?.horizons?.[key];
    if (outcome?.missed === true) return { label: key, value: 'N/D', state: 'indisponible' };
    if (outcome && Number.isFinite(outcome.returnPct)) {
      return { label: key, value: percent(outcome.returnPct), state: 'mesure' };
    }
    const targetAt = publishedAt + offsetMs;
    if (now <= targetAt + toleranceMs) return { label: key, value: 'EN ATTENTE', state: 'attente' };
    return { label: key, value: 'NON CAPTURE', state: 'manquant' };
  });
  return {
    currentReturn,
    currentState: currentFresh ? 'a jour' : observedAt ? 'donnee ancienne' : 'en attente',
    cells,
    observedAt: currentFresh ? observedAt : 0
  };
}

function renderTelegramPerformancePng(entry, now = Date.now()) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const metrics = buildTelegramPreviewMetrics(entry, now);
  const bg = '#f3f4f6', panel = '#ffffff', panelSoft = '#f7f8fa';
  const ink = '#111318', muted = '#68707d', line = '#e2e5e9';
  const red = '#f04452', green = '#26c281', amber = '#f4b740';

  function rect(x, y, width, height, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
  }
  function drawText(value, x, y, scale, fill, maxWidth = Infinity, weight = 400) {
    const fontSize = Math.max(9, Math.round(scale * 8));
    ctx.font = weight + ' ' + fontSize + 'px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = fill;
    let output = String(value || '').normalize('NFC');
    if (Number.isFinite(maxWidth) && ctx.measureText(output).width > maxWidth) {
      const ellipsis = '…';
      while (output.length && ctx.measureText(output + ellipsis).width > maxWidth) {
        output = output.slice(0, -1);
      }
      output = output ? output + ellipsis : '';
    }
    ctx.fillText(output, x, y);
  }
  const bold = (value, x, y, scale, fill, maxWidth = Infinity) =>
    drawText(value, x, y, scale, fill, maxWidth, 700);

  rect(0, 0, WIDTH, HEIGHT, bg);
  rect(18, 18, 1164, 594, panel);
  rect(18, 18, 1164, 8, red);

  // Header: restrained brand, strong editorial hierarchy.
  bold('M2MEME', 58, 48, 3, red);
  drawText('PERFORMANCE TRACKER', 218, 56, 2, muted, 430);
  const status = metrics.currentState === 'a jour' ? 'LIVE DATA'
    : metrics.currentState === 'donnee ancienne' ? 'DATA DELAYED' : 'WAITING FOR DATA';
  const statusColor = metrics.currentState === 'a jour' ? green : amber;
  rect(875, 43, 270, 42, '#f1f3f5');
  rect(875, 43, 5, 42, statusColor);
  bold(status, 895, 55, 2, statusColor, 225);
  rect(58, 105, 1087, 1, line);

  const symbol = String(entry?.tokenSymbol || 'TOKEN').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  const name = String(entry?.tokenName || symbol || 'MEMECOIN').slice(0, 26);
  bold(name, 58, 132, 4, ink, 610);
  drawText('$' + symbol, 62, 184, 2, muted, 580);
  drawText('TOTAL RETURN SINCE SIGNAL', 62, 240, 2, muted, 560);

  const currentText = metrics.currentReturn === null ? '--' : percent(metrics.currentReturn);
  const currentColor = metrics.currentReturn === null ? amber : metrics.currentReturn >= 0 ? green : red;
  rect(58, 278, 610, 250, panelSoft);
  rect(58, 278, 7, 250, red);
  bold(currentText, 88, 330, 10, currentColor, 545);
  drawText(metrics.currentState === 'a jour'
    ? 'CALCULATED FROM LATEST OBSERVED PRICE'
    : metrics.currentState === 'donnee ancienne'
      ? 'WAITING FOR A FRESH MARKET SNAPSHOT'
      : 'FIRST MARKET SNAPSHOT NOT RECEIVED YET', 94, 465, 1, muted, 530);
  const updateLabel = metrics.observedAt
    ? 'LAST UPDATE ' + new Date(metrics.observedAt).toISOString().slice(11, 16) + ' UTC'
    : 'LAST UPDATE PENDING';
  drawText(updateLabel, 94, 493, 1, muted, 530);

  drawText('PERFORMANCE MILESTONES', 716, 135, 2, ink, 420, 700);
  drawText('RETURN VS. PUBLICATION PRICE', 718, 164, 1, muted, 420);
  for (let i = 0; i < metrics.cells.length; i++) {
    const cell = metrics.cells[i];
    const col = i % 2, row = Math.floor(i / 2);
    const x = 716 + col * 218, y = 202 + row * 105;
    rect(x, y, 204, 88, panelSoft);
    rect(x, y, 4, 88, cell.state === 'mesure'
      ? (cell.value.startsWith('-') ? red : green)
      : cell.state === 'attente' ? amber : '#747b87');
    drawText(cell.label.toUpperCase(), x + 18, y + 12, 2, muted, 175, 600);
    if (cell.state === 'mesure') {
      bold(cell.value, x + 18, y + 42, 4,
        cell.value.startsWith('-') ? red : green, 172);
    } else {
      const label = cell.state === 'attente' ? 'PENDING'
        : cell.state === 'manquant' ? 'NOT CAPTURED' : 'N/A';
      bold(label, x + 18, y + 48, 2,
        cell.state === 'attente' ? amber : muted, 172);
    }
  }

  rect(58, 557, 1087, 1, line);
  drawText('REAL MARKET SNAPSHOTS ONLY  /  NO ESTIMATED PERFORMANCE', 58, 575, 1, muted, 780);
  drawText('M2MEME', 1050, 573, 1, red, 90, 700);
  return canvas.toBuffer('image/png');
}

module.exports = { renderTelegramPerformancePng, buildTelegramPreviewMetrics };
