const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const kit = require('..').load();
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
