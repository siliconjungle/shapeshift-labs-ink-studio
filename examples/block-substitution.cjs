const fs = require('node:fs');
const path = require('node:path');
const { KIT } = require('..').load();
const PNG = require('../cli/png');
const { drawing2d, graph, raster } = KIT.procedural;

const width = 132, height = 86, fps = 12, frameCount = 48, top = 46;
const sheetWidth = 602, sheetHeight = 168, left = [16, 162, 308, 454];
const pale = '#e6d6af', orange = '#eea184', mint = '#a0ccc0', dim = '#819ca8';
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const shape = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', at: [x, y], text: label, color, scale });

const feed = draw(width, height, [
  rect(0, 0, width, height, '#222d43'), rect(0, 29, width, 25, '#455569'),
  ellipse(88, 16, 28, 29, '#a45d6d'), ellipse(92, 20, 21, 20, '#e88e7e'),
  rect(0, 41, width, 2, '#455569'), rect(0, 50, width, 36, '#264455'),
  shape([[0, 49], [21, 39], [43, 45], [63, 38], [91, 48], [108, 44], [132, 48], [132, 54], [0, 54]], '#40586a'),
  rect(9, 39, 18, 24, '#8f706c'), rect(12, 43, 12, 6, '#e8ac82'), rect(15, 34, 6, 5, '#9a8276'),
  rect(104, 43, 21, 30, '#517880'), rect(108, 48, 12, 9, '#a0bdab'), rect(115, 34, 5, 10, '#868b93'),
  rect(0, 69, width, 1, '#507383'), rect(0, 0, width, 12, '#253346'), rect(0, 75, width, 11, '#253346'),
  text(5, 1, 'DOCK VIEW', pale), text(100, 1, 'C04', mint), text(5, 77, 'NORTH RELAY', mint)
]);

function frameOfFeed(index) {
  const phase = 2 * Math.PI * index / frameCount;
  const x = Math.round(70 + 27 * Math.sin(phase)), y = Math.round(41 + 7 * Math.cos(phase));
  const sprite = draw(width, height, [
    ellipse(x - 9, y - 9, 18, 18, '#202f40'), ellipse(x - 7, y - 7, 14, 14, '#dc957c'),
    ellipse(x - 4, y - 4, 8, 8, '#2e485d'), rect(x - 1, y - 1, 2, 2, pale),
    rect(x - 15, y - 1, 6, 3, '#a5babc'), rect(x + 9, y - 1, 6, 3, '#a5babc'),
    line([[x - 9, y + 11], [x + 10, y + 11]], '#698e9a'),
    ...[0, 1, 2, 3].map(i => rect((index * 2 + 29 * i) % 110, 56 + 5 * i, 13, 1, '#6a8d90'))
  ]);
  return raster.stack({ width, height, layers: [{ source: feed }, { source: sprite }] }).value;
}

const alternate = draw(72, 52, [
  rect(0, 0, 72, 52, '#342449'), rect(1, 1, 70, 50, '#483562'),
  text(6, 5, 'ION SCAN', '#d9c8f2'), ellipse(8, 13, 29, 32, '#624a88'),
  ellipse(12, 17, 21, 24, '#a885bc'), ellipse(15, 21, 15, 15, '#3e3163'),
  line([[22, 23], [42, 23], [49, 37], [66, 37]], '#b9dca8'),
  rect(47, 15, 17, 3, '#badba8'), rect(47, 16, 8, 2, '#e0b8dd'),
  rect(47, 22, 12, 2, '#7aabd0'), rect(47, 27, 15, 2, '#b9dca8'),
  text(6, 42, 'BAND 02', '#c7b6e1')
]);
const frames = Array.from({ length: frameCount }, (_, i) => frameOfFeed(i));
const graphNodes = {
  current: { op: 'anim.frame', inputs: { frames: { input: 'frames' }, options: { value: { fps } } } },
  earlier: { op: 'anim.frame', inputs: { frames: { input: 'frames' }, options: { value: { fps, delay: 6 / fps } } } },
  banks: { op: 'data.record', inputs: { replay: { node: 'earlier' }, alternate: { input: 'alternate' } } }
};
const names = ['neighbor', 'replay', 'feed'];
for (const name of names) {
  const options = name + 'Options';
  graphNodes[options] = { op: 'data.record', inputs: { blocks: { input: name } } };
  graphNodes[name] = { op: 'fx.blockSubstitute', inputs: { source: { node: 'current' },
    banks: { node: 'banks' }, options: { node: options } } };
}
const session = graph.create({
  inputs: { frames: 'array<raster>', alternate: 'raster', neighbor: 'array<record>', replay: 'array<record>', feed: 'array<record>' },
  nodes: graphNodes, outputs: Object.fromEntries(['current', ...names].map(name => [name, { node: name }]))
});
const plate = draw(sheetWidth, sheetHeight, [
  rect(0, 0, sheetWidth, sheetHeight, '#141e2b'), rect(16, 12, 3, 15, orange),
  text(25, 12, 'BLOCK SUBSTITUTION', pale, 2),
  ...['ORIGINAL', 'NEIGHBOR BLOCK', 'EARLIER FRAME', 'OTHER FEED'].map((label, i) =>
    text(left[i], 34, label, i ? orange : mint)),
  ...left.map(x => rect(x - 1, top - 1, width + 2, height + 2, '#476776')),
  ...['FRAME', 'COPY FROM 12 32', 'FRAME MINUS 6', 'ION SCAN BANK'].map((label, i) => text(left[i], 140, label, dim))
]);
const edges = (x, y, w, h) => [
  line([[x, y + 4], [x, y], [x + 4, y]], pale),
  line([[x + w - 5, y + h - 1], [x + w - 1, y + h - 1], [x + w - 1, y + h - 5]], pale)
];

function frame(index) {
  const active = index >= 8 && index < 40;
  const hop = Math.floor((index - 8) / 8) % 2 * 6;
  const lists = [
    [{ rect: [64, 21 + hop, 31, 29], from: [12, 32] }],
    [{ rect: [39 + hop, 24, 61, 32], bank: 'replay' }],
    [{ rect: [60, 31 + hop, 52, 32], from: [7, 14], bank: 'alternate' }]
  ].map(list => active ? list : []);
  const [neighbor, replay, other] = lists;
  const { outputs } = session.evaluate({ frames, alternate, neighbor, replay, feed: other }, { time: index / fps });
  const labels = draw(sheetWidth, sheetHeight, [
    text(left[0], 151, String(index).padStart(2, '0'), pale),
    ...lists.flatMap((blocks, i) => blocks.flatMap(({ rect: [x, y, w, h] }) => edges(left[i + 1] + x, top + y, w, h)))
  ]);
  return raster.stack({ width: sheetWidth, height: sheetHeight, layers: [
    { source: plate }, ...['current', ...names].map((name, i) => ({ source: outputs[name], x: left[i], y: top })),
    { source: labels }
  ] }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/block-substitution.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
for (let index = 0; index < frameCount; index++) {
  const { width, height, data } = frame(index);
  fs.writeFileSync(path.join(directory, 'blocks-' + String(index).padStart(3, '0') + '.png'), PNG.encode(width, height, data, 4));
}
