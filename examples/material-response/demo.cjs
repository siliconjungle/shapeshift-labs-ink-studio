const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('../..');
const makeScene = require('./scene.cjs');

const out = path.resolve(process.argv[2] ?? 'silt-lock');
const source = path.join(out, 'source');
const project = path.join(out, 'silt-lock.ink.json');
const sampleRate = 24000;
const cli = (...args) => execFileSync(process.execPath, [path.resolve(__dirname, '../../cli/ink-studio.js'), ...args],
  { stdio: 'inherit' });
const save = (name, data) => fs.writeFileSync(path.join(source, name + '.json'), JSON.stringify(data, null, 2) + '\n');

function cue(name, seconds, seed, envelope, color) {
  let state = seed, noise = 0;
  const samples = Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const white = state / 2147483648 - 1;
    noise += .16 * (white - noise);
    const t = i / sampleRate;
    return Math.min(1, t * 650) * Math.exp(-t * envelope) * color(t, noise, white);
  });
  fs.writeFileSync(path.join(source, name + '.wav'), ink.encodeWav({ sampleRate, channels: 1, samples }));
}

fs.mkdirSync(source, { recursive: true });
cue('silt', .29, 111, 19, (t, noise, white) => .45 * noise + .16 * white + .4 * Math.sin(2 * Math.PI * (120 - 90 * t) * t));
cue('water', .42, 386, 10, (t, noise, white) =>
  .32 * noise + .25 * white + .15 * Math.sin(2 * Math.PI * (405 + t * 600) * t));
cue('strike', .56, 810, 8, (t, noise, white) => .12 * white * Math.exp(-30 * t) +
  .37 * Math.sin(2 * Math.PI * 197 * t) + .18 * Math.sin(2 * Math.PI * 623 * t) + .08 * Math.sin(2 * Math.PI * 1390 * t));
save('scene', makeScene());
save('soundtrack', { format: 'ink-studio/scene-audio', version: 1, sampleRate,
  assets: { silt: 'silt.wav', water: 'water.wav', strike: 'strike.wav' } });
save('authoring', { format: 'ink-studio/project-authoring', version: 1, soundtrack: 'silt-lock-audio' });
save('attachments', { 'ink-authoring': 'authoring.json', 'silt-lock-audio': 'soundtrack.json',
  'silt': 'silt.wav', 'water': 'water.wav', 'strike': 'strike.wav' });
cli('project', 'pack', path.join(source, 'scene.json'), '--attachments', path.join(source, 'attachments.json'), '--out', project);
if (!process.argv.includes('--pack-only')) {
  cli('export-scene', project, '--out', path.join(out, 'export'), '--formats', 'still,loop',
    '--w', '336', '--h', '192', '--px', '1', '--still-scale', '1', '--fps', '24', '--to', '5.8', '--t', '4.3');
}
