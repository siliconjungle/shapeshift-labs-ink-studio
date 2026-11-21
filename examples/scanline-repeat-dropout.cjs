const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png');
const { KIT, makeBuilder } = ink.load();
const { drawing2d, raster } = KIT.procedural;

const width = 112, height = 84, top = 46, sheetWidth = 520, sheetHeight = 165;
const left = [16, 142, 268, 394];
const pale = '#f7daa7', soft = '#9ac3bb', dim = '#789ca8', orange = '#e99383';
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const shape = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', at: [x, y], text: label, color, scale });

function canalSignal() {
  const commands = [
    rect(0, 0, width, height, '#354155'), rect(0, 16, width, 14, '#566879'),
    rect(0, 30, width, 20, '#826d7e'), rect(0, 50, width, 34, '#314f61'),
    ellipse(59, 16, 34, 34, '#e99383'), ellipse(64, 22, 23, 22, '#f5bb91'),
    rect(58, 35, 38, 2, '#826d7e'), rect(58, 40, 38, 2, '#826d7e'),
    shape([[0, 51], [22, 44], [35, 49], [53, 40], [72, 47], [94, 44], [112, 51], [112, 56], [0, 56]], '#45636d'),
    rect(0, 53, 112, 1, '#90b4a0'),
    shape([[8, 65], [20, 50], [20, 39], [43, 39], [43, 51], [54, 65]], '#223546'),
    shape([[14, 64], [23, 52], [23, 42], [40, 42], [40, 54], [47, 64]], '#849d92'),
    rect(27, 18, 10, 41, '#233443'), rect(29, 20, 6, 39, '#d0ab8c'),
    rect(31, 25, 3, 28, pale),
    ellipse(27, 16, 10, 8, pale), rect(28, 22, 8, 3, '#e99383'),
    line([[33, 31], [46, 21], [58, 23], [58, 40]], '#d6b997'),
    line([[33, 34], [46, 25], [56, 26]], '#6ba2a1'),
    rect(8, 59, 44, 2, '#85b09a'), rect(71, 59, 26, 3, '#a5908b'),
    rect(0, 0, width, 13, '#263345'), text(5, 2, 'CANAL 06', pale), text(85, 2, 'LIVE', soft),
    rect(0, 73, width, 11, '#263345'), text(5, 75, 'EAST FEED', soft)
  ];
  for (const [x, y, w] of [[9, 67, 25], [65, 64, 26], [75, 69, 20], [44, 69, 16], [93, 57, 13]]) {
    commands.push(rect(x, y, w, 1, '#84a9a5'));
  }
  for (let x = 82; x < 107; x += 4) commands.push(rect(x, 78, 2, 2, x < 99 ? orange : dim));
  return draw(width, height, commands);
}

const feed = canalSignal();
const plate = draw(sheetWidth, sheetHeight, [
  rect(0, 0, sheetWidth, sheetHeight, '#152331'),
  rect(16, 12, 3, 15, orange), text(25, 12, 'SCANLINE REPEAT AND DROPOUT', pale, 2),
  ...['ORIGINAL', 'REPEAT', 'SKIP', 'DROPOUT'].map((label, i) => text(left[i], 34, label, i ? orange : soft)),
  ...left.flatMap(x => [rect(x - 1, top - 1, width + 2, height + 2, '#4e7580'),
    rect(x, top, width, height, '#101823')]),
  text(left[0], 137, 'INTACT FEED', soft),
  text(left[1], 137, 'DUPLICATE ROWS', soft),
  text(left[2], 137, 'SHIFT ROWS UP', soft),
  text(left[3], 137, 'CLEAR ROWS', soft)
]);
const builder = makeBuilder(8, [0x101823]);
const world = builder.finish({ radius: 3, cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
const source = { id: 'feed', type: 'composite', isolated: true, layer: {
  source: { w: width, h: height, rgba: feed.data }
} };
const editor = KIT.renderGraph.create({ passes: [source, { id: 'row-edit', type: 'distortion' }] });

function render(edits) {
  editor.update('row-edit', { rowEdits: edits });
  const frame = ink.render(world, { w: width, h: height, raw: true, px: 1, transparent: true, renderGraph: editor });
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data.set(frame.rgb.subarray(p * 3, p * 3 + 3), p * 4);
    data[p * 4 + 3] = frame.alpha[p];
  }
  return { width, height, channels: 4, data };
}

const positions = [0, 0, 25, 26, 29, 34, 40, 43, 30, 33, 39, 47, 51, 0, 0, 0];
function frame(tick) {
  const start = positions[tick], count = 6 + tick % 5;
  const panels = [feed, ...['repeat', 'skip', 'blank'].map(mode => start ? render([
    { mode, start, count },
    { mode, start: start + 17, count: 2 }
  ]) : feed)];
  const labels = start ? draw(sheetWidth, sheetHeight, left.slice(1).map(x =>
    text(x, 150, 'ROW ' + start + ' / ' + (count + 2) + ' LINES', dim))) : null;
  return raster.stack({ width: sheetWidth, height: sheetHeight,
    layers: [{ source: plate }, ...panels.map((source, i) => ({ source, x: left[i], y: top })),
      ...(labels ? [{ source: labels }] : [])]
  }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/scanline-repeat-dropout.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
for (let i = 0; i < 48; i++) {
  const image = frame(Math.floor(i / 3));
  const file = path.join(directory, 'scanline-' + String(i).padStart(3, '0') + '.png');
  fs.writeFileSync(file, PNG.encode(image.width, image.height, image.data, 4));
}
