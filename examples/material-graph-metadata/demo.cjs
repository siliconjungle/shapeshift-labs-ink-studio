const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-graph-metadata');
const at = name => path.join(directory, name);
const size = 72;
const variants = [
  {
    id: 'verdigris-enamel', label: 'Verdigris enamel', motif: 'sprig', author: 'Inkwell Tile Workshop',
    description: 'A brass sprig set into sea-green enamel. The worn rim catches light along the edge of a tiled wall.',
    tags: ['Ceramic', 'Inlay', 'Station'],
    intendedUse: 'Repeat on platform walls and ticket hall pilasters.', materialModel: 'pbr.metallic-roughness',
    physicalDimensions: { width: 14.4, height: 14.4, depth: .9, unit: 'cm' },
    visibility: { library: true, publication: 'public' },
    userData: { kilnBatch: 'G-18', review: { state: 'approved', colorway: 'coastal' } },
    colors: { dark: [15, 31, 34], glaze: [24, 76, 74], light: [90, 149, 131], inlay: [211, 151, 73], bright: [253, 223, 147] }
  },
  {
    id: 'cinder-ceramic', label: 'Cinder ceramic', motif: 'sun', author: 'Inkwell Tile Workshop',
    description: 'A wheel-shaped stamp in iron-red clay, with dark slip left in the recesses.',
    tags: ['Ceramic', 'Stamped', 'Station'],
    intendedUse: 'Use as an accent tile around hearths and service doors.', materialModel: 'pbr.metallic-roughness',
    physicalDimensions: { width: 18, height: 18, depth: 1.2, unit: 'cm' },
    visibility: { library: true, publication: 'unlisted' },
    userData: { kilnBatch: 'C-06', review: { state: 'internal', passes: ['glaze', 'relief'] } },
    colors: { dark: [39, 26, 35], glaze: [109, 52, 50], light: [182, 92, 68], inlay: [207, 127, 75], bright: [241, 184, 108] }
  },
  {
    id: 'ivory-slip', label: 'Ivory slip', motif: 'wave', author: 'Inkwell Tile Workshop',
    description: 'Blue slip flows over a pale ceramic body in three carved bands.',
    tags: ['Ceramic', 'Slip', 'Station'],
    intendedUse: 'Border tile for sinks, washstands and drinking fountains.', materialModel: 'pbr.metallic-roughness',
    physicalDimensions: { width: 160, height: 160, depth: 11, unit: 'mm' },
    visibility: { library: false, publication: 'public' },
    userData: { kilnBatch: 'I-04', review: { state: 'approved for archive' } },
    colors: { dark: [42, 52, 66], glaze: [164, 155, 122], light: [231, 217, 168], inlay: [57, 88, 112], bright: [122, 159, 163] }
  },
  {
    id: 'slate-trial', label: 'Slate trial', motif: 'weave', author: 'Inkwell Tile Workshop',
    description: 'A trial run of slate glaze with a shallow interlocking pattern.',
    tags: ['Ceramic', 'Trial'],
    intendedUse: 'Evaluate for the stair landing.', materialModel: 'stylized.palette',
    physicalDimensions: { width: 12, height: 12, unit: 'cm' },
    visibility: { library: false, publication: 'private' },
    userData: { kilnBatch: 'T-01', review: { state: 'draft' } },
    colors: { dark: [29, 33, 48], glaze: [67, 77, 105], light: [113, 118, 149], inlay: [137, 120, 157], bright: [184, 168, 186] }
  }
];

