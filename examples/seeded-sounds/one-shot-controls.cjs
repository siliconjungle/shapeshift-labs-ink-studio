const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node one-shot-controls.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const folder = path.resolve(process.argv[2]), file = name => path.join(folder, name);
const cli = path.join(repo, 'cli/ink-studio.js'), wav = require(path.join(repo, 'cli/wav.js'));
const sound = require(repo).load().KIT.procedural.mediaGraph.soundRecipe;
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const rate = 48000;
const steps = [{ at: 0, semitones: 0 }, { at: .31, semitones: 5 }, { at: .65, semitones: 12 }];
const noisyPulse = { pulseWidth: .19, noise: { color: 'white', level: .55 } };
const pairs = [
  { id: 'sweep', control: 'Pitch sweep', family: 'jump', a: {},
    b: { synth: { pitchSweep: { fromSemitones: -8, toSemitones: 8, curve: .75 } } } },
  { id: 'steps', control: 'Stepped pitch', family: 'jump', a: { synth: { pulseWidth: .25 } },
    b: { synth: { pulseWidth: .25, pitchSteps: steps } } },
  { id: 'pulse', control: 'Pulse width', family: 'warning', a: { synth: { pulseWidth: .5 } },
    b: { synth: { pulseWidth: .13 } } },
  { id: 'retriggers', control: 'Retriggering', family: 'impact', a: {},
    b: { synth: { retrigger: { positions: [0, .26, .51, .77], gate: .68 } } } },
  { id: 'noise', control: 'White and brown noise', family: 'impact', a: { synth: { noise: { color: 'white', level: .95 } } },
    b: { synth: { noise: { color: 'brown', level: .95 } } } },
  { id: 'filter', control: 'Filter sweep', family: 'jump', a: { synth: noisyPulse },
    b: { synth: { ...noisyPulse, filter: { fromHz: 180, toHz: 5600 } } } },
  { id: 'punch', control: 'Envelope punch', family: 'jump', a: { synth: { pulseWidth: .2 } },
    b: { synth: { pulseWidth: .2, punch: { amount: 3, decayMs: 95 } } } },
  { id: 'retro', control: 'Four-bit retro insert at 3.2 kHz', family: 'jump', a: { synth: { pulseWidth: .25, pitchSteps: steps } },
    b: { synth: { pulseWidth: .25, pitchSteps: steps }, retro: { bits: 4, rateHz: 3200 } } }
];

fs.mkdirSync(file('sources'), { recursive: true });
const assets = {}, clips = [], comparisons = [];
for (const [index, { id, control, family, a, b }] of pairs.entries()) {
  const results = [];
  for (const [side, edit] of Object.entries({ a, b })) {
    const name = id + '-' + side, source = 'sources/' + name + '.sound.json', print = 'prints/' + name;
    const onsetSample = Math.round(rate * (.12 + index * 1.5 + (side === 'b' ? .69 : 0)));
    save(source, { format: sound.format, version: 1, family, id: name, seed: 841, render: { sampleRate: rate, duration: .54, peak: .7 }, ...edit });
    run('music', 'sound', 'render', source, '--out', print);
    assets[name] = print + '/recipe.sound.json';
    clips.push({ id: name, source: name, at: { samples: onsetSample }, gainDb: -1.5 });
    const report = read(print + '/report.json');
    results.push({ source, recipe: assets[name], audio: print + '/sound.wav', onsetSample, seconds: onsetSample / rate, sha256: report.sha256 });
  }
  assert.notEqual(results[0].sha256, results[1].sha256);
  comparisons.push({ id, control, original: results[0], edited: results[1] });
}

const end = 12.05;
save('one-shots.mix.json', { assets, mixer: {
  id: 'editable-one-shots', sampleRate: rate, end: { seconds: end }, tail: 'cut', output: 'master', peakPolicy: 'error',
  strips: { master: {}, cues: { clips } }
} });
run('music', 'mix', 'render', 'one-shots.mix.json', '--out', 'reel');
fs.copyFileSync(file('reel/mix.wav'), file('one-shot-controls.wav'));
assert.equal(wav.read(file('one-shot-controls.wav')).samples.length, 2 * Math.round(end * rate));
save('demo-summary.json', { audio: 'one-shot-controls.wav', sampleRate: rate, comparisons });
console.log('Rendered eight A/B one-shot comparisons through the Ink mixer.');
