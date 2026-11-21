const fs = require('node:fs');
const path = require('node:path');
const studio = require('..');
const PNG = require('../cli/png.js');
const { KIT, makeBuilder, makeSculpt } = studio.load();
const { drawing2d, pixelEffects, raster } = KIT.procedural;

const width = 136, height = 64, fps = 12, duration = 4;
const sheetWidth = 456, sheetHeight = 218, positions = [16, 160, 304], rows = [48, 133];
const tileSize = [8, 8], textColor = '#fae9d1', dim = '#8aa2ae', coral = '#ffae90';
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const shape = (points, fill) => ({ type: 'polygon', points, fill });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', text: label, at: [x, y], color, scale });
const line = (points, color) => ({ type: 'path', points, color, width: 1 });

function glyphPlate() {
  const gold = '#e9b965', bright = '#ffe3a0';
  const commands = [rect(0, 0, width, height, '#232031'), rect(0, 0, width, 8, '#44323a'),
    rect(0, 56, width, 8, '#44323a'), text(4, 0, 'CHANNEL / 07', gold),
    text(4, 56, 'SHIP TO SHORE', gold), text(11, 21, 'RELAY 07', bright, 2)];
  for (let x = 8; x < width; x += 8) {
    commands.push(rect(x, 15, 1, 1, '#a17158'), rect(x, 45, 1, 1, '#a17158'));
    commands.push(rect(x, 49, 4, 2, x % 16 ? '#865656' : gold));
  }
  return draw(width, height, commands);
}

function spriteBank() {
  const color = ['#7552a1', '#ce6689', '#56bfae', '#bda6da'];
  const commands = [rect(0, 0, 112, height, '#281d40')];
  for (let i = 0; i < 4; i++) {
    const x = 4 + 26 * i, y = 8 + (i % 2) * 14;
    commands.push(rect(x, 4, 20, 55, '#352852'), ellipse(x - 1, y, 26, 24, '#4a356e'),
      shape([[x, y + 15], [x + 5, y + 2], [x + 19, y + 4], [x + 23, y + 18],
        [x + 11, y + 29]], color[i]), ellipse(x + 5, y + 8, 12, 11, '#232641'),
      rect(x + 10, y + 9, 3, 4, '#f4e7ba'), line([[x + 8, y + 21], [x + 9, y + 38], [x + 19, y + 47]], '#74cebc'));
    for (let j = 0; j < 5; j++) commands.push(rect(x + j * 4, 53, 2, 3, color[(i + j) % 4]));
  }
  return draw(112, height, commands);
}

function chart() {
  const mint = '#559d9a';
  const commands = [rect(0, 0, width, height, '#102a31'), rect(0, 0, width, 8, '#25464a'),
    rect(0, 56, width, 8, '#25464a'), text(4, 0, 'DEPTH / NORTH', '#aad2bd'), text(4, 56, 'APPROACH MAP', '#aad2bd')];
  for (let x = 8; x < width; x += 8) {
    for (let y = 8; y < 56; y += 8) commands.push(rect(x, y, 1, 1, '#3f6766'));
  }
  for (let i = 0; i < 4; i++) {
    const y = 12 + i * 8;
    commands.push(line([[0, y + 12], [29, y + 6], [43, y + 9], [67, y - 2], [92, y + 2], [111, y - 4], [135, y + 1]], mint));
  }
  commands.push(ellipse(86, 25, 14, 14, '#417c76'), ellipse(89, 28, 8, 8, '#c5baa2'));
  return draw(width, height, commands);
}

