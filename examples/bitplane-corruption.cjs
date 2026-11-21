const fs = require('node:fs');
const path = require('node:path');
const { KIT } = require('..').load();
const PNG = require('../cli/png');
const { drawing2d, raster, rasterColor, pixelEffects } = KIT.procedural;

const width = 88, height = 84, fps = 12;
const sheetWidth = 520, sheetHeight = 154, top = 43;
const columns = [16, 116, 216, 316, 416];
const palette = ['#243a3c', '#4a6960', '#91aa83', '#e0e5b1'];
const [shade, middle, light, highlight] = palette;
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const polygon = (points, fill) => ({ type: 'polygon', points, fill });
const stroke = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', at: [x, y], text: label, color, scale });

function receiver() {
  const commands = [
    stroke([[20, 46], [7, 52], [7, 69], [13, 75], [26, 73]], middle, 3),
    stroke([[66, 39], [79, 39], [83, 43], [80, 59], [71, 67], [66, 67]], light, 2),
    polygon([[16, 51], [71, 51], [78, 62], [69, 76], [57, 81], [29, 81], [11, 68]], shade),
    polygon([[21, 56], [69, 56], [70, 65], [62, 76], [33, 77], [20, 69]], middle),
    ellipse(12, 14, 63, 50, shade), ellipse(15, 15, 56, 44, middle),
    ellipse(19, 17, 50, 37, light), ellipse(24, 19, 43, 32, highlight),
    ellipse(28, 23, 37, 27, middle), ellipse(30, 24, 33, 24, shade),
    ellipse(37, 25, 23, 19, light), ellipse(44, 26, 13, 12, middle),
    polygon([[35, 37], [42, 29], [50, 29], [43, 38]], highlight),
    stroke([[33, 43], [53, 45], [62, 40]], light),
    rect(32, 50, 13, 4, shade), rect(34, 51, 8, 1, highlight),
    rect(30, 65, 31, 7, shade), rect(32, 66, 24, 2, light),
    polygon([[24, 21], [28, 16], [32, 16], [22, 4], [17, 4], [17, 8]], shade),
    stroke([[18, 5], [22, 5], [29, 14]], highlight),
    rect(50, 8, 3, 9, middle), ellipse(47, 3, 9, 9, light), rect(49, 5, 3, 2, highlight)
  ];
  for (const [x, y] of [[22, 29], [25, 47], [39, 19], [63, 26], [62, 47], [24, 59], [65, 60], [38, 74], [54, 74]]) {
    commands.push(rect(x, y, 3, 3, shade), rect(x, y, 2, 1, highlight));
  }
  for (let x = 34; x < 56; x += 4) commands.push(rect(x, 68, 1, 3, middle));
  return draw(width, height, commands);
}

const original = rasterColor.resolve(receiver(), { palette }, { method: 'solid' });
const panel = draw(sheetWidth, sheetHeight, [
  rect(0, 0, sheetWidth, sheetHeight, '#111e24'),
  rect(16, 12, 3, 15, light), text(25, 12, 'BITPLANE CORRUPTION', highlight, 2),
  ...['ORIGINAL', 'FLIP BIT 1', 'CLEAR BIT 1', 'BORROW BIT 1', 'DONOR BIT 0'].map((label, i) => text(columns[i], 32, label, light)),
  ...columns.flatMap(x => [rect(x - 1, top - 1, width + 2, height + 2, middle), rect(x, top, width, height, '#16292e')]),
  ...palette.map((color, i) => rect(16 + i * 14, 136, 12, 8, color)),
  text(76, 136, '4 PALETTE SLOTS', light), text(316, 136, 'MASKED PIXEL EDITS', light)
]);
const plane = data => ({ width, height, channels: 1, data });

function pattern(tick) {
  const selection = new Uint8Array(width * height), bits = new Uint8Array(selection.length);
  const sweep = 15 + 4 * tick;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const band = Math.floor(y / 5), cell = Math.floor(x / 8);
      const lineEnd = 56 + 8 * ((band + tick) % 4);
      if (x >= 8 && x < lineEnd && Math.abs(y - sweep) < 24 && (cell + band * 3 + tick) % 7 !== 0) selection[i] = 255;
      const stripe = ((x + 6 * tick + (band % 3) * 8) % 26) < 9;
      const trace = (x + tick * 3) % 19 < 2 && y % 13 < 9;
      bits[i] = Number((stripe && (band + tick) % 4 !== 0) || (trace && y % 5 < 2));
    }
  }
  return { mask: plane(selection), bank: plane(bits) };
}

function frame(tick) {
  const { mask, bank } = pattern(tick);
  const source = original.indices;
  const { bitplane } = pixelEffects;
  const art = [original.value, ...['flip', 'clear', 'borrow'].map(mode =>
    bitplane(source, palette, { mode, bit: 1, mask, bank, bankBit: 0 }).value),
    bitplane(bank, [shade, light], { mode: 'clear', bit: 1 }).value];
  return raster.stack({ width: sheetWidth, height: sheetHeight,
    layers: [{ source: panel }, ...art.map((source, i) => ({ source, x: columns[i], y: top }))]
  }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/bitplane-corruption.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
for (let index = 0; index < fps * 4; index++) {
  const image = frame(Math.floor(index / 3));
  const file = path.join(directory, 'bitplane-' + String(index).padStart(3, '0') + '.png');
  fs.writeFileSync(file, PNG.encode(image.width, image.height, image.data, 4));
}
