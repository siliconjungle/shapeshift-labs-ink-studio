const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');

const recipes = path.resolve(__dirname, '../examples/starter-recipes');
const open = id => ink.readGraphProject(path.join(recipes, id, 'graph.json'));

test('the sprite previews a new light while keeping its atlas colour and normals registered', () => {
  const project = open('relightable-sprite');
  const left = project.run().outputs;
  const right = project.run({ inputs: { lightDirection: [.96, .27, .48] } }).outputs;
  assert.notDeepEqual(left.preview.data, right.preview.data);
  assert.deepEqual(left.atlas, right.atlas);
  const { metadata, images } = left.atlas;
  assert.equal(metadata.frames[0].id, 'copper-beacon');
  const { rect } = metadata.frames[0];
  const center = ((rect.y + Math.floor(rect.height / 2)) * metadata.width + rect.x + Math.floor(rect.width / 2)) * 4;
  assert.equal(images.color[center + 3], 255);
  assert.equal(images.normal[center + 3], 255);
  assert(images.normal[center + 2] > 128);
});

test('the sign responds to the included recording and to a label edit', () => {
  const project = open('audio-driven-sign');
  const beat = project.run({ time: .05 }).outputs;
  const quiet = project.run({ time: .21 }).outputs;
  assert.equal(beat.sound.sampleRate, 8000);
  assert(beat.level > quiet.level + .2);
  assert.notDeepEqual(beat.sign.data, quiet.sign.data);
  assert.notDeepEqual(project.run({ time: .05, inputs: { text: 'WAVE' } }).outputs.sign.data, beat.sign.data);
});

test('the weathered tile atlas preserves the dry, mossy, and frosted variants', () => {
  const project = open('weathered-tiles');
  const stock = project.run().outputs;
  assert.deepEqual(stock.atlas.metadata.frames.map(frame => frame.id), ['dry', 'moss', 'frost']);
  assert.notDeepEqual(stock.dry.data, stock.frost.data);
  assert.deepEqual(stock.repeated.data.slice(0, 64 * 4), stock.repeated.data.slice(64 * 4, 128 * 4));
  const edited = project.run({ inputs: { mossRamp: ['#2b1725', '#ad5271', '#ffb265'] } }).outputs;
  assert.notDeepEqual(edited.moss.data, stock.moss.data);
  assert.deepEqual(edited.dry.data, stock.dry.data);
});

test('the spell repeats exactly after two seconds and the vista uses separate 3D bands', () => {
  const spell = open('looping-spell');
  const start = spell.run().outputs.spell;
  const turning = spell.run({ time: .37 }).outputs.spell;
  assert.notDeepEqual(turning.data, start.data);
  assert.deepEqual(spell.run({ time: 2 }).outputs.spell.data, start.data);
  assert.deepEqual(spell.run({ time: 2.37 }).outputs.spell.data, turning.data);

  const vista = open('layered-vista');
  const first = vista.run().outputs;
  const second = vista.run({ time: 1.5 }).outputs;
  assert.deepEqual(first.horizon.bands.map(band => band.radius), [140, 80, 20]);
  assert.notDeepEqual(first.vista.data, second.vista.data);
});

test('template copies and versioned bundles keep their local assets when moved', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-starter-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const [id, dependency] of [['audio-driven-sign', 'beat.wav'], ['weathered-tiles', 'stone.group.json']]) {
    const copy = path.join(folder, id), bundle = path.join(folder, id + '.json');
    fs.cpSync(path.join(recipes, id), copy, { recursive: true });
    const before = ink.readGraphProject(path.join(copy, 'graph.json')).run({ time: .05 });
    ink.packProject(path.join(copy, 'take.json'), { out: bundle, revision: 2 });
    const moved = path.join(folder, id + '-moved');
    fs.renameSync(copy, moved);
    const archived = ink.readProjectBundle(bundle);
    assert.equal(archived.metadata.revision, 2);
    assert(archived.files().includes(dependency));
    for (const file of [bundle, path.join(moved, 'graph.json')]) {
      const after = ink.readGraphProject(file).run({ time: .05 });
      assert.deepEqual(after.artifacts, before.artifacts);
    }
  }
});
