const assert = require('node:assert/strict');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/editable-material');
const at = name => path.join(out, name);
const size = 96;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function recess(distance, edge = 2) {
  return clamp(-distance / edge, 0, 1);
}

function outline(x, y) {
  return Math.max(Math.abs(x) - 40, Math.abs(y) - 39, (Math.abs(x) + Math.abs(y) - 71) / Math.SQRT2);
}

function relief(x, y) {
  const frame = outline(x, y);
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const inlay = Math.cos(angle * 6) * 4;
  const rim = Math.abs(radius - 31);
  const ring = recess(rim - 1.7);
  const pin = recess(Math.hypot(Math.abs(x) - 28, Math.abs(y) - 29) - 1.8);

  let petals = 0;
  for (let i = 0; i < 6; i++) {
    const turn = i * Math.PI / 3 - Math.PI / 2;
    const u = Math.cos(turn) * x + Math.sin(turn) * y;
    const v = Math.cos(turn) * y - Math.sin(turn) * x;
    const leaf = Math.hypot((u - 15) / 10.5, v / (5.7 - clamp(u - 16, -4, 6) * 0.20));
    const ridge = recess(leaf - 1, 0.28);
    const vein = recess(Math.abs(v + (u - 17) ** 2 * 0.024) - 1, 1) * recess(Math.abs(u - 17) - 6, 2);
    petals = Math.max(petals, ridge * (1 - vein * 0.32));
  }
  const crown = recess(radius - 5, 2);
  const halo = recess(Math.abs(radius - (25 + inlay)) - 1.2, 1);
  const bevel = recess(frame, 4);
  const bead = recess(Math.abs(frame + 7) - 1.4, 1.4);
  return { height: bevel * 4.3 + bead * 1.3 + petals * 3 + crown * 3.3 - ring * 0.7 + pin - halo * 0.32,
    bevel, pigment: petals * 22 + crown * 40 - ring * 22 - halo * 11 + bead * 7 };
}

function stamp() {
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = px - 47.5, y = py - 45.5, index = 4 * (py * size + px);
    const front = outline(x, y - 4) <= 0;
    if (outline(x, y) > 0) {
      if (front) rgba.set([43, 43, 43, 255], index);
      continue;
    }
    const { bevel, pigment } = relief(x, y);
    const nx = relief(x - 1, y).height - relief(x + 1, y).height;
    const ny = relief(x, y - 1).height - relief(x, y + 1).height;
    const light = (-0.44 * nx - 0.6 * ny + 1.65) / Math.hypot(nx, ny, 2);
    const fleck = (Math.imul(px + 7, 59743) ^ Math.imul(py + 3, 49171)) & 63;
    const mottling = Math.sin(x * 0.13 + y * 0.055) * 6 + Math.sin(y * 0.21 + x * 0.09) * 4;
    const value = clamp(Math.round((54 + bevel * 31 + light * 93 + pigment + mottling + (fleck > 61 ? 13 : 0)) / 9) * 9, 0, 255);
    rgba.set([value, value, value, 255], index);
  }
  return PNG.encode(size, size, rgba, 4);
}

const lagoon = ['#101e32', '#184956', '#397e81', '#85c7ad', '#f5ebbe'];
const orchid = ['#201830', '#423050', '#795072', '#b4849a', '#f4d3aa'];
const ember = ['#241727', '#612d3d', '#a24c48', '#e38c56', '#ffe3a1'];
const legacy = {
  format: 'ink-studio/graph-project', version: 1,
  inputs: { glaze: { type: 'array', default: lagoon } },
  assets: { ceramicPress: { format: 'png', file: 'ceramic-press.png' } },
  nodes: {
    press: { op: 'pngAsset', inputs: { name: 'ceramicPress' } },
    fire: { op: 'Kiln', inputs: { press: { node: 'press' }, glaze: { input: 'glaze' } } }
  },
  groups: {
    Kiln: {
      inputs: { press: 'raster', glaze: 'array' },
      nodes: { transfer: { op: 'color.gradient', inputs: {
        source: { input: 'press' }, ramp: { input: 'glaze' }, options: { channel: 'r' }
      } } },
      outputs: { fired: { node: 'transfer' } }
    }
  },
  outputs: { baseColor: { node: 'fire', port: 'fired' } },
  exports: { tile: { output: 'baseColor', format: 'png' } }
};
files.write(at('ceramic-press.png'), stamp());
files.json(at('legacy.json'), legacy);

const material = Ink.readMaterialGraph(at('legacy.json'), { id: 'bellflower' });
material.label = 'Bellflower press';
material.graph.nodes.fire.label = 'First firing';
material.controls.glaze.label = 'Glaze ramp';
material.instances.lagoon = { label: 'Lagoon', overrides: { glaze: lagoon } };
material.instances.kiln = { label: 'Orchid', overrides: { glaze: orchid } };
material.extensions = { 'demo.annotation': { press: 'six-petal stamp', zoom: 4 } };
const baseline = at('bellflower.material.json');
Ink.writeMaterialGraph(baseline, material);
const before = Ink.readMaterialGraph(baseline);
assert.deepEqual(before, material);

const editedLinkId = Object.keys(before.graph.links).find(id => before.graph.links[id].to.output === 'baseColor');
const controlLinkId = Object.keys(before.graph.links).find(id => before.graph.links[id].from.input === 'glaze');
const edited = structuredClone(before);
edited.graph.nodes.fire.label = 'Glaze firing';
edited.graph.links[editedLinkId].label = 'Approved base color';
edited.instances.kiln.label = 'Ember';
edited.instances.kiln.overrides.glaze = ember;
const review = at('review/bellflower.material.json');
const saved = Ink.writeMaterialGraph(review, edited, { baseDir: out });
const reopened = Ink.readMaterialGraph(review);
assert.deepEqual(reopened, saved);

function render(file, instance, name) {
  const [artifact] = Ink.readGraphProject(file, { instance }).run().artifacts;
  if (name) files.write(at(name + '.png'), artifact.bytes);
  return artifact.sha256;
}

const original = { lagoon: render(baseline, 'lagoon', 'lagoon'), kiln: render(baseline, 'kiln', 'orchid') };
const final = { lagoon: render(review, 'lagoon'), kiln: render(review, 'kiln', 'ember') };
assert.equal(original.lagoon, final.lagoon);
assert.notEqual(original.kiln, final.kiln);

const identities = document => [
  ...['nodes', 'links', 'inputs', 'outputs', 'groups'].map(key => [key, Object.keys(document.graph[key])]),
  ...['resources', 'controls', 'instances'].map(key => [key, Object.keys(document[key])])
];
assert.deepEqual(identities(before), identities(reopened));
files.json(at('receipt.json'), {
  id: reopened.id, version: reopened.version, graphIDs: Object.fromEntries(identities(reopened)),
  editedLinkId, controlLinkId, source: reopened.resources.ceramicPress.definition.file,
  labelBefore: before.graph.nodes.fire.label, labelAfter: reopened.graph.nodes.fire.label,
  original, final
});
console.log('Saved editable material and verified rendered instances in ' + out);
