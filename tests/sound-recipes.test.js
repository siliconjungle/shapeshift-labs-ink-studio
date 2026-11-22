const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..'), kit = ink.load();
const wav = require('../cli/wav.js');

const P = kit.KIT.procedural, sound = P.mediaGraph.soundRecipe;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const recipe = (family, seed = 73, render) => ({ format: sound.format, version: 1, family, seed, ...(render && { render }) });

function room(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sound-recipe-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: 'pipe' });
  return { file, save, read, run };
}

test('six recipe families resolve their render settings and generate seeded, normalized PCM', () => {
  assert.deepEqual(sound.families, ['confirm', 'warning', 'pickup', 'impact', 'jump', 'charge']);
  const hashes = new Set();
  for (const name of sound.families) {
    const settings = recipe(name, -9735, { sampleRate: 8000, duration: .18, peak: .8, encoding: 'float32' });
    const { value, recipe: resolved, report } = sound.render(settings);
    assert.equal(value.sampleRate, 8000);
    assert.equal(value.channels, 1);
    assert.deepEqual(resolved.render, settings.render);
    assert.equal(report.frames, 1440);
    assert(value.samples.every(n => Math.abs(n) <= Math.fround(.8)));
    assert(report.rms > .04);
    assert.equal(value.samples[0], 0);
    assert.equal(value.samples.at(-1), 0);
    assert.deepEqual(sound.render(JSON.parse(JSON.stringify(resolved))).value.samples, value.samples);
    assert.notDeepEqual(sound.render(recipe(name, 912, settings.render)).value.samples, value.samples);
    hashes.add(createHash('sha256').update(wav.encode(value)).digest('hex'));
  }
  assert.equal(hashes.size, 6);
  assert.throws(() => sound.normalize({ ...recipe('impact'), version: 2 }), /version 1/);
  assert.throws(() => sound.normalize(recipe('impact', .5)), /integer seed/);
  assert.throws(() => sound.normalize(recipe('impact', 8, { sampleRate: 44100, duration: 40 })), /bounded duration/);
  assert.throws(() => sound.normalize({ ...recipe('impact'), id: 'unsafe', family: ['impact'] }), /known family/);
});

test('family mutation is deterministic, uses authored bounds, and keeps locked pitch and attack across durations', () => {
  const base = recipe('jump', 42, { duration: .08, sampleRate: 8000 });
  const options = { seed: 823, count: 6, locks: ['pitchContour', 'attack'],
    bounds: { duration: [.04, .24], brightness: [.55, 1.8], noise: [.1, 1.6], pitchSemitones: [-3, 3] } };
  const { value, plan } = sound.mutate(base, options);
  const original = sound.render(base);
  assert.deepEqual(sound.mutate(plan.recipe, plan.settings).value, value);
  assert.deepEqual(sound.mutate(base, { ...options, count: 2 }).value, value.slice(0, 2));
  assert.notDeepEqual(sound.mutate(base, { ...options, seed: 824 }).value, value);
  assert.equal(new Set(value.map(row => row.id)).size, options.count);
  assert.equal(new Set(value.map(row => row.render.duration)).size, options.count);
  for (const row of value) {
    assert.equal(row.seed, base.seed);
    assert.equal(row.shape.pitchSemitones, 0);
    assert.equal(row.shape.sweep, 1);
    assert.equal(row.shape.attack, 1);
    assert.equal(row.shape.attackReferenceDuration, .08);
    assert.equal(row.shape.decay, 1);
    assert.equal(row.render.peak, original.recipe.render.peak);
    for (const [key, [lo, hi]] of Object.entries(plan.settings.bounds)) {
      const actual = row.shape[key] ?? row.render[key];
      assert(actual >= lo && actual <= hi, key);
    }
    assert.deepEqual(sound.render(row).report.attackFrames, original.report.attackFrames);
  }
});

