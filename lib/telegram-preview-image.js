'use strict';

const zlib = require('node:zlib');
const { HORIZONS } = require('./telegram-performance');

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = {
  'A':'01110/10001/10001/11111/10001/10001/10001','B':'11110/10001/10001/11110/10001/10001/11110',
  'C':'01111/10000/10000/10000/10000/10000/01111','D':'11110/10001/10001/10001/10001/10001/11110',
  'E':'11111/10000/10000/11110/10000/10000/11111','F':'11111/10000/10000/11110/10000/10000/10000',
  'G':'01111/10000/10000/10111/10001/10001/01111','H':'10001/10001/10001/11111/10001/10001/10001',
  'I':'11111/00100/00100/00100/00100/00100/11111','J':'00111/00010/00010/00010/10010/10010/01100',
  'K':'10001/10010/10100/11000/10100/10010/10001','L':'10000/10000/10000/10000/10000/10000/11111',
  'M':'10001/11011/10101/10101/10001/10001/10001','N':'10001/11001/10101/10011/10001/10001/10001',
  'O':'01110/10001/10001/10001/10001/10001/01110','P':'11110/10001/10001/11110/10000/10000/10000',
  'Q':'01110/10001/10001/10001/10101/10010/01101','R':'11110/10001/10001/11110/10100/10010/10001',
  'S':'01111/10000/10000/01110/00001/00001/11110','T':'11111/00100/00100/00100/00100/00100/00100',
  'U':'10001/10001/10001/10001/10001/10001/01110','V':'10001/10001/10001/10001/10001/01010/00100',
  'W':'10001/10001/10001/10101/10101/10101/01010','X':'10001/10001/01010/00100/01010/10001/10001',
  'Y':'10001/10001/01010/00100/00100/00100/00100','Z':'11111/00001/00010/00100/01000/10000/11111',
  '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110',
  '2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110',
  '4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110',
  '6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000',
  '8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
  '+':'00000/00100/00100/11111/00100/00100/00000','-':'00000/00000/00000/11111/00000/00000/00000',
  '%':'11001/11010/00100/01000/10110/00110/00000','.':'00000/00000/00000/00000/00000/00110/00110',
  ',':'00000/00000/00000/00000/00110/00110/00100',':':'00000/00110/00110/00000/00110/00110/00000',
  '/':'00001/00010/00010/00100/01000/01000/10000','_':'00000/00000/00000/00000/00000/00000/11111',
  '$':'00100/01111/10100/01110/00101/11110/00100','(':'00010/00100/01000/01000/01000/00100/00010',
  ')':'01000/00100/00010/00010/00010/00100/01000',' ':'00000/00000/00000/00000/00000/00000/00000'
};

