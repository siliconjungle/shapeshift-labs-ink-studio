const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');

const out = path.resolve(process.argv[2] ?? 'agent-project-demo');
const source = path.join(out, 'source');
const cli = path.join(__dirname, '../../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const author = (...args) => JSON.parse(run('project', 'author', ...args));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const asset = name => path.join(source, name);
const report = (name, value) => save(path.join(out, name + '.json'), value);

fs.mkdirSync(source, { recursive: true });
fs.copyFileSync(path.join(__dirname, '../pixel-art-tooling/relay.json'), asset('relay-pixels.json'));
save(asset('relay.json'), {
  id: 'ceramic-relay', name: 'Ceramic Relay', seed: 29,
  palette: [0x12212e, 0x233747, 0x3c5261, 0x805d5e, 0xd49f6d, ...ink.load().KIT.diorama.styles.slate.palette.slice(5)],
  roles: { slate: [1, 2, 3], bronze: [2, 3, 4] },
  camera: { target: [0, .24, 0], dist: 6.45, yaw: .12, pitch: .14, projection: 'orthographic' },
  finish: { radius: 5, dither: 0 },
  solids: [
    { id: 'pedestal', kind: 'box', at: [0, -.95, -.05], half: [1.68, .12, .68], mat: 'slate', res: .075, round: .08 },
    ...[-.9, .9].map((x, i) => ({ id: 'support-' + i, kind: 'box', at: [x, -.55, -.06], half: [.058, .36, .12],
      mat: 'slate', res: .033, round: .03 }))
  ],
  timeline: { duration: 2.5, audio: [{ id: 'relay-click', cue: 'click', time: .25, gain: .35 }] }
});
save(asset('attachments.json'), {
  'ink-authoring': 'authoring.json', 'relay-pixels': 'relay-pixels.json', 'relay-audio': 'soundtrack.json'
});
save(asset('authoring.json'), {
  format: 'ink-studio/project-authoring', version: 1,
  pixels: { 'relay-art': { source: 'relay-pixels', placement: { at: [0, .43, .18], unitsPerPixel: .043, keepSwatches: true } } },
  soundtrack: 'relay-audio'
});
const sampleRate = 24000;
const samples = Float32Array.from({ length: sampleRate / 2 }, (_, i) => {
  const t = i / sampleRate;
  return Math.min(t * 1200, 1) * Math.exp(-t * 11) *
    (.45 * Math.sin(2 * Math.PI * 420 * t) + .14 * Math.exp(-t * 16) * Math.sin(2 * Math.PI * 1597 * t));
});
fs.writeFileSync(asset('click.wav'), ink.encodeWav({ sampleRate, channels: 1, samples }));
save(asset('soundtrack.json'), { format: 'ink-studio/scene-audio', version: 1, sampleRate,
  assets: { click: 'click.wav' } });

const beforeFile = path.join(out, 'relay-initial.ink.json');
const finalFile = path.join(out, 'relay-revised.ink.json');
const patchFile = path.join(out, 'relay-edit.json');
run('project', 'pack', asset('relay.json'), '--attachments', asset('attachments.json'), '--out', beforeFile);
const before = author('inspect', beforeFile);
report('inspect-initial', before);
const view = ['--at', '1.25', '--w', '240', '--h', '136'];
const sampled = author('sample', beforeFile, ...view, '--pick', '94,62', '--out', path.join(out, 'before.png'));
report('sample-initial', sampled);
assert.equal(sampled.hit?.pixelAsset, 'relay-art');
const observed = sampled.hit.pixelAt.join(',');
const pixel = author('pixel', beforeFile, sampled.hit.pixelAsset, '--at', observed);
assert.equal(pixel.swatch, 'yellow');
report('pixel-initial', pixel);

const { id, edits } = require('../pixel-art-tooling/relay-cleanup.json');
const pedestal = before.objects.children.find(object => object.name === 'pedestal');
assert(pedestal, 'The project should expose the pedestal edit address');
assert.deepEqual(pixel.at, edits[0].at);
save(patchFile, {
  format: 'ink-studio/project-edit', version: 1, base: before.base,
  edits: [
    { op: 'scene.material', target: pedestal.key, material: 'bronze' },
    { op: 'pixels.edit', asset: sampled.hit.pixelAsset, patch: { id, frame: pixel.frame, edits } },
    { op: 'timeline.track', target: '/camera/yaw', keys: [
      { time: 0, value: -.37, ease: 'smooth' }, { time: 1.25, value: .37, ease: 'smooth' }, { time: 2.5, value: -.37 }
    ] },
    { op: 'timeline.cue', id: 'relay-click', values: { time: 1.25, gain: .9 } }
  ]
});
const previewFile = path.join(out, 'preview.png');
const preview = author('preview', beforeFile, patchFile, ...view, '--image', previewFile);
const saved = author('apply', beforeFile, patchFile, '--out', finalFile);
assert.equal(saved.next, preview.next);
report('edit-preview', preview);
report('edit-saved', saved);

const final = author('inspect', finalFile);
assert.equal(final.base, saved.next);
assert.equal(final.timeline.audio[0].time, 1.25);
report('inspect-reopened', final);
const afterFile = path.join(out, 'after.png');
report('sample-reopened', author('sample', finalFile, ...view, '--out', afterFile));
assert.deepEqual(fs.readFileSync(afterFile), fs.readFileSync(previewFile));
const revised = author('pixel', finalFile, 'relay-art', '--at', observed);
assert.equal(revised.swatch, 'ceramic-light');
report('pixel-reopened', revised);

const exported = path.join(out, 'export');
run('export-scene', finalFile, '--out', exported, '--formats', 'still,loop,replay',
  '--w', '240', '--h', '136', '--px', '1', '--still-scale', '1', '--fps', '12', '--t', '1.25');
const delivery = JSON.parse(fs.readFileSync(path.join(exported, 'export.json'), 'utf8'));
const wave = ink.readWav(path.join(exported, delivery.audio.mix));
const onset = wave.samples.findIndex(value => Math.abs(value) > .001) / wave.channels / wave.sampleRate;
assert(onset >= 1.25 && onset < 1.26, 'The exported WAV should contain the retimed cue');
console.log('Reopened project', finalFile);
console.log('Scene export', path.join(exported, 'export.json'));
