const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node variations.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const folder = path.resolve(process.argv[2]), file = name => path.join(folder, name);
const cli = path.join(repo, 'cli/ink-studio.js');
const sound = require(repo).load().KIT.procedural.mediaGraph.soundRecipe;
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const rate = 48000;
const groups = [
  { family: 'jump', first: 5760, spacing: 38400, seed: 6305, locks: ['pitchContour', 'attack'],
    bounds: { duration: [.24, .53], brightness: [.35, 1.85], noise: [.05, 1.95] } },
  { family: 'charge', first: 200640, spacing: 52800, seed: 71, locks: ['pitchContour', 'attack', 'duration'],
    bounds: { brightness: [.35, 1.9], noise: [.02, 1.95], decay: [.55, 2.35] } }
];

fs.mkdirSync(folder, { recursive: true });
const assets = {}, clips = [], cues = [];
for (const { family, first, spacing, seed, locks, bounds } of groups) {
  const source = family + '.sound.json', settings = family + '-variations.json', batch = family + '-batch';
  save(source, { format: sound.format, version: 1, family, seed: 6120, render: { sampleRate: rate, peak: .72 } });
  save(settings, { format: sound.mutationFormat, version: 1, seed, count: 4, locks, bounds });
  run('music', 'sound', 'render', source, '--out', family + '-original');
  run('music', 'sound', 'mutate', source, settings, '--out', batch);
  const manifest = read(batch + '/manifest.json');
  const rows = [{ id: family, recipe: family + '-original/recipe.sound.json', report: family + '-original/report.json' },
    ...manifest.variants.map(row => ({ ...row, recipe: batch + '/' + row.recipe, report: batch + '/' + row.report,
      audio: batch + '/' + row.audio }))];
  const attack = read(rows[0].report).attackFrames;
  for (const [index, row] of rows.entries()) {
    const { id, recipe, report } = row;
    const at = first + index * spacing;
    assert.deepEqual(read(report).attackFrames, attack);
    assets[id] = recipe;
    clips.push({ id, source: id, at: { samples: at }, gainDb: -1.5 });
    cues.push({ id, onsetSample: at, seconds: at / rate, duration: read(report).seconds });
  }
  run('music', 'sound', 'render', rows[1].recipe, '--out', family + '-rebuilt');
  assert(fs.readFileSync(file(family + '-rebuilt/sound.wav')).equals(fs.readFileSync(file(rows[1].audio))));
}

save('variations.mix.json', { assets, mixer: {
  id: 'seeded-variations', sampleRate: rate, end: { seconds: 9.68 }, tail: 'cut', output: 'master', peakPolicy: 'error',
  strips: { master: {}, cues: { clips } }
} });
run('music', 'mix', 'render', 'variations.mix.json', '--out', 'reel');
fs.copyFileSync(file('reel/mix.wav'), file('sound-variations.wav'));
save('demo-summary.json', { sampleRate: rate, audio: 'sound-variations.wav', cues,
  groups: groups.map(({ family, locks }) => ({ family, locks, manifest: family + '-batch/manifest.json' })) });
console.log('Rendered two families, verified locked attack ramps, and rebuilt two variations byte for byte.');
