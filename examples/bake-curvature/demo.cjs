const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');
const { runBakeJob } = require('../../cli/bake-jobs.js');
const { readTexture } = require('../../cli/texture-files.js');
const PNG = require('../../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/aster-relief');
const at = name => path.join(out, name);
const size = 256, span = 4.5, half = span / 2;
const clamp = n => Math.min(1, Math.max(0, n));
const mix = (a, b, t) => a + (b - a) * t;
function ridge(d, width) {
  const t = clamp(1 - Math.abs(d) / width);
  return t * t * (3 - 2 * t);
}

function relief(x, y) {
  const r = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const spoke = r * Math.sin(4 * angle);
  const outer = Math.max(Math.abs(x), Math.abs(y));
  return .11 * ridge(r - 1.28, .12) - .068 * ridge(r - 1.47, .089) +
    .046 * ridge(r - 1.62, .065) + .1 * ridge(r, .27) -
    .05 * ridge(r - .39, .089) + .1 * ridge(spoke, .14) * ridge(r - .69, .39) +
    .047 * ridge(outer - 2.09, .09) - .041 * ridge(outer - 1.96, .065);
}

function engraving(x, y) {
  const r = Math.hypot(x, y), angle = Math.atan2(y, x), quadrant = Math.PI / 2;
  const a = angle - Math.round(angle / quadrant) * quadrant;
  const leaf = Math.sin(3.6 * a);
  const contour = .87 + .24 * Math.cos(3.6 * a);
  const buds = Math.cos(24 * angle);
  return -.016 * ridge(r - contour, .032) * ridge(a, .71) -
    .014 * ridge(r - contour + .08, .026) * ridge(a, .65) +
    .016 * ridge(r - .55 - .05 * leaf * leaf, .039) * ridge(a, .66) +
    .017 * ridge(r - 1.76, .036) * ridge(1 - buds, .27) -
    .012 * ridge(r - 1.86, .028) * ridge(1 - buds, .18);
}

function scene() {
  const doc = document(), { gltf } = doc;
  const access = (values, type) => doc.accessor(Float32Array.from(values), type, { bounds: type === 'VEC3' });
  const indices = values => doc.accessor(Uint32Array.from(values), 'SCALAR');
  const points = [], uv = [], triangles = [], grid = 144;
  for (let v = 0; v <= grid; v++) for (let u = 0; u <= grid; u++) {
    const x = u / grid * span - half, y = half - v / grid * span;
    points.push(x, y, relief(x, y));
    uv.push(u / grid, v / grid);
    if (u && v) {
      const br = v * (grid + 1) + u, bl = br - 1, tr = br - grid - 1, tl = tr - 1;
      triangles.push(tl, bl, br, tl, br, tr);
    }
  }
  const plate = { attributes: { POSITION: access(points, 'VEC3'), TEXCOORD_0: access(uv, 'VEC2') },
    indices: indices(triangles) };
  const hood = { attributes: { POSITION: access([1.23,-1.88,.12, 1.88,-1.88,.12, 1.88,-1.23,.12, 1.23,-1.23,.12], 'VEC3') },
    indices: indices([0, 2, 1, 0, 3, 2]) };
  gltf.meshes = [{ name: 'Observatory relief', primitives: [plate, hood] }];
  gltf.nodes = [{ mesh: 0 }];
  gltf.scenes[0].nodes = [0];
  fs.writeFileSync(at('aster.glb'), doc.finish());

  const normal = new Uint16Array(size * size * 3), d = .001;
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    const x = (u + .5) / size * span - half, y = half - (v + .5) / size * span;
    const dx = (engraving(x - d, y) - engraving(x + d, y)) / (2 * d);
    const dy = (engraving(x, y + d) - engraving(x, y - d)) / (2 * d);
    const n = Math.hypot(dx, dy, 1);
    normal.set([dx, dy, 1].map(c => Math.round(65535 * (.5 + .5 * c / n))), (u + size * v) * 3);
  }
  fs.writeFileSync(at('engraving.png'), PNG.encodeMaterial(size, size, normal, 3));
}

function palette(values, scale, neutral, cold, hot) {
  const result = new Uint8Array(values.length * 3);
  for (const [i, value] of values.entries()) {
    const pole = value < 0 ? cold : hot, amount = clamp(Math.abs(value / scale)) ** .58;
    result.set(neutral.map((channel, k) => Math.round(mix(channel, pole[k], amount))), 3 * i);
  }
  return PNG.encode(size, size, result, 3);
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const save = (name, json) => fs.writeFileSync(at(name), JSON.stringify(json, null, 2) + '\n');
  scene();
  const maps = ['curvature', 'curvature-convex', 'curvature-concave'];
  for (const source of ['mesh', 'normal']) {
    const overrides = source === 'normal' ? { curvatureSource: source, normalInput: 'etching', curvatureScale: 1 } : {};
    save(source + '.preset.json', { format: 'ink-studio/bake-preset', version: 1,
      label: source === 'mesh' ? 'Sculpted relief' : 'Normal-map engraving', defaults: { size, padding: 0, exposureDistance: .30 },
      maps: [...maps.map((id, i) => ({ id, overrides: { ...overrides, encoding: i ? 'png16' : 'exr' } })),
        ...(source === 'mesh' ? [{ id: 'cavity', overrides: { samples: 16, cavityRadius: .30 } }] : [])] });
  }
  save('aster.bake.json', { format: 'ink-studio/bake-job', version: 1, label: 'Aster Relief',
    source: 'aster.glb', preset: 'mesh.preset.json', targets: [{ id: 'relief', mesh: 'Observatory relief', submeshes: [0] }],
    normalInputs: { etching: { file: 'engraving.png', space: 'tangent', orientation: 'opengl' } } });
  const images = {}, reviews = {}, sample = {};
  for (const source of ['mesh', 'normal']) {
    const result = await runBakeJob(at('aster.bake.json'), {
      directory: at(source), presetFile: at(source + '.preset.json')
    });
    const base = source + '/revisions/' + result.revision + '/';
    reviews[source] = base + 'index.html';
    for (const row of result.report.maps) {
      const file = base + row.file, preview = base + (row.previewFile ?? row.file);
      const gray = readTexture(at(file)).data;
      const key = row.map === 'cavity' ? 'cavity' : source + '-' + row.map;
      let image = preview;
      const idx = Math.floor(.845 * size) * size + Math.floor(.845 * size);
      if (key === 'mesh-curvature') sample.curvature = gray[idx];
      if (key === 'cavity') sample.cavity = gray[idx] / 255;
      if (row.map === 'curvature' || row.map === 'cavity') {
        const cavity = row.map === 'cavity';
        const strength = cavity ? 225 : row.curvature.peak * .38;
        image = key + '.png';
        const png = palette(gray, strength, [22, 43, 48], [82, 211, 216], cavity ? [220, 175, 131] : [249, 183, 95]);
        fs.writeFileSync(at(image), png);
      }
      images[key] = { file, image, output: row.output, curvature: row.curvature };
    }
  }
  if (sample.curvature !== 0 || sample.cavity < .3) throw new Error('The covered flat point needs zero curvature and visible cavity.');
  fs.writeFileSync(at('data.js'), 'const demo = ' + JSON.stringify({ images, reviews, sample }) + ';\n');
  fs.copyFileSync(path.join(__dirname, 'gallery.html'), at('index.html'));
  console.log(at('index.html'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
