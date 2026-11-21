const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { deflateSync } = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');

const version = 121092;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const ref = (from_node, from_index = 0, from_tag = 0) => ({ from_node, from_index, from_tag, r: { d: -4 } });
const saved = (d, properties = {}) => ({ ...properties, r: { d } });
const key = (frame, value, incoming = 0, outgoing = 0) =>
  [[0, frame], value, [0, 1], [0, 0], incoming, outgoing, 1, 0, 16777215];
const track = (keys, properties = {}) => ({ anim: 1, r: keys, ...properties });
const node = (id, type, bySlot, fields = {}) => ({
  id, type: 'Node_' + type, version, inputs: Object.assign([], bySlot), ...fields
});
const rgba = (r, g, b, a = 255) => [r, g, b, a];
const red = rgba(250, 0, 0), green = rgba(0, 250, 0), blue = rgba(0, 0, 250), yellow = rgba(250, 250, 0);
const pixels = values => Uint8Array.from(values.flat());
const preview = (data, width, height) =>
  JSON.stringify({ width, height, format: 6, buffer: deflateSync(data).toString('base64') });

function pxc(nodes, fields = {}, thumbnail) {
  const prefix = Buffer.alloc(thumbnail ? 16 : 8);
  prefix.write('PXCX');
  prefix.writeUInt32LE(prefix.length + (thumbnail?.length ?? 0), 4);
  if (thumbnail) {
    prefix.write('THMB', 8);
    prefix.writeUInt32LE(thumbnail.length, 12);
  }
  const body = { version, versions: '1.22.10.2', animator: { framerate: 12, frames_total: 24 },
    attributes: { surface_dimension: [6, 2], color_depth: 1, interpolate: 0 }, nodes, ...fields };
  return Buffer.concat([prefix, ...(thumbnail ? [thumbnail] : []), deflateSync(JSON.stringify(body) + '\0')]);
}

function folder(t) {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-pxc-'));
  t.after(() => fs.rmSync(result, { force: true, recursive: true }));
  return result;
}

const translate = (bytes, file) => ink.createGraphHost().importPxc(bytes, { translate: true, file });

test('the CLI translates saved PXC slots into portable raster, colour, transform and timing nodes', t => {
  const dir = folder(t);
  const image = path.join(dir, 'strip.png');
  fs.writeFileSync(image, PNG.encode(4, 1, pixels([red, green, blue, yellow]), 4));
  const savedPreview = pixels([rgba(15, 45, 95), rgba(5, 8, 20, 80)]);
  const source = path.join(dir, 'art.pxc'), output = path.join(dir, 'ink.json');
  fs.writeFileSync(source, pxc([
    node(800, 'Export', { 0: ref('composite'), 1: saved('/unused/export/path') }),
    node('composite', 'Blend', { 0: ref('paper'), 1: ref('scale'), 3: ref('keys'), 14: saved([.5, .5], { unit: 1 }) }),
    node('input', 'Image', { 0: saved('strip.png') }),
    node('flip', 'Flip', { 0: ref('input'), 1: saved(1) }),
    node('crop', 'Crop', { 0: ref('flip'), 1: saved([.25, 0, 0, 0], { unit: 1 }) }),
    node('invert', 'Invert', { 0: ref('crop'), 4: saved(1) }),
    node('scale', 'Scale', { 0: ref('invert'), 2: saved(1), 3: saved([6, 2]), 4: saved(true) }, { attri: { interpolate: 1 } }),
    node('paint', 'Color', { 0: saved(0xff201008) }),
    node('paper', 'Solid', { 0: saved([1, 1], { attri: { use_project_dimension: 1 } }), 1: ref('paint') }),
    node('keys', 'Number_Simple', { 0: track([key(0, 0), key(6, .5), key(12, 1, 2)]) })
  ], { preview: preview(savedPreview, 2, 1) }));
  const invoke = (...args) => spawnSync(process.execPath, [cli, 'graph', ...args], { encoding: 'utf8', cwd: dir });
  const imported = invoke('import-pxc', source, '--translate', '--out', output, '--json');
  assert.equal(imported.status, 0, imported.stderr);
  const receipt = JSON.parse(imported.stdout);
  assert.equal(receipt.complete, true, JSON.stringify(receipt));
  assert.equal(receipt.translated.length, 10);
  assert.deepEqual(receipt.timeline, { fps: 12, frames: 24 });
  assert.deepEqual(receipt.targets, [{ id: 800, output: 'image' }]);
  assert.equal(receipt.savedPreview.output, 'saved-preview');
  assert.equal(invoke('import-pxc', source, '--translate', '--using', 'other', '--out', output).status, 1);
  const overwrite = invoke('import-pxc', source, '--translate', '--out', image);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /separate from its inputs/);


  // The source PNG can move after import because the graph contains its pixels.
  fs.renameSync(image, path.join(dir, 'moved-strip.png'));
  const graph = ink.readGraphProject(output);
  assert.deepEqual(Array.from(graph.run().outputs.image.data), Array(12).fill([8, 16, 32, 255]).flat());
  const middle = graph.run({ time: .5 }).outputs.image;
  const hold = graph.run({ time: .75 }).outputs.image;
  assert.deepEqual(hold, middle);
  assert.deepEqual(Array.from(middle.data.slice(0, 4)), [7, 133, 16, 255]);
  const full = graph.run({ time: 1 }).outputs;
  assert.deepEqual(Array.from(full.image.data.slice(0, 24)), [
    ...rgba(5, 250, 0), ...rgba(5, 250, 0), ...rgba(255, 0, 250), ...rgba(255, 0, 250),
    ...rgba(255, 250, 0), ...rgba(255, 250, 0)
  ]);
  assert.deepEqual(Array.from(full['saved-preview'].data), Array.from(savedPreview));
  const run = invoke('run', output, '--at', '1', '--out', 'review');
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(PNG.raster(path.join(dir, 'review/artifacts/saved-preview.png')).data, savedPreview);
});

