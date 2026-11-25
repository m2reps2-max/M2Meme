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
  const red = '#e5394f', green = '#16a36a', amber = '#d99516';

  function rect(x, y, width, height, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
  }
  function drawText(value, x, y, fontSize, fill, maxWidth = Infinity, weight = 400) {
    ctx.font = weight + ' ' + fontSize + 'px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = fill;
    let output = String(value || '').normalize('NFC');
    if (Number.isFinite(maxWidth) && ctx.measureText(output).width > maxWidth) {
      const ellipsis = '…';
      while (output.length && ctx.measureText(output + ellipsis).width > maxWidth) output = output.slice(0, -1);
      output = output ? output + ellipsis : '';
    }
    ctx.fillText(output, x, y);
  }
  const bold = (value, x, y, fontSize, fill, maxWidth = Infinity) =>
    drawText(value, x, y, fontSize, fill, maxWidth, 700);

  rect(0, 0, WIDTH, HEIGHT, bg);
  rect(18, 18, 1164, 594, panel);
  rect(18, 18, 1164, 8, red);

  bold('M2MEME', 58, 48, 25, red);
  drawText('PERFORMANCE TRACKER', 218, 55, 16, muted, 430, 600);
  const status = metrics.currentState === 'a jour' ? 'DONNÉES À JOUR'
    : metrics.currentState === 'donnee ancienne' ? 'DONNÉES EN RETARD' : 'EN ATTENTE DES DONNÉES';
  const statusColor = metrics.currentState === 'a jour' ? green : amber;
  rect(875, 43, 270, 42, '#f1f3f5');
  rect(875, 43, 5, 42, statusColor);
  bold(status, 895, 55, 15, statusColor, 235);
  rect(58, 105, 1087, 1, line);

  const symbol = String(entry?.tokenSymbol || 'TOKEN').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  const name = String(entry?.tokenName || symbol || 'MEMECOIN').slice(0, 26);
  bold(name, 58, 125, 30, ink, 700);
  drawText('$' + symbol, 62, 164, 16, muted, 580);

  // One wide, high-contrast card keeps the live return immediately readable.
  rect(58, 198, 1087, 150, panelSoft);
  rect(58, 198, 7, 150, red);
  drawText('ÉVOLUTION TOTALE DEPUIS LA PUBLICATION', 88, 220, 16, muted, 690, 600);
  const currentText = metrics.currentReturn === null ? '--' : percent(metrics.currentReturn);
  const currentColor = metrics.currentReturn === null ? amber : metrics.currentReturn >= 0 ? green : red;
  bold(currentText, 88, 254, 58, currentColor, 600);
  const currentDescription = metrics.currentState === 'a jour'
    ? 'Calculée avec le dernier prix réellement observé'
    : metrics.currentState === 'donnee ancienne'
      ? 'En attente d’un nouveau relevé de marché'
      : 'Premier relevé de marché non reçu';
  drawText(currentDescription, 720, 270, 17, muted, 390);
  const updateLabel = metrics.observedAt
    ? 'MIS À JOUR À ' + new Date(metrics.observedAt).toISOString().slice(11, 16) + ' UTC'
    : 'MISE À JOUR EN ATTENTE';
  bold(updateLabel, 720, 303, 13, muted, 390);

  drawText('ÉVOLUTION HEURE PAR HEURE', 58, 372, 19, ink, 600, 700);
  drawText('Variation par rapport au prix au moment du signal', 58, 398, 13, muted, 700);

  const cardGap = 9;
  const cardWidth = 173;
  const cardY = 425;
  const cardHeight = 132;
  for (let i = 0; i < metrics.cells.length; i++) {
    const cell = metrics.cells[i];
    const x = 58 + i * (cardWidth + cardGap);
    const measured = cell.state === 'mesure';
    const positive = measured && Number(cell.value.replace('%', '')) >= 0;
    const accent = measured ? (positive ? green : red)
      : cell.state === 'attente' ? amber : '#8a919c';
    rect(x, cardY, cardWidth, cardHeight, panelSoft);
    rect(x, cardY, cardWidth, 6, accent);
    bold(cell.label.toUpperCase(), x + 15, cardY + 18, 18, ink, cardWidth - 30);
    if (measured) {
      bold(cell.value, x + 13, cardY + 55, 31, accent, cardWidth - 24);
      drawText(positive ? 'EN HAUSSE' : 'EN BAISSE', x + 15, cardY + 101, 11, accent, cardWidth - 30, 700);
    } else {
      const label = cell.state === 'attente' ? 'EN ATTENTE'
        : cell.state === 'manquant' ? 'NON CAPTURÉ' : 'N/D';
      bold(label, x + 13, cardY + 65, label.length > 9 ? 15 : 19,
        accent, cardWidth - 24);
    }
  }

  rect(58, 580, 1087, 1, line);
  drawText('RELEVÉS DE MARCHÉ RÉELS UNIQUEMENT · AUCUNE PERFORMANCE ESTIMÉE', 58, 591, 11, muted, 850);
  bold('M2MEME', 1050, 588, 13, red, 90);
  return canvas.toBuffer('image/png');
}

module.exports = { renderTelegramPerformancePng, buildTelegramPreviewMetrics };