test('mutation locks preserve shaped parents and reject conflicting or impossible bounds', () => {
  const base = { ...recipe('charge', -202), shape: { pitchSemitones: 1.25, sweep: 1.2, attack: 1.3 } };
  const options = { count: 2, locks: ['duration', 'pitchContour', 'attack'], bounds: { brightness: [.35, 1.9] } };
  const { value } = sound.mutate(base, options);
  assert.deepEqual(value.map(row => [row.render.duration, row.shape.pitchSemitones, row.shape.sweep, row.shape.attack]),
    [[.92, 1.25, 1.2, 1.3], [.92, 1.25, 1.2, 1.3]]);
  assert.notDeepEqual(sound.render(value[0]).value.samples, sound.render(value[1]).value.samples);
  for (const family of sound.families) {
    const original = recipe(family);
    const [neutral] = sound.mutate(original, { count: 1, bounds: {} }).value;
    assert.deepEqual(sound.render(neutral).value.samples, sound.render(original).value.samples);
    assert.equal(sound.mutate(original).value.length, 8);
  }
  assert.throws(() => sound.mutate(base, { ...options, bounds: { duration: [.3, .4] } }), /excludes locked duration/);
  assert.throws(() => sound.mutate(recipe('confirm'), { bounds: { attack: [3, 3], duration: [.04, .06] } }), /fit inside every layer/);
  assert.throws(() => sound.mutate(base, { locks: ['attack', 'attack'] }), /unique/);
  assert.throws(() => sound.mutate(base, { count: 33 }), /1 to 32/);
  assert.throws(() => sound.mutate(base, { bounds: { noise: [1, 0] } }), /bound noise/);
  const short = { ...recipe('confirm', 32, { duration: .04, sampleRate: 8000 }),
    shape: { attack: 2.22, attackReferenceDuration: .2 } };
  const bounded = sound.mutate(short);
  assert(bounded.value.every(row => sound.render(row).report.frames >= 320));
});

test('CLI publishes rebuildable families and shares the same recipes with typed graphs and the sample catalog', t => {
  const { file, save, read, run } = room(t);
  const base = recipe('impact', 715, { sampleRate: 8000 });
  const settings = { format: sound.mutationFormat, version: 1, seed: 6812, count: 3, locks: ['duration'],
    bounds: { pitchSemitones: [-4, 4], attack: [.5, 1.7], noise: [.1, 1.9], brightness: [.55, 1.7] } };
  save('source.sound.json', base);
  save('settings.json', settings);
  run('music', 'sound', 'mutate', 'source.sound.json', 'settings.json', '--out', 'batch');
  run('music', 'sound', 'mutate', 'source.sound.json', 'settings.json', '--out', 'repeat');
  const batch = read('batch/manifest.json');
  assert.deepEqual(batch, read('repeat/manifest.json'));
  const graph = ink.createGraphProject({ format: 'ink-studio/graph-project', version: 1,
    nodes: { mutate: { op: 'audio.mutateSoundRecipe', inputs: { recipe: base, options: settings } } },
    outputs: { recipes: { node: 'mutate' }, plan: { node: 'mutate', port: 'plan' } } });
  const { recipes, plan } = graph.run().outputs;
  assert.deepEqual(recipes, batch.variants.map(row => read('batch/' + row.recipe)));
  assert.deepEqual(plan, { recipe: batch.recipe, settings: batch.settings });
  const hashes = new Set();
  for (const row of batch.variants) {
    run('music', 'sound', 'render', 'batch/' + row.recipe, '--out', 'rebuilt');
    const bytes = fs.readFileSync(file('batch/' + row.audio));
    assert(bytes.equals(fs.readFileSync(file('rebuilt/sound.wav'))));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    hashes.add(row.sha256);
  }
  assert.equal(hashes.size, batch.variants.length);
  save('settings.json', { ...settings, seed: settings.seed + 1 });
  run('music', 'sound', 'mutate', 'source.sound.json', 'settings.json', '--out', 'batch');
  assert.notEqual(read('batch/manifest.json').variants[0].recipe, batch.variants[0].recipe);
  for (const row of batch.variants)
    assert.equal(createHash('sha256').update(fs.readFileSync(file('batch/' + row.audio))).digest('hex'), row.sha256);
  const reference = 'batch/' + batch.variants[0].recipe;
  save('capture.json', { input: { kind: 'file', path: reference },
    sample: { id: 'test-hit', label: 'Test hit', license: { id: 'original' } } });
  const capture = JSON.parse(run('music', 'samples', 'add', 'library', 'capture.json'));
  assert.deepEqual(capture.entry.source.recipe, read(reference));
});

