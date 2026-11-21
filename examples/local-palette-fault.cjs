const fs = require('node:fs');
const path = require('node:path');
const { KIT } = require('..').load();
const PNG = require('../cli/png');
const { drawing2d, graph, raster, rasterColor } = KIT.procedural;

const width = 136, height = 96, top = 45, sheetWidth = 456, sheetHeight = 179;
const left = [16, 160, 304];
const palette = ['#211d29', '#473344', '#795159', '#b47367', '#e8a07c', '#f9d4a1', '#537b7c', '#9bc3a8'];
const [black, shadow, red, copper, orange, cream, teal, mint] = palette;
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const shape = (points, fill) => ({ type: 'polygon', points, fill });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', at: [x, y], text: label, color, scale });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });

function kilnPanel() {
  const commands = [
    rect(0, 0, width, height, black), rect(4, 4, 128, 88, shadow),
    rect(8, 8, 120, 80, black), rect(8, 8, 120, 12, shadow), rect(8, 78, 120, 10, shadow),
    text(12, 9, 'KILN 07', cream), text(98, 9, 'LIVE', mint), text(12, 79, 'HEAT MAP', mint),
    shape([[28, 65], [49, 27], [89, 27], [114, 65], [105, 75], [38, 75]], red),
    shape([[34, 65], [52, 31], [87, 31], [108, 65], [101, 71], [41, 71]], copper),
    shape([[39, 65], [54, 35], [85, 35], [101, 65], [96, 68], [44, 68]], orange),
    shape([[44, 65], [57, 39], [81, 39], [95, 65]], shadow),
    ellipse(52, 36, 32, 28, black), ellipse(55, 39, 26, 22, red),
    shape([[58, 57], [57, 51], [62, 49], [64, 42], [69, 46], [72, 38], [76, 48], [79, 54], [76, 59], [60, 59]], copper),
    shape([[60, 57], [62, 52], [68, 50], [72, 44], [76, 53], [74, 57]], orange),
    shape([[64, 57], [68, 53], [72, 50], [73, 56]], cream),
    line([[38, 55], [49, 34], [56, 30], [85, 30], [94, 37], [103, 55]], cream),
    rect(15, 28, 5, 38, teal), rect(16, 40, 3, 19, mint),
    rect(117, 31, 3, 34, teal), rect(117, 39, 3, 8, mint)
  ];
  for (let i = 0; i < 7; i++) {
    commands.push(rect(23, 30 + i * 5, i % 2 ? 3 : 5, 1, teal));
    commands.push(rect(111, 30 + i * 5, i % 2 ? 2 : 4, 1, teal));
  }
  for (let i = 0; i < 10; i++) commands.push(rect(78 + 4 * i, 81, 2, 3, i < 6 ? mint : teal));
  return draw(width, height, commands);
}

const original = rasterColor.resolve(kilnPanel(), { palette }, { method: 'solid' });
const swaps = [[1, 5], [2, 4]];
const stuck = { from: [2, 3, 4, 5], to: 2 };
const session = graph.create({
  inputs: { art: 'raster', mask: 'raster' },
  nodes: {
    swapOptions: { op: 'data.record', inputs: { swaps, mask: { input: 'mask' } } },
    stuckOptions: { op: 'data.record', inputs: { stuck, mask: { input: 'mask' } } },
    swapped: { op: 'fx.paletteFault', inputs: { source: { input: 'art' }, palette, options: { node: 'swapOptions' } } },
    collapsed: { op: 'fx.paletteFault', inputs: { source: { input: 'art' }, palette, options: { node: 'stuckOptions' } } }
  },
  outputs: { swapped: { node: 'swapped' }, collapsed: { node: 'collapsed' } }
});
const frameBase = draw(sheetWidth, sheetHeight, [
  rect(0, 0, sheetWidth, sheetHeight, '#171e2a'), rect(16, 12, 3, 15, orange),
  text(25, 12, 'LOCAL PALETTE FAULT', cream, 2),
  ...['ORIGINAL', 'SWAPPED SLOTS', 'STUCK SLOTS'].map((label, i) => text(left[i], 33, label, i ? orange : mint)),
  ...left.map(x => rect(x - 1, top - 1, width + 2, height + 2, teal)),
  ...palette.map((swatch, i) => rect(16 + i * 13, 151, 11, 8, swatch)),
  text(16, 164, 'SOURCE PALETTE', mint),
  text(left[1], 151, '01 <-> 05', cream),
  text(left[1], 164, '02 <-> 04', cream),
  text(left[2], 151, '02 03 04 05', cream),
  text(left[2], 164, 'HELD AT 02', cream)
]);
const segments = [
  [], [], [[40, 24, 40, 24]], [[40, 24, 40, 24], [48, 48, 40, 8]],
  [[48, 24, 48, 32]], [[40, 32, 64, 32]], [[40, 24, 56, 40]], [[32, 32, 64, 32]],
  [[32, 40, 56, 24], [72, 24, 24, 16]], [[40, 32, 64, 40]], [[56, 40, 48, 24]],
  [[64, 48, 32, 24]], [[56, 48, 32, 16]], [], [], []
];

function frame(tick) {
  const mask = draw(width, height, segments[tick].map(region => rect(...region, '#ffffff')));
  const { swapped, collapsed } = session.evaluate({ art: original.indices, mask }).outputs;
  return raster.stack({ width: sheetWidth, height: sheetHeight, layers: [
    { source: frameBase },
    ...[original.value, swapped, collapsed].map((source, i) => ({ source, x: left[i], y: top }))
  ] }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/local-palette-fault.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
for (let index = 0; index < 48; index++) {
  const { width, height, data } = frame(Math.floor(index / 3));
  const file = path.join(directory, 'fault-' + String(index).padStart(3, '0') + '.png');
  fs.writeFileSync(file, PNG.encode(width, height, data, 4));
}
