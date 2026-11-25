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
function renderTelegramPerformancePng(entry, now = Date.now()) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  rect(pixels, 0, 0, WIDTH, HEIGHT, '#0b1020');
  rect(pixels, 30, 30, 1140, 570, '#111b31');
  rect(pixels, 30, 30, 1140, 7, '#36d6a6');
  drawText(pixels, 'M2MEME  /  PERFORMANCE', 76, 70, 3, '#36d6a6');
  const symbol = String(entry.tokenSymbol || 'TOKEN').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  const name = String(entry.tokenName || symbol || 'MEMECOIN').slice(0, 34);
  drawText(pixels, name, 76, 132, 5, '#f4f7ff', 760);
  drawText(pixels, '$' + symbol, 80, 194, 2, '#8fa4c8', 760);
  const currentPrice = Number(entry.lastCurrentPriceUsd);
  const currentReturn = Number.isFinite(currentPrice) && currentPrice > 0 && entry.basePriceUsd > 0
    ? (currentPrice / entry.basePriceUsd - 1) * 100 : null;
  drawText(pixels, 'DEPUIS PUBLICATION', 850, 126, 2, '#8fa4c8', 270);
  const returnColor = currentReturn === null ? '#f4f7ff' : currentReturn >= 0 ? '#36d6a6' : '#ff7185';
  drawText(pixels, percent(currentReturn), 850, 166, 4, returnColor, 270);
  rect(pixels, 76, 250, 1048, 2, '#263650');
  drawText(pixels, 'EVOLUTION AUX ECHEANCES', 76, 282, 2, '#8fa4c8');
  const cells = HORIZONS.map(({ key }) => {
    const outcome = entry.horizons?.[key];
    return { label: key.toUpperCase(), value: outcome?.missed ? 'N/D' : percent(outcome?.returnPct) };
  });
  const columns = [76, 438, 800];
  for (let i = 0; i < cells.length; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = columns[col], y = 340 + row * 112;
    rect(pixels, x, y, 324, 84, '#192741');
    drawText(pixels, cells[i].label, x + 22, y + 17, 2, '#8fa4c8');
    const value = cells[i].value;
    const positiveValue = value.startsWith('+') || value === '0.0%';
    drawText(pixels, value, x + 22, y + 46, 3, value === 'N/D' || value === '--' ? '#d1d9e8' : positiveValue ? '#36d6a6' : '#ff7185');
  }
  drawText(pixels, 'MESURES BASEES SUR LES RELEVES DE MARCHE DISPONIBLES', 76, 555, 1, '#7285a6');
  drawText(pixels, new Date(now).toISOString().slice(0, 16).replace('T', '  '), 850, 555, 1, '#7285a6');
  return encodePng(pixels);
}

module.exports = { renderTelegramPerformancePng };
