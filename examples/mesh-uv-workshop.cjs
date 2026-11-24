// Enamel field case. The atlas and native model share retained face and corner IDs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('../index.js');
const PNG = require('../cli/png.js');
const Composite = require('../src/frame-composite.js');
const { capture } = require('../cli/mesh-uv-editor.js');

function fixture({ KIT: K }) {
  const vertices = [
    ['flb', [-1.4, -.84, .51]], ['frb', [1.4, -.84, .51]], ['frt', [1.4, .84, .51]], ['flt', [-1.4, .84, .51]],
    ['llb', [-2, -.84, .05]], ['llt', [-2, .84, .05]], ['rrb', [2, -.84, .05]], ['rrt', [2, .84, .05]],
    ['blb', [-2, -.84, -.62]], ['blt', [-2, .84, -.62]], ['brb', [2, -.84, -.62]], ['brt', [2, .84, -.62]]
  ].map(([id, position]) => ({ id, position }));
  const makeFace = (id, ids, uv, material = 'enamel') => ({
    id, material, corners: ids.map((vertex, i) => ({ id: id + '/' + vertex, vertex, uv: uv[i] }))
  });
  const uv = (u0, v0, u1, v1) => [[u0,v1],[u1,v1],[u1,v0],[u0,v0]];
  const faces = [
    makeFace('faceplate', ['flb','frb','frt','flt'], uv(.28,.27,.64,.57)),
    makeFace('left-wing', ['llb','flb','flt','llt'], uv(.12,.27,.28,.57)),
    makeFace('right-wing', ['frb','rrb','rrt','frt'], uv(.64,.27,.80,.57)),
    makeFace('left-wall', ['blb','llb','llt','blt'], uv(.035,.27,.12,.57)),
    makeFace('right-wall', ['rrb','brb','brt','rrt'], uv(.80,.27,.89,.57)),
    makeFace('lid', ['flt','frt','rrt','brt','blt','llt'],
      [[.30,.205],[.62,.205],[.68,.155],[.68,.065],[.24,.065],[.24,.155]]),
    makeFace('skid', ['frb','flb','llb','blb','brb','rrb'],
      [[.42,.94],[.12,.94],[.07,.89],[.07,.83],[.47,.83],[.47,.89]]),
    makeFace('rear', ['brb','blb','blt','brt'], uv(.10,.655,.42,.76))
  ];
  const doc = K.meshTopology.create({ id: 'field-case', vertices, faces });
  const width = 100, height = 80, pixels = new Uint8Array(width * height * 4);
  const shades = [[31,61,66], [42,79,82], [54,96,97], [38,69,78], [51,84,92]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const zone = x < 12 ? 0 : x < 28 ? 1 : x < 64 ? 2 : x < 80 ? 3 : 4;
    const stripe = y >= 21 && y <= 46 && (y === 21 || y === 23 || y >= 44);
    const badges = x >= 66 && x <= 79 && y >= 33 && y <= 44 && (x + y) % 7 <= 2;
    const checks = y >= 48 && ((Math.floor(x / 5) + Math.floor(y / 4)) & 1) === 0;
    let color = shades[zone].map(n => n + (checks ? 14 : 0) + ((x * 17 + y * 31) % 11 === 0 ? 6 : 0));
    if (stripe || badges) color = [207,166,99];
    if (x >= 29 && x < 63 && y >= 28 && y < 41) color = [24,49,58];
    if ([[30,25],[61,25],[30,42],[61,42]].some(([a,b]) => a === x && b === y)) color = [247,215,139];
    pixels.set([...color,255], (y * width + x) * 4);
  }
  const { chars, per, font } = K.ascii.atlas();
  for (const [i, ch] of [...'FIELD'].entries()) {
    const glyph = chars.indexOf(ch), u = glyph % per * 6, v = Math.floor(glyph / per) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++)
      if (font.data[(v + y) * font.w + u + x]) pixels.set([231,211,154,255], ((y + 30) * width + x + 31 + i * 6) * 4);
  }
  const view = { w: 232, h: 184, camera: { yaw: .49, pitch: .31, dist: 7.4, ortho: true },
    materials: [{ id: 'enamel', texture: { width, height, pixels: Array.from(pixels) } }] };
  const seam = id => K.meshTopology.uv.inspect(doc).edges.find(row =>
    row.sides.length === 2 && row.sides.some(side => side.face === 'faceplate') && row.sides.some(side => side.face === id)).id;
  const cut = { revision: K.meshTopology.revision(doc), operations: [
    { op: 'cut', ids: [seam('left-wing'), seam('right-wing')] },
    { op: 'pin', ids: ['faceplate/flb','faceplate/frt'], pinned: true },
    { op: 'transform', ids: ['left-wall'], translate: [.369,.295], rotation: -.145, scale: .62 },
    { op: 'transform', ids: ['right-wall'], translate: [.061,.382], rotation: .27, scale: .64 }
  ] };
  const stitch = { operations: [{ op: 'stitch', ids: [seam('left-wing')], mode: 'align', keepFace: 'faceplate' }] };
  return { doc, view, cut, stitch, seam };
}