function cameraBank() {
  const w = 112, h = 64;
  const B = makeBuilder(17, [0x1f152b, 0x52314f, 0x855779, 0xcf7886, 0xe7ab95, 0xf8dcc3, 0x9e87cb]);
  const S = KIT.sculpt(makeSculpt(B));
  Object.assign(S, { pixel: true, amb: .48, sky: .28, sun: KIT.V.norm([-.4, .74, .58]) });
  const stone = { r: [1, 2, 3] }, light = { r: [4, 5], em: true };
  S.box([0, -.15, 0], [3.4, .15, 1.5], stone, { res: .14 });
  for (const [x, z, towerHeight] of [[-2, -.2, 1], [-1.06, .14, 2.2], [1.06, .14, 2.2], [2, -.2, 1]]) {
    S.box([x, towerHeight / 2, z], [.2, towerHeight / 2, .3], stone, { res: .086, rd: .035 });
    S.box([x, towerHeight * .82, z + .3], [.12, .14, .04], light, { res: .048 });
  }
  S.tube(Array.from({ length: 41 }, (_, index) => {
    const a = index * Math.PI / 20;
    return [.94 * Math.cos(a), 1.84 + .94 * Math.sin(a), .21];
  }), .056, .056, light, { res: .064 });
  S.ball([0, 1.84, -.32], .55, { r: [6, 3, 4] }, { res: .084 });
  S.bake();
  const world = B.finish({ radius: 4, detail: 25, dither: .12, look: { splatCoverage: 'continuous' } });
  const atlas = studio.createCameraAtlas({ width: w, height: h, views: [{
    id: 'gate', rect: [0, 0, w, h], fps,
    frame: ({ time }) => ({
      camera: { target: [0, 1.28, 0], dist: 5.75, fov: .61, pitch: .15,
        yaw: .44 * Math.sin(time * Math.PI / 2) }
    })
  }] });
  return {
    at(time) {
      atlas.capture(world, { time });
      const { rgba } = atlas.read('gate');
      return { width: w, height: h, channels: 4, data: rgba };
    },
    dispose() { atlas.dispose(); }
  };
}

const plate = draw(sheetWidth, sheetHeight, [
  rect(0, 0, sheetWidth, sheetHeight, '#141a26'), rect(16, 13, 3, 15, coral),
  text(25, 13, 'CROSS-BANK TILE BLEED', textColor, 2),
  ...['DESTINATION', 'DONOR BANK', 'COMPOSITE'].map((label, i) => text(positions[i], 35, label, i === 2 ? coral : dim)),
  ...rows.flatMap(y => positions.flatMap(x => [
    rect(x - 1, y - 1, width + 2, height + 2, '#40495b'), rect(x, y, width, height, '#0b1320')
  ])),
  text(positions[0], 117, 'GLYPH DISPLAY', dim), text(positions[1], 117, 'SPRITE ATLAS', dim),
  text(positions[0], 202, 'HARBOR MAP', dim), text(positions[1], 202, 'LIVE CAMERA', dim)
]);
const mask = draw(width, height, [rect(16, 8, width - 32, height - 16, '#ffffff')]);
const glyph = glyphPlate(), sprites = spriteBank(), map = chart();

function render(time, camera) {
  const { tileBleed } = pixelEffects;
  const layers = [{ source: plate }], labels = [];
  const inputs = [[glyph, sprites, 17], [map, camera.at(time), 41]];
  for (const [index, [source, bank, seed]] of inputs.entries()) {
    const y = rows[index];
    const { value, addresses } = tileBleed(source, bank, { tileSize, amount: .44, mask, rate: 3, seed, time });
    layers.push({ source, x: positions[0], y }, { source: bank, x: positions[1] + (width - bank.width) / 2, y },
      { source: value, x: positions[2], y });
    const count = addresses.data.reduce((sum, address) => sum + Number(address >= 0), 0);
    labels.push(text(positions[2], y + height + 5, count + ' FOREIGN TILES', coral));
  }
  layers.push({ source: draw(sheetWidth, sheetHeight, labels) });
  return raster.stack({ width: sheetWidth, height: sheetHeight, layers }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/cross-bank-tile-bleed.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
const camera = cameraBank();
try {
  for (let frame = 0; frame < duration * fps; frame++) {
    const { width, height, data } = render(frame / fps, camera);
    const file = path.join(directory, 'bleed-' + String(frame).padStart(3, '0') + '.png');
    fs.writeFileSync(file, PNG.encode(width, height, data, 4));
  }
} finally {
  camera.dispose();
}