test('native translation samples pixel-position keys and synchronous frame counters', async t => {
  const dir = folder(t);
  const source = path.join(dir, 'motion.pxc'), image = path.join(dir, 'mark.png');
  fs.writeFileSync(image, PNG.encode(2, 1, pixels([red, rgba(0, 0, 0, 0)]), 4));
  const bytes = pxc([
    node(9, 'Image', { 0: saved('mark.png') }),
    node('motion', 'Transform', { 0: ref(9), 1: saved([4, 1]), 2: track([key(0, [0, 0]), key(6, [2, 0])], { unit: 0 }),
      3: saved([0, 0]), 9: saved(1) }),
    node('count', 'Counter', { 0: saved(5), 1: saved(2) }),
    node('progress', 'Counter', { 2: saved(1) }),
    node('linear-scale', 'Scale', { 0: ref(9), 1: saved(2) }, { attri: { interpolate: 2 } })
  ], { animator: { framerate: 12, frames_total: 7 } });
  fs.writeFileSync(source, bytes);
  const { project, report } = await translate(bytes, source);
  assert.equal(report.complete, true, JSON.stringify(report));
  const graph = ink.createGraphProject(project);
  const a = graph.run({ time: 0 }).outputs, b = graph.run({ time: .25 }).outputs;
  assert.deepEqual(Array.from(a['partial-pxc-2'].data), [...red, ...Array(12).fill(0)]);
  assert.deepEqual(Array.from(b['partial-pxc-2'].data), [...Array(4).fill(0), ...red, ...Array(8).fill(0)]);
  assert.equal(a['partial-pxc-3'], 5);
  assert.equal(b['partial-pxc-3'], 11);
  assert.equal(b['partial-pxc-4'], .5);
  assert.deepEqual(Array.from(b['partial-pxc-5'].data.slice(4, 8)), [188, 0, 0, 191]);
});

test('partial conversion identifies blocked and unsupported source IDs and retains the saved preview', async () => {
  const savedArt = pixels([green]);
  const { project, report } = await translate(pxc([
    node('solid', 'Solid', { 0: saved([2, 2]), 1: saved(0xff008080) }),
    node(42, 'Shader', { 0: ref('solid') }),
    node('after-shader', 'Invert', { 0: ref(42) }),
    node('export', 'Export', { 0: ref('after-shader') }),
    node('bad-port', 'Flip', { 0: ref('solid', 1000) }),
    node('dangling', 'Scale', { 0: ref('deleted') }),
    node('looped-value', 'Number_Simple', { 0: track([key(0, 0), key(6, 1)], { on_end: 1 }) }),
    node('first-cycle', 'Invert', { 0: ref('second-cycle') }),
    node('second-cycle', 'Invert', { 0: ref('first-cycle') })
  ], { preview: preview(savedArt, 1, 1) }));
  assert.equal(report.complete, false);
  assert.deepEqual(report.unsupported.map(({ id, reason }) => [id, reason]), [
    [42, 'unsupported-node'], ['bad-port', 'unsupported-setting'], ['dangling', 'missing-source'],
    ['looped-value', 'unsupported-setting'], ['second-cycle', 'cycle']
  ]);
  assert.deepEqual(report.blocked.map(({ id, dependsOn }) => [id, dependsOn]), [
    ['after-shader', 42], ['export', 'after-shader'], ['first-cycle', 'second-cycle']
  ]);
  const result = ink.createGraphProject(project).run().outputs;
  assert.deepEqual(Object.keys(result), ['partial-pxc-1', 'saved-preview']);
  assert.deepEqual(Array.from(result['saved-preview'].data), Array.from(savedArt));

  const old = await translate(pxc([node('legacy', 'Solid', { 0: saved([2, 2]) })],
    { version: 10, preview: preview(savedArt, 1, 1) }));
  assert.equal(old.report.unsupported[0].reason, 'unsupported-version');
  assert.deepEqual(ink.createGraphProject(old.project).run().outputs['saved-preview'].data, [...green]);
});

test('native translation fences PNG dependencies and can keep a thumbnail after corrupt saved art', async t => {
  const dir = folder(t), sub = path.join(dir, 'sub'), file = path.join(sub, 'asset.pxc');
  fs.mkdirSync(sub);
  const outside = path.join(dir, 'outside.png');
  fs.writeFileSync(outside, PNG.encode(1, 1, pixels([blue]), 4));
  fs.symlinkSync(outside, path.join(sub, 'alias.png'));
  const thumbnail = deflateSync(pixels([blue]));
  const bytes = pxc([
    node('parent', 'Image', { 0: saved('../outside.png') }),
    node('symlink', 'Image', { 0: saved('alias.png') }),
    node('url', 'Image', { 0: saved('https://example.com/outside.png') }),
    node('here', 'Solid', { 0: saved([2, 1]) })
  ], { preview: '{broken' }, thumbnail);
  fs.writeFileSync(file, bytes);
  const { project, report } = await translate(bytes, file);
  assert.deepEqual(report.unsupported.map(row => row.reason), Array(3).fill('unsupported-asset'));
  assert.deepEqual(report.translated.map(row => row.id), ['here'], JSON.stringify(report));
  assert.equal(typeof report.artError, 'string');
  assert.equal(report.savedPreview.kind, 'thumbnail');
  assert.deepEqual(ink.createGraphProject(project).run().outputs['saved-preview'].data, [...blue]);
});