const blend = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * Math.max(0, Math.min(1, t))));
function tile(variant, col, row) {
  const x = col - 35.5, y = row - 35.5, ax = Math.abs(x), ay = Math.abs(y);
  const edge = Math.hypot(Math.max(ax - 29, 0), Math.max(ay - 29, 0));
  const { dark, glaze, light, inlay, bright } = variant.colors;
  const grain = ((Math.imul(col + 13, 10399) ^ Math.imul(row + 3, 7877)) & 31) / 31;
  let pigment = blend(glaze, light, .20 - (x + 1.3 * y) * .003 + .105 * grain);
  if (edge > 4.65) return dark;
  if (edge > 3.65) return x + y < 1 ? light : blend(dark, glaze, .32);
  if (edge > 1.3) return x + y < 0 ? blend(glaze, light, .46) : blend(dark, glaze, .92);
  if (edge > .52) return blend(inlay, dark, x + y < 2 ? .27 : .61);
  const corner = Math.abs(ax - 24) + Math.abs(ay - 23);
  if (corner < 2.4) return x + y < 0 ? inlay : blend(inlay, dark, .29);
  const r = Math.hypot(x, y);
  if (Math.abs(r - 25.5) < .45) pigment = blend(glaze, light, x + y < 2 ? .76 : .43);
  if (r > 24) return pigment;
  if (variant.motif === 'sun') {
    const tooth = Math.abs(Math.sin(Math.atan2(y, x) * 6));
    if (r < 8 || r > 9.9 && r < 20 - 6 * tooth) return blend(inlay, bright, .4 - y * .016 + grain * .11);
    if (r < 10.3) return blend(dark, glaze, .55);
  }
  if (variant.motif === 'wave') {
    for (const crest of [-11, 0, 11]) {
      const ridge = y - crest - 3.9 * Math.sin((x + 4) * .164);
      if (ridge >= -1.8 && ridge < 2) return ridge < -.5 ? bright : inlay;
      if (ridge >= 2 && ridge < 3.1) return blend(pigment, inlay, .27);
    }
  }
  if (variant.motif === 'weave') {
    const a = Math.abs((ax + ay + 3) % 10 - 5), b = Math.abs((x - y + 45) % 10 - 5);
    if (a < 1.15 || b < 1.15) return blend(inlay, bright, .14 + grain * .2);
  }
  if (variant.motif === 'sprig') {
    const stem = .011 * (y - 3) ** 2 - 1.5;
    if (y > -21 && y < 21 && Math.abs(x - stem) < .74) return bright;
    for (let pair = 0; pair < 6; pair++) {
      const root = 15 - pair * 5.25, span = 18 - pair * 1.95;
      for (const side of [-1, 1]) {
        const run = side * (x - (.011 * (root - 3) ** 2 - 1.5));
        if (run < 0 || run > span) continue;
        const ridge = root - run * (.29 + pair * .029) - (side === 1 ? 1.8 : 0);
        const width = (2.5 - pair * .23) * Math.sin(Math.PI * run / span);
        if (Math.abs(y - ridge) < width) return blend(inlay, bright, y < ridge ? .83 : .17);
      }
    }
  }
  return pigment;
}

const entries = variants.map(variant => {
  const { label, id, motif, colors, ...metadata } = variant;
  const data = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.push(...tile(variant, x, y));
  const document = Ink.openMaterialGraph({ format: 'ink-studio/graph-project', version: 1,
    nodes: { paint: { op: 'image.declare', inputs: { source: { width: size, height: size, channels: 3, data },
      descriptor: { intent: 'color', precision: 'unorm8' } } } },
    outputs: { paint: { node: 'paint' } },
    outputUsages: { tile: { usage: 'baseColor', label: 'Tile pigment', order: 0,
      format: { format: 'png', bitDepth: 8 }, source: { output: 'paint' } } }
  }, { id });
  const [image] = Ink.createGraphProject(document).run().artifacts;
  const file = 'graphs/' + id + '.material.json', thumbnail = 'thumbs/' + id + '.png';
  files.write(at(thumbnail), image.bytes);
  Ink.writeMaterialGraph(at(file), { ...document, label, metadata: { ...metadata,
    thumbnail: { file: '../' + thumbnail, alt: label + ' ceramic tile with a ' + motif + ' motif' } } });
  const sha256 = createHash('sha256').update(fs.readFileSync(at(file))).digest('hex');
  return { asset: 'station/' + id, revision: 1, kind: 'graph', file, sha256 };
});

const registry = at('registry.json');
files.json(registry, { format: 'ink-studio/asset-registry', version: 1, entries });
const local = audience => {
  const index = Ink.searchMaterialLibrary(registry, { audience });
  for (const item of index.items) {
    item.file = path.relative(directory, item.file);
    item.thumbnail.file = path.relative(directory, item.thumbnail.file);
  }
  return index;
};
const { file: publicationFile, ...publication } = Ink.publishMaterialLibrary(registry, { out: at('publication') });
for (const item of publication.items) item.thumbnail.file = 'publication/' + item.thumbnail.file;
const audiences = { library: local('library'), workspace: local('workspace'), publication };
files.write(at('data.js'), 'const library = ' + JSON.stringify(audiences) + ';\n');
files.write(at('demo.html'), fs.readFileSync(path.join(__dirname, 'demo.html')));
console.log(at('demo.html'));
console.log(publicationFile);
