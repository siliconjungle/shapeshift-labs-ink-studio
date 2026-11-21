const fs = require('node:fs');
const path = require('node:path');
const { KIT } = require('..').load();
const PNG = require('../cli/png');
const { drawing2d, graph, raster } = KIT.procedural;

const width = 144, height = 88, tileSize = [8, 8], top = 45;
const columns = width / tileSize[0], capacity = columns * height / tileSize[1];
const sheetWidth = 480, sheetHeight = 181, left = [16, 168, 320];
const light = '#c7e0cc', dim = '#849daa', orange = '#f0a183';
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const shape = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', at: [x, y], text: label, color, scale });

function relayCard() {
  const commands = [
    rect(0, 0, width, height, '#1c2b3d'),
    rect(0, 0, width, 16, '#142233'), rect(0, 72, width, 16, '#142233'),
    text(7, 4, 'RELAY 03', light), text(111, 4, 'N/W', '#83a29d'),
    text(7, 76, 'HARBOR LINE', '#a6b8bf'),
    ellipse(13, 21, 35, 36, '#8e5063'), ellipse(17, 25, 27, 27, '#d47d73'),
    rect(13, 45, 36, 2, '#1c2b3d'), rect(13, 49, 36, 1, '#1c2b3d'),
    shape([[0, 55], [31, 39], [57, 52], [72, 42], [94, 56], [113, 39], [144, 52], [144, 73], [0, 73]], '#36536b'),
    shape([[0, 67], [34, 61], [55, 65], [83, 55], [98, 59], [122, 52], [144, 64], [144, 73], [0, 73]], '#28394f'),
    rect(0, 69, width, 3, '#56787d'),
    shape([[55, 69], [61, 34], [72, 25], [82, 36], [89, 69]], '#6e4e56'),
    shape([[62, 69], [66, 38], [72, 32], [77, 40], [82, 69]], '#c78170'),
    rect(69, 18, 7, 36, '#bb887b'), rect(72, 17, 2, 15, light),
    rect(48, 47, 47, 3, '#dcc39d'), rect(52, 52, 39, 2, '#6ca89d'),
    line([[72, 25], [110, 22], [124, 30]], '#668e8c'),
    line([[72, 30], [108, 28], [122, 33]], '#557578'),
    rect(105, 52, 19, 18, '#547472'), rect(110, 57, 9, 5, '#92c2ac')
  ];
  for (const x of [26, 33, 42, 101, 128]) commands.push(rect(x, 62, 4, 7, '#6d9b91'));
  for (let y = 16; y < 72; y += 8) {
    commands.push(rect(4, y + 1, 2, 6, y % 16 ? '#ebaa82' : '#6ca89d'));
    for (let x = 8; x < width; x += 8) commands.push(rect(x, y, 1, 1, '#617c88'));
  }
  for (let x = 102; x < 139; x += 4) commands.push(rect(x, 77, 1, x % 8 === 2 ? 6 : 3, '#6ca89d'));
  return draw(width, height, commands);
}

const source = relayCard();
const session = graph.create({
  inputs: { art: 'raster', stride: 'number', wrapAt: 'number' },
  nodes: {
    options: { op: 'data.record', inputs: { tileSize, stride: { input: 'stride' }, wrapAt: { input: 'wrapAt' } } },
    slip: { op: 'fx.tileStrideSlip', inputs: { source: { input: 'art' }, options: { node: 'options' } } }
  },
  outputs: { value: { node: 'slip' }, addresses: { node: 'slip', port: 'addresses' } }
});
const sample = (stride, wrapAt) => session.evaluate({ art: source, stride, wrapAt }).outputs;
const base = sample(columns, capacity);
const frameBase = draw(sheetWidth, sheetHeight, [
  rect(0, 0, sheetWidth, sheetHeight, '#111b26'), rect(16, 12, 3, 15, orange),
  text(25, 12, 'TILE STRIDE SLIP', light, 2),
  ...['ORIGINAL', 'ROW STRIDE', 'EARLY WRAP'].map((label, i) => text(left[i], 33, label, i ? orange : dim)),
  ...left.flatMap(x => [rect(x - 1, top - 1, width + 2, height + 2, '#547070'),
    text(x, 151, 'ROW STARTS', dim)]),
]);
const driftSteps = [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 2, 1, 0, 0, 0];
const wrapSteps = [198, 198, 178, 165, 145, 132, 125, 116, 108, 93, 84, 108, 145, 198, 198, 198];

function frame(tick) {
  const stride = columns + driftSteps[tick], wrapAt = wrapSteps[tick];
  const panels = [base, sample(stride, capacity), sample(columns, wrapAt)];
  const readouts = ['STRIDE ' + columns, 'STRIDE ' + stride, 'WRAP ' + wrapAt];
  const labels = panels.flatMap(({ addresses }, i) => [
    text(left[i], 137, readouts[i], i ? orange : light),
    ...[0, 2, 4, 6, 8, 10].map((row, j) => text(left[i] + j * 24, 163,
      String(addresses.data[row * addresses.width]).padStart(3, '0'), light))
  ]);
  return raster.stack({ width: sheetWidth, height: sheetHeight,
    layers: [{ source: frameBase }, ...panels.map(({ value }, i) => ({ source: value, x: left[i], y: top })),
      { source: draw(sheetWidth, sheetHeight, labels) }]
  }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/tile-stride-slip.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
for (let index = 0; index < 48; index++) {
  const image = frame(Math.floor(index / 3));
  const file = path.join(directory, 'stride-' + String(index).padStart(3, '0') + '.png');
  fs.writeFileSync(file, PNG.encode(image.width, image.height, image.data, 4));
}