function run(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const kit = ink.load(), { KIT: K } = kit, data = fixture(kit), UV = K.meshTopology.uv;
  const write = (name, value) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    return file;
  };
  const raw = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname,'../cli/ink-studio.js'), 'mesh-uv', ...args],
    { encoding: 'utf8', stdio: ['ignore','pipe','inherit'] }));
  const model = write('field-case.json', data.doc), view = write('view.json', data.view);
  const clean = capture(data.doc, { ...data.view, t: 0, raw: true }, kit);
  const map = UV.modelFaces(clean.mesh, clean.frame), side = map.faces.indexOf('right-wing');
  if (side < 0) throw new Error('The right wing needs to be visible in the native camera');
  const pixels = Array.from(map.faceAt, (face, i) => face === side ? i : -1).filter(i => i >= 0);
  const at = pixels[Math.floor(pixels.length / 2)], pixel = [at % data.view.w, Math.floor(at / data.view.w)];
  const query = write('model-query.json', { domain: 'faces', model: { pixel } });
  const atlasQuery = write('atlas-query.json', { domain: 'faces', atlas: { at: [.72,.42], material: 'enamel' } });
  const selected = path.join(directory, 'selection.json');
  cli('select', model, query, '--view', view, '--out', selected);
  const fromAtlas = cli('select', model, atlasQuery);
  if (JSON.stringify(raw('selection.json').ids) !== JSON.stringify(fromAtlas.ids))
    throw new Error('Atlas and model picks need the same stable face ID');
  const cut = path.join(directory, 'cut.json'), cutReport = path.join(directory,'cut-report.json');
  const moved = path.join(directory, 'cut-preview'), joined = path.join(directory, 'stitch-preview');
  cli('edit', model, write('cut-request.json', data.cut), '--view', view, '--selection', selected,
    '--preview', moved, '--report', cutReport, '--out', cut);
  const restored = path.join(directory,'stitched.json'), cutDoc = raw('cut.json');
  const nextSelection = write('selection-after-cut.json', UV.select(cutDoc,{domain:'faces',ids:fromAtlas.ids}));
  cli('edit', cut, write('stitch-request.json', { revision: K.meshTopology.revision(cutDoc), ...data.stitch }),
    '--view', view, '--selection', nextSelection, '--preview', joined, '--report', path.join(directory,'stitch-report.json'), '--out', restored);

  const gap = 6, left = 14, top = 48, { w, h } = data.view, width = (h + gap) * 3 + left * 2 - gap;
  const height = top + 2 * (h + gap) + 26, draw = [], layers = [];
  const caption = (text, x, y, size = 9, color = '#dce8ee') => draw.push({ type: 'text', text, at: [x,y], size, color });
  caption('Field case UV edit', width / 2, 16, 13);
  const states = [[moved,'before'],[moved,'after'],[joined,'after']];
  for (const [i, [dir, state]] of states.entries()) {
    const x = left + i * (h + gap);
    caption(['Original atlas','Cut, pin and move','Stitch left wing'][i], x + h / 2, 34);
    for (const [r, kind] of ['atlas','model'].entries()) {
      const image = PNG.raster(fs.readFileSync(path.join(dir, kind + '-' + state + '.png')));
      const crop = r ? Math.floor((w - h) / 2) : 0;
      const cropped = new Uint8Array(h * h * 4);
      for (let y = 0; y < h; y++) cropped.set(image.data.subarray((y * image.w + crop) * 4,
        (y * image.w + crop + h) * 4), y * h * 4);
      layers.push({ source: { w: h, h, rgba: cropped }, rect: [x, top + r * (h + gap), h, h] });
    }
  }
  caption('Cut seam', width * .18, height - 14, 9, '#f391a6');
  caption('Pinned corner', width * .5, height - 14, 9, '#ffcb78');
  caption('Linked right-wing selection', width * .81, height - 14, 9, '#75e2c8');
  const plan = K.frameComposite.prepare({ layers: [...layers,{draw}] }, width, height, 1);
  const sheet = Composite.compose({ w: 1, h: 1, rgb: Uint8Array.of(12,22,31) },
    K.frameComposite.layers(plan,{},0), width,height,'nearest');
  PNG.write(path.join(directory,'comparison.png'), width,height,sheet.rgb);
  console.log(directory);
}

module.exports = { fixture };
if (require.main === module) run(path.resolve(process.argv[2] ?? 'studio/out/mesh-uv-workshop'));
