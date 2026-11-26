const { encodeMaterial } = require('../../cli/png.js');

const width = 80, height = 72;
const rgb = hex => hex.match(/../g).map(n => parseInt(n, 16));

const shells = [
  ['171827', '2b293c', '463749', '78525e', 'b47368', 'e2a480', 'ffe1ac'],
  ['171c2a', '203143', '2c4c54', '39736c', '57a187', '93caa4', 'e4e5b2'],
  ['1c1829', '2d2441', '4a355a', '7a4b74', 'a26988', 'd99496', 'f0c3a7']
];
const glass = [
  ['251a32', '492437', '743440', 'a74b44', 'd06648', 'eb9052', 'ffd185', 'fff3b3'],
  ['162638', '1f3b54', '2c5462', '388577', '58b991', '82d49f', 'b9e8ae', 'e9fcc9'],
  ['231a39', '392b54', '5c3a79', '88508d', 'b4689e', 'cf83b3', 'efa8c7', 'ffe4cb']
];
const glyphs = {
  '0': ['111','101','101','101','111'], '7': ['111','001','010','010','010'],
  'N': ['101','111','111','111','101'], '·': ['0','0','1','0','0']
};

function signal(scheme = 0, power = .58, offset = 0) {
  const metal = shells[scheme].map(rgb), lens = glass[scheme].map(rgb);
  const data = new Uint16Array(width * height * 4);
  const square = (x, y, x1, y1, x2, y2) => x >= x1 && x < x2 && y >= y1 && y < y2;
  function paint(x, y) {
    const t = Math.abs(x - 39.5), ring = Math.hypot(x - 39.5, y - 30);
    if (y < 2 || y > 69 || t > 31 || y < 8 && t + (8 - y) > 31 || y > 64 && t + (y - 64) > 31) return;
    if (t > 29 || y < 4 || y > 67 || y < 9 && t + (9 - y) > 31 || y > 63 && t + y - 63 > 31)
      return t > 29 && x < 40 || y < 5 ? metal[3] : metal[0];
    let slot = y < 10 || x < 13 ? 4 : x > 65 || y > 63 ? 1 : y < 14 ? 3 : 2;
    if (Math.abs(x - 40) > 24 && y > 17 && y < 49 && (x + Math.floor(y / 5)) % 4 === 0) slot += 1;
    if (y === 12 || y === 49 || y === 63 || x === 17 || x === 63) slot = y === 12 ? 2 : 1;
    if (y === 50 || y === 64 || x === 16) slot = 3;
    const corners = [[14, 11], [65, 11], [14, 60], [65, 60]];
    for (const [cx, cy] of corners) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 3) return d > 2.3 ? metal[0] : x + y < cx + cy ? metal[5] : y === cy ? metal[1] : metal[3];
    }
    if (square(x, y, 26, 52, 54, 64)) {
      if (y === 52 || x === 26) return metal[6];
      if (y === 63 || x === 53) return metal[0];
      if (y === 53 || x === 27) return metal[4];
      const text = [[30, 'N'], [35, '·'], [40, '0'], [45, '7']];
      for (const [sx, char] of text) if (glyphs[char][y - 55]?.[x - sx] === '1') return metal[1];
      return metal[5];
    }
    if (ring <= 22) {
      if (ring > 21) return x + y < 67 ? metal[5] : metal[0];
      if (ring > 18) return x + y < 65 ? metal[4] : x + y < 79 ? metal[3] : metal[1];
      if (ring > 16.7) return x + y > 70 ? metal[4] : metal[0];
      const dx = x - 39.5, dy = y - 30, flare = Math.hypot(dx * .71 + offset, dy - 2) / 23;
      const sheen = (dx + dy < -8 && ring > 10 ? .26 : 0) + (Math.abs(dx + dy + 15) < 1.1 ? .15 : 0);
      const grooves = (x % 4 === 0 && y > 23 ? .09 : 0) + (y % 5 === 0 ? .047 : 0);
      const intens = Math.min(7, Math.max(0, Math.round(1 + 6 * power - 5 * flare + 5 * sheen - 5 * grooves)));
      if (Math.abs(dx) < 1.7 || Math.abs(dy) < 1.2) return lens[Math.max(0, intens - 1)];
      return lens[intens];
    }
    return metal[slot];
  }
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i += 4) {
    const color = paint(x, y);
    if (!color) continue;
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(65535, color[c] * 257 + (x * 19 + y * 23 + c * 7) % 101);
    data[i + 3] = 65535;
  }
  return data;
}

function png(scheme, power, offset) {
  return encodeMaterial(width, height, signal(scheme, power, offset), 4);
}

function hdr() {
  const source = signal(1, .73, 0);
  const pixels = Buffer.alloc(width * height * 12);
  for (let y = 0, at = 0; y < height; y++) for (let x = 0; x < width; x++, at += 12) {
    const i = ((height - 1 - y) * width + x) * 4;
    const beam = Math.max(0, 1 - Math.hypot(x - 40, (height - 1 - y - 30) * 1.07) / 17) ** 2 * 9;
    for (let c = 0; c < 3; c++) {
      const base = source[i + c] / 65535;
      const e = (base ** 2.2) * (.42 + beam) + beam * [.22, .39, .32][c];
      pixels.writeFloatLE(e, at + c * 4);
    }
  }
  return Buffer.concat([Buffer.from('PF\n' + width + ' ' + height + '\n-1.0\n'), pixels]);
}
module.exports = { width, height, png, hdr };
