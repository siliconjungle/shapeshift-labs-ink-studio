'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const R = require('../../cli/render.js');
const files = require('../../cli/asset-files.js');
const example = require('./fixture.js');

function paint() {
  const width = 64, height = 36, pixels = new Uint8Array(width * height * 4);
  const word = ['11101010111', '01001010100', '01001010110', '01001010100', '01000100111'];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inset = Math.min(x, width - x - 1, y, height - y - 1), bolt =
      [5, 57].some(cx => [5, 30].some(cy => (cx - x) ** 2 + (cy - y) ** 2 < 5));
    const glyph = word[Math.floor((y - 13) / 2)]?.[Math.floor((x - 20) / 2)] === '1';
    const color = bolt || glyph ? [255, 206, 133] : inset === 2 ? [114, 173, 153] :
      (inset < 2 || x >= 16 && x <= 46 && y >= 10 && y <= 25) ? [28, 60, 64] :
        (11 * x + 13 * y) % 53 === 0 ? [87, 151, 137] : [63, 129, 122];
    pixels.set([...color, 255], (y * width + x) * 4);
  }
  return { width, height, pixels };
}

function run(directory) {
  const dir = path.resolve(directory), { KIT, makeBuilder } = ink.load(), api = KIT.meshTopology;
  const hollow = api.create(example.housing()), plaque = api.create(example.plaque());
  const plane = { id: 'section', revision: api.revision(hollow), plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    cap: { kind: 'triangles', material: 'cut' } };
  const knife = { id: 'trace', revision: api.revision(plaque), knife: { projection: example.projection, path: example.path } };
  const section = api.planCut(hollow, plane), cut = api.planCut(plaque, knife);
  assert.equal(section.pieces.length, 2);
  assert(section.pieces.every(piece => piece.boundary.paths.length === 2 && piece.caps.length > 0));
  assert(section.pieces.every(piece => api.inspect(piece.document).edges.every(edge => edge.uses.length === 2)));
  assert.equal(cut.pieces.length, 2);

  const materials = Object.entries(example.colors).map(([id, hex]) => ({ id, color: parseInt(hex.slice(1), 16),
    ...(id === 'marking' && { color: 0xffffff, texture: paint() }) }));
  function stage(documents, offsets, camera, dist) {
    const meshes = documents.map((doc, i) => {
      const span = offsets[i], moved = span.some(Boolean) ? api.edit(doc, { vertices: doc.vertices.map(row =>
        ({ id: row.id, position: KIT.V.add(row.position, span) })) }) : doc;
      return api.toSceneMesh(moved, { materials });
    });
    const world = makeBuilder(19, [0x14242e]).finish({ meshes, dither: 0, radius: 6,
      cam: { target: [0, 0, 0], dist, ortho: true, ...camera } });
    return ink.render(world, { w: 160, h: 105, px: 1, raw: true });
  }
  const v = { yaw: -.42, pitch: .27 }, top = { yaw: 0, pitch: 0 };
  const positive = section.pieces.find(piece => piece.document.vertices.some(row => row.position[2] > .1));
  const negative = section.pieces.find(piece => piece !== positive);
  const images = [
    stage([hollow], [[0, 0, 0]], v, 5.1),
    stage([positive.document, negative.document], [[-1.18, -.23, .68], [1.18, .23, -.68]], v, 6.7),
    stage([plaque], [[0, 0, 0]], top, 4.6),
    stage(cut.pieces.map(piece => piece.document), [[-.16, 0, 0], [.16, 0, 0]], top, 4.6)
  ];
  fs.mkdirSync(dir, { recursive: true });
  const save = (name, data) => files.json(path.join(dir, name + '.json'), data);
  for (const [id, source, request, result] of [['plane', hollow, plane, section], ['knife', plaque, knife, cut]]) {
    save(id + '-before', source);
    save(id + '-request', request);
    save(id + '-after', result.document);
    save(id + '-report', result.report);
    result.pieces.forEach((piece, i) => save(id + '-piece-' + (i + 1), piece.document));
  }
  const picture = R.grid(images.map(image => R.upscale(image, 3)), 2);
  PNG.write(path.join(dir, 'comparison.png'), picture.w, picture.h, picture.rgb);
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-cut');
