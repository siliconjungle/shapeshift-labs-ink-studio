const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');

const absolute = filename => path.resolve(__dirname, '..', filename);
const cli = absolute('cli/ink-studio.js');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('an agent can pick, edit, reopen and deliver a single portable project revision', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-agent-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = name => path.join(dir, name);
  execFileSync(process.execPath, [absolute('examples/agent-project/demo.cjs'), dir]);

  const initial = file('relay-initial.ink.json'), revised = file('relay-revised.ink.json'), edit = file('relay-edit.json');
  const before = read(file('inspect-initial.json')), after = read(file('inspect-reopened.json'));
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.objects.children.find(node => node.key === 'solid:pedestal').solid.mat, 'bronze');
  const sample = read(file('sample-reopened.json'));
  assert.equal(sample.camera.yaw, .37);
  assert.equal(read(file('sample-initial.json')).hit.object, 'relay-art');
  assert.deepEqual(read(file('sample-initial.json')).hit.pixelAt, [13, 22]);
  assert.notDeepEqual(fs.readFileSync(file('before.png')), fs.readFileSync(file('after.png')));
  assert.equal(JSON.parse(run('project', 'author', 'apply', initial, edit, '--out', revised)).next, after.base);

  function rejected(source, doc, out, message) {
    const result = spawnSync(process.execPath, [cli, 'project', 'author', 'apply', source, doc, '--out', out],
      { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  }
  rejected(revised, edit, file('stale.json'), /base is stale/);
  const broken = read(edit);
  broken.edits.push({ op: 'timeline.cue', id: 'relay-click', values: { cue: 'missing' } });
  const invalid = file('invalid.json');
  fs.writeFileSync(invalid, JSON.stringify(broken));
  rejected(initial, invalid, file('partial.json'), /name an asset or spatial cue/);
  rejected(initial, edit, initial, /output already contains a different revision/);
  assert.equal(JSON.parse(run('project', 'author', 'inspect', initial)).base, before.base);
  assert(!fs.existsSync(file('stale.json')));
  assert(!fs.existsSync(file('partial.json')));

  const moved = file('relocated/scene.ink.json');
  fs.mkdirSync(path.dirname(moved));
  fs.renameSync(revised, moved);
  fs.rmSync(file('source'), { recursive: true });
  const movedView = file('relocated/frame.png');
  run('project', 'author', 'sample', moved, '--at', '1.25', '--w', '240', '--h', '136', '--out', movedView);
  assert.deepEqual(fs.readFileSync(movedView), fs.readFileSync(file('after.png')));
  const out = file('relocated/export');
  run('export-scene', moved, '--out', out, '--formats', 'loop', '--w', '48', '--h', '32',
    '--from', '1', '--to', '1.5', '--fps', '8');
  const exported = read(path.join(out, 'export.json'));
  assert.equal(exported.sequence.frameCount, 4);
  const wav = ink.readWav(path.join(out, exported.audio.mix));
  const onset = wav.samples.findIndex(n => Math.abs(n) > .001) / wav.channels / wav.sampleRate;
  assert(onset >= .25 && onset < .26, 'the relocated cue should land on the trimmed export clock');
});
