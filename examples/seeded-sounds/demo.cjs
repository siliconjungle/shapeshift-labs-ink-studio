const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const folder = path.resolve(process.argv[2]), file = name => path.join(folder, name);
const { KIT: K } = require(repo).load(), sound = K.procedural.mediaGraph.soundRecipe;
const cli = path.join(repo, 'cli/ink-studio.js'), wav = require(path.join(repo, 'cli/wav.js'));
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });
const rate = 48000;

fs.mkdirSync(file('recipes'), { recursive: true });
const families = sound.families;
const tracks = [], assets = {}, prints = [];
for (const [index, family] of families.entries()) {
  const input = 'recipes/' + family + '.sound.json', render = 'sounds/' + family;
  const on = index + .15;
  save(input, { format: sound.format, version: 1, id: 'relay-' + family, family, seed: 21704 + index * 71,
    render: { sampleRate: rate, peak: .72 } });
  run('music', 'sound', 'render', input, '--out', render);
  assets[family] = render + '/recipe.sound.json';
  const report = read(render + '/report.json');
  prints.push({ family, onset: on, frames: report.frames, seed: report.seed, sha256: report.sha256, wave: render + '/sound.wav' });
  tracks.push({ id: family, source: family, at: { seconds: on }, gainDb: -1.5 });
}
run('music', 'sound', 'render', assets.impact, '--out', 'regenerated');
assert(fs.readFileSync(file('regenerated/sound.wav')).equals(fs.readFileSync(file('sounds/impact/sound.wav'))));

save('reel.mix.json', { assets, mixer: {
  id: 'relay-dispatch', sampleRate: rate, end: { seconds: 6.2 }, tail: 'cut', output: 'master', peakPolicy: 'error',
  strips: { master: {}, cues: { clips: tracks } }
} });
run('music', 'mix', 'render', 'reel.mix.json', '--out', 'reel');
fs.copyFileSync(file('reel/mix.wav'), file('seeded-sounds.wav'));

save('charge.graph.json', { format: 'ink-studio/graph-project', version: 1,
  assets: { spec: { format: 'json', file: assets.charge }, direct: { format: 'sound-recipe', file: assets.charge } },
  nodes: {
    spec: { op: 'jsonAsset', inputs: { name: 'spec' } },
    sound: { op: 'audio.renderSoundRecipe', inputs: { recipe: { node: 'spec' } } },
    direct: { op: 'audioAsset', inputs: { name: 'direct' } },
    meters: { op: 'audio.meterMix', inputs: { source: { node: 'sound' } } }
  },
  outputs: { charge: { node: 'sound' }, named: { node: 'direct' }, resolved: { node: 'sound', port: 'recipe' }, meters: { node: 'meters' } },
  exports: { charge: { output: 'charge', format: 'wav', encoding: 'pcm24' },
    named: { output: 'named', format: 'wav', encoding: 'pcm24' },
    meters: { output: 'meters', format: 'json' }, resolved: { output: 'resolved', format: 'json' } }
});
run('graph', 'run', 'charge.graph.json', '--out', 'graph');
for (const name of ['charge', 'named']) assert(fs.readFileSync(file('graph/artifacts/' + name + '.wav'))
  .equals(fs.readFileSync(file('sounds/charge/sound.wav'))));
save('catalog.capture.json', { input: { kind: 'file', path: assets.impact },
  sample: { id: 'relay-impact', label: 'Relay panel impact', tags: ['effects', 'seeded'], license: { id: 'original' } } });
const sample = JSON.parse(run('music', 'samples', 'add', 'sample-library', 'catalog.capture.json'));
assert.deepEqual(sample.entry.source.recipe, read(assets.impact));

const positions = [[-2, 0, -2], [1.7, 0, -2], [-.6, 0, -1.5], [1.6, 0, -1.5], [-1.4, 0, -1.5], [.55, 0, -1.25]];
save('relay.world.json', { format: 'ink-studio/world', version: 1, id: 'relay-dispatch', dt: .05,
  history: { enabled: true }, commands: families.map((name, i) => ({
    tick: 3 + 20 * i, action: 'world/event', args: { kind: name, point: positions[i] }
  })) });
run('sim', 'run', 'relay.world.json', '--ticks', '126', '--record', 'relay.run.json');
save('relay.soundtrack.json', { format: 'ink-studio/scene-audio', version: 1, sampleRate: rate, assets,
  spatial: {
    cues: Object.fromEntries(families.map(name => [name, { asset: name, bus: 'effects', gain: .85 }])),
    bindings: Object.fromEntries(families.map(name => [name, { on: { kind: name }, cue: name }]))
  }, listener: { at: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] }, post: {} });
run('story', 'audio', 'relay.run.json', 'relay.soundtrack.json', '--out', 'world');
const report = read('world/report.json');
assert.deepEqual(report.cues.map(row => [row.cue, row.onsetSample]), prints.map(row => [row.family, Math.round(row.onset * rate)]));
assert(report.cues.every(row => K.world.inspectionLinks.parse(row.source.beatId)));
assert(wav.read(file('world/mix.wav')).samples.some(sample => Math.abs(sample) > .2));
save('demo-summary.json', { sampleRate: rate, reel: 'seeded-sounds.wav', sounds: prints, regenerated: 'regenerated/sound.wav',
  graph: 'graph/report.json', sampleLibrary: 'sample-library', world: { audio: 'world/mix.wav', report: 'world/report.json' } });
console.log('Rendered six seeded sounds, rebuilt one byte for byte, and used the same recipes in the graph, mixer, sample catalog and recorded world.');