function color(value) {
  const hex = String(value || '#ffffff').replace('#', '');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
}
function rect(pixels, x, y, width, height, fill) {
  const rgba = color(fill);
  const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
  const right = Math.min(WIDTH, Math.ceil(x + width)), bottom = Math.min(HEIGHT, Math.ceil(y + height));
  for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
    const at = (py * WIDTH + px) * 4;
    pixels[at] = rgba[0]; pixels[at + 1] = rgba[1]; pixels[at + 2] = rgba[2]; pixels[at + 3] = 255;
  }
}
function textWidth(value, scale) { return String(value).length * 6 * scale - scale; }
function drawText(pixels, value, x, y, scale, fill, maxWidth = Infinity) {
  const rgba = color(fill);
  const input = String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 +\-.,:/_()%$]/g, ' ');
  const maxChars = Number.isFinite(maxWidth) ? Math.max(0, Math.floor((maxWidth + scale) / (6 * scale))) : input.length;
  const chars = input.slice(0, maxChars);
  for (let index = 0; index < chars.length; index++) {
    const rows = (FONT[chars[index]] || FONT[' ']).split('/');
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      if (rows[row][col] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = x + index * 6 * scale + col * scale + sx;
        const py = y + row * scale + sy;
        if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
        const at = (py * WIDTH + px) * 4;
        pixels[at] = rgba[0]; pixels[at + 1] = rgba[1]; pixels[at + 2] = rgba[2]; pixels[at + 3] = 255;
      }
    }
  }
  return chars.length * 6 * scale;
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function encodePng(pixels) {
  const stride = WIDTH * 4;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
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
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const metrics = buildTelegramPreviewMetrics(entry, now);
  const bg = '#eef2f7', white = '#ffffff', ink = '#142238', muted = '#718096';
  const soft = '#f5f8fc', line = '#e2e8f0', emerald = '#087f5b';
  const red = '#c24155', amber = '#a16207', navy = '#172b46';
  rect(pixels, 0, 0, WIDTH, HEIGHT, bg);
  rect(pixels, 18, 18, 1164, 594, '#dce4ed');
  rect(pixels, 18, 18, 1164, 590, white);
  rect(pixels, 18, 18, 1164, 7, emerald);
  rect(pixels, 52, 52, 1096, 1, line);

  drawText(pixels, 'M2MEME', 66, 68, 3, emerald);
  drawText(pixels, 'PERFORMANCE', 218, 75, 2, ink);
  drawText(pixels, 'SUIVI DU TOKEN', 430, 76, 1, muted);
  const stateLabel = metrics.currentState === 'a jour' ? 'MARCHE A JOUR'
    : metrics.currentState === 'donnee ancienne' ? 'RELEVE ANCIEN' : 'EN ATTENTE';
  const stateColor = metrics.currentState === 'a jour' ? emerald : amber;
  rect(pixels, 900, 60, 248, 42, '#edf7f2');
  rect(pixels, 900, 60, 4, 42, stateColor);
  drawText(pixels, stateLabel, 918, 76, 2, stateColor, 210);

  const symbol = String(entry?.tokenSymbol || 'TOKEN').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  const name = String(entry?.tokenName || symbol || 'MEMECOIN').slice(0, 30);
  drawText(pixels, name, 66, 128, 5, ink, 650);
  drawText(pixels, '$' + symbol, 70, 188, 2, muted, 650);
  drawText(pixels, 'PERFORMANCE DEPUIS LA PUBLICATION', 760, 126, 2, muted, 380);
  const currentText = metrics.currentReturn === null ? '—' : percent(metrics.currentReturn);
  const currentColor = metrics.currentReturn === null ? amber : metrics.currentReturn >= 0 ? emerald : red;
  drawText(pixels, currentText, 760, 158, 6, currentColor, 380);
  drawText(pixels, metrics.currentState === 'a jour'
    ? 'CALCULEE SUR LE DERNIER PRIX OBSERVE'
    : metrics.currentState === 'donnee ancienne'
      ? 'ACTUALISATION EN ATTENTE'
      : 'PREMIER RELEVE EN ATTENTE', 766, 220, 1, muted, 370);

  rect(pixels, 66, 270, 1082, 1, line);
  drawText(pixels, 'RENDEMENT AUX ECHEANCES', 66, 288, 2, ink);
  drawText(pixels, 'VS. PRIX DE REFERENCE A LA PUBLICATION', 660, 294, 1, muted, 488);

  const columns = [66, 434, 802];
  for (let i = 0; i < metrics.cells.length; i++) {
    const cell = metrics.cells[i];
    const col = i % 3, row = Math.floor(i / 3);
    const x = columns[col], y = 326 + row * 112;
    rect(pixels, x, y + 3, 340, 92, '#e9eef5');
    rect(pixels, x, y, 340, 92, soft);
    const accent = cell.state === 'mesure'
      ? (cell.value.startsWith('-') ? red : emerald)
      : cell.state === 'attente' ? amber : '#94a3b8';
    rect(pixels, x, y, 5, 92, accent);
    drawText(pixels, cell.label.toUpperCase(), x + 22, y + 15, 2, muted);
    if (cell.state === 'mesure') {
      const positiveValue = cell.value.startsWith('+') || cell.value === '0.0%';
      drawText(pixels, cell.value, x + 22, y + 45, 4, positiveValue ? emerald : red, 290);
    } else {
      const label = cell.state === 'attente' ? 'EN ATTENTE'
        : cell.state === 'manquant' ? 'NON CAPTURE' : 'N/D';
      drawText(pixels, label, x + 22, y + 51, 2, cell.state === 'attente' ? amber : muted, 290);
    }
  }

  rect(pixels, 66, 566, 1082, 1, line);
  drawText(pixels, 'DONNEES DE MARCHE OBSERVEES · AUCUNE PERFORMANCE ESTIMEE', 66, 580, 1, muted, 740);
  const timestamp = metrics.observedAt
    ? new Date(metrics.observedAt).toISOString().slice(11, 16) + ' UTC'
    : 'EN ATTENTE';
  drawText(pixels, 'MAJ ' + timestamp, 930, 580, 1, metrics.observedAt ? emerald : amber, 218);
  return encodePng(pixels);
}

module.exports = { renderTelegramPerformancePng, buildTelegramPreviewMetrics };