test('CLI renders from the saved recipe and graphs load the same pinned audio asset and typed recipe', t => {
  const { file, save, read, run } = room(t);
  save('input.json', recipe('jump', 927));
  run('music', 'sound', 'render', 'input.json', '--out', 'first');
  run('music', 'sound', 'render', 'first/recipe.sound.json', '--out', 'second');
  const bytes = fs.readFileSync(file('first/sound.wav'));
  assert(bytes.equals(fs.readFileSync(file('second/sound.wav'))));
  assert.equal(read('first/report.json').sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(read('first/recipe.sound.json').render,
    { sampleRate: 48000, duration: .36, peak: .75, encoding: 'pcm24' });
  assert.throws(() => run('music', 'sound', 'render', 'first/recipe.sound.json', '--out', 'first'),
    /outputs must be separate/);

  const manifest = { format: 'ink-studio/asset-registry', version: 1, entries: [
    { asset: 'cue/jump', revision: 1, kind: 'sound', file: 'first/recipe.sound.json' }
  ] };
  save('draft.json', manifest);
  run('assets', 'lock', 'draft.json', '--out', 'registry.json');
  const graph = { format: 'ink-studio/graph-project', version: 1, assetRegistry: 'registry.json', seed: 930,
    assets: { jump: { format: 'sound-recipe', file: { asset: 'cue/jump', revision: 1 } } },
    nodes: {
      named: { op: 'audioAsset', inputs: { name: 'jump' } },
      node: { op: 'audio.renderSoundRecipe', inputs: { recipe: read('first/recipe.sound.json') } }
    },
    outputs: { named: { node: 'named' }, node: { node: 'node' } },
    exports: { named: { output: 'named', format: 'wav', encoding: 'pcm24' },
      node: { output: 'node', format: 'wav', encoding: 'pcm24' } }
  };
  save('graph.json', graph);
  run('graph', 'run', 'graph.json', '--out', 'rendered-graph');
  for (const name of ['named', 'node']) assert(bytes.equals(fs.readFileSync(file('rendered-graph/artifacts/' + name + '.wav'))));
  save('patch.json', { format: 'ink-studio/graph-project', version: 1,
    nodes: { player: { op: 'patch.audio' } }, outputs: { sound: { node: 'player' } },
    assertions: [{ id: 'rate', output: 'sound', path: ['sampleRate'], op: 'eq', value: 48000 }] });
  const patch = JSON.parse(run('patch', 'run', 'patch.json', '--audio', 'first/recipe.sound.json'));
  assert.equal(patch.passed, true);
});

test('a DAW handoff ships WAV stems and reopens an editable Ink session with the original recipe', t => {
  const { file, save, read, run } = room(t);
  save('cue.sound.json', recipe('confirm', 81, { sampleRate: 8000 }));
  save('session.json', { assets: { cue: 'cue.sound.json' }, session: {
    format: 'ink-studio/music-edit-session', version: 1, id: 'recipe-desk', sampleRate: 8000,
    production: {
      arrangement: { score: { key: { root: 'C4' }, tempoMap: { tempo: 120 },
        harmonies: { c: { root: 'C3', quality: 'unison' } } },
      motifs: { pulse: { length: 4, events: [{ id: 'tap', beat: 0, duration: .2, degree: 1 }] } },
      parts: { pad: { role: 'pad', material: 'pulse' } }, sections: [{ id: 'cue', bars: 1, harmony: 'c' }] },
      patches: { tone: { type: 'subtractive' } }, tracks: { pad: { patch: 'tone', gain: -36 } }
    },
    audio: { effect: { take: 'recipe', takes: { recipe: { asset: 'cue' } } } },
    mixer: { output: 'master', strips: { master: {}, pad: {}, effect: {} } }
  } });
  run('music', 'session', 'render', 'session.json', '--out', 'original');
  run('music', 'session', 'handoff', 'session.json', '--out', 'handoff');
  const source = read('handoff/ink/session.json');
  assert.equal(source.assets.cue, 'assets/cue.sound.json');
  assert.deepEqual(read('handoff/ink/' + source.assets.cue), read('cue.sound.json'));
  const master = wav.read(file('handoff/audio/master.wav'));
  assert(master.samples.some(sample => Math.abs(sample) > .2));
  run('music', 'session', 'render', 'handoff/ink/session.json', '--out', 'reopened');
  assert(fs.readFileSync(file('reopened/mix.wav')).equals(fs.readFileSync(file('original/mix.wav'))));
});
