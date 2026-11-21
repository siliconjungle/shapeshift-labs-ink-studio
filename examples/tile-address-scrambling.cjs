const fs = require('node:fs');
const path = require('node:path');
const studio = require('..');
const PNG = require('../cli/png.js');
const { KIT, makeBuilder, makeSculpt } = studio.load();
const { drawing2d, pixelEffects, raster } = KIT.procedural;

const width = 144, height = 64, fps = 12;
const tileSize = [8, 8];
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const polygon = (points, fill) => ({ type: 'polygon', points, fill });
const text = (x, y, value, color, scale = 1) => ({ type: 'text', text: value, at: [x, y], color, scale });
const gold = '#edd19d', rose = '#db7867', teal = '#80d6bb', dim = '#8095a5';

function fieldGuideSprite() {
  const commands = [
    rect(0, 0, width, height, '#10212b'),
    rect(0, 0, width, 8, '#182d37'),
    rect(0, 56, width, 8, '#182d37'),
    text(5, 0, 'NIGHT MOTH', gold),
    text(119, 56, 'R04', dim)
  ];
  for (let x = 8; x < width; x += 8) {
    for (let y = 8; y < 56; y += 8) commands.push(rect(x, y, 1, 1, '#36525a'));
  }
  function wing(points, color) {
    commands.push(polygon(points, color), polygon(points.map(([x, y]) => [144 - x, y]), color));
  }
  wing([[71, 38], [51, 17], [18, 10], [16, 18], [31, 33], [44, 33], [32, 41],
    [38, 49], [54, 53], [68, 46]], '#aa503f');
  wing([[70, 37], [49, 20], [22, 15], [33, 28], [54, 30], [49, 34], [39, 43], [48, 49],
    [61, 47]], '#ed9f6e');
  wing([[68, 40], [47, 23], [33, 20], [40, 27], [55, 28], [52, 32], [45, 42], [50, 45],
    [61, 43]], '#f2ce8e');
  for (const x of [37, 97]) {
    commands.push(ellipse(x, 22, 10, 7, '#513143'), ellipse(x + 3, 24, 4, 3, teal));
  }
  commands.push(polygon([[71, 18], [74, 18], [76, 30], [74, 48], [71, 49], [68, 36]], '#f5d79e'),
    rect(71, 23, 2, 23, '#876167'),
    { type: 'path', points: [[64, 14], [70, 22], [74, 22], [80, 14]], color: gold, width: 1 });
  return draw(width, height, commands);
}

function cameraFeed() {
  const B = makeBuilder(14, [0x0c1624, 0x1d394b, 0x365d72, 0x67929b, 0x82ceb1, 0xe5bd86, 0xd37060, 0xf2e3ab]);
  const S = KIT.sculpt(makeSculpt(B));
  Object.assign(S, { pixel: true, amb: .35, sky: .26, sun: KIT.V.norm([-.5, .8, .5]) });
  const body = { r: [1, 2, 3], fat: .45 }, green = { r: [3, 4], em: true }, amber = { r: [5, 7], em: true };
  S.box([0, -.12, 0], [4, .12, 2], body, { res: .19 });
  for (const [x, z, h] of [[-2.2, -.5, 1.08], [-1.02, .18, 1.76], [0, -.6, 2.6], [1.35, .12, 1.53], [2.28, -.57, 1.02]]) {
    S.box([x, h / 2, z], [.29, h / 2, .31], body, { res: .1, rd: .05 });
    for (let y = .25; y < h; y += .23) {
      S.box([x, y, z + .315], [.2, .026, .054], x > 0 ? amber : green, { res: .052, rd: .011 });
    }
  }
  S.tube(Array.from({ length: 33 }, (_, index) => {
    const a = index * Math.PI / 16;
    return [.77 * Math.cos(a), 2.23 + .77 * Math.sin(a), .02];
  }), .033, .033, amber, { res: .061 });
  S.bake();
  const world = B.finish({ radius: 5, detail: 24, dither: .17, look: { splatCoverage: 'continuous' } });
  const atlas = studio.createCameraAtlas({ width, height, views: [{
    id: 'relay', rect: [0, 0, width, height], fps,
    frame: ({ time }) => ({
      camera: { target: [0, 1.26, 0], dist: 5.9, fov: .62, pitch: .24, yaw: -.18 + .36 * Math.sin(time * Math.PI / 3) }
    })
  }] });
  return {
    at(time) {
      atlas.capture(world, { time });
      const { rgba } = atlas.read('relay');
      return { width, height, channels: 4, data: rgba };
    },
    dispose() { atlas.dispose(); }
  };
}

const modes = [{ mode: 'swap', amount: .47, color: teal }, { mode: 'repeat', amount: .51, color: gold },
  { mode: 'omit', amount: .32, color: rose }];
const widthSheet = 336, heightSheet = 218, left = 16, right = 176, top = 48, bottom = 133;
const plate = draw(widthSheet, heightSheet, [
  rect(0, 0, widthSheet, heightSheet, '#101722'), rect(16, 13, 3, 15, teal),
  text(25, 13, 'TILE ADDRESS FAULT', '#f1ecdb', 2),
  text(left, 35, 'ORIGINAL', dim), text(right, 35, 'SCRAMBLED', dim),
  ...[top, bottom].flatMap(y => [left, right].flatMap(x => [
    rect(x - 1, y - 1, width + 2, height + 2, '#39505c'), rect(x, y, width, height, '#0a121d')
  ])),
  text(left, 117, 'SPRITE / FIELD GUIDE', dim),
  text(left, 202, 'FEED / RELAY ARRAY', dim)
]);
const sprite = fieldGuideSprite();
const mask = draw(width, height, [rect(24, 8, 96, 48, '#ffffff')]);
const camera = cameraFeed();

function render(frame) {
  const time = frame / fps;
  const { mode, amount, color } = modes[Math.floor(time / 2)];
  const feed = camera.at(time);
  const options = { tileSize, mode, amount, rate: 3, time };
  const labels = [];
  const layers = [{ source: plate }, { source: sprite, x: left, y: top }, { source: feed, x: left, y: bottom }];
  for (const [source, y, seed, gate] of [[sprite, top, 52, mask], [feed, bottom, 4, undefined]]) {
    const { value, addresses } = pixelEffects.tileScramble(source, { ...options, seed, mask: gate });
    const changed = addresses.data.reduce((sum, address, index) => sum + Number(address !== index), 0);
    layers.push({ source: value, x: right, y });
    labels.push(text(right, y + height + 5, mode.toUpperCase() + '  /  ' + changed + ' TILES', color));
  }
  layers.push({ source: draw(widthSheet, heightSheet, labels) });
  return raster.stack({ width: widthSheet, height: heightSheet, layers }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/tile-address-scrambling.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
try {
  for (let frame = 0; frame < 6 * fps; frame++) {
    const { width, height, data } = render(frame);
    fs.writeFileSync(path.join(directory, 'tile-' + String(frame).padStart(3, '0') + '.png'), PNG.encode(width, height, data, 4));
  }
} finally {
  camera.dispose();
}
