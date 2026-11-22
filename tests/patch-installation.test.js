const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KIT: K } = require('..').load();
const Installation = require('../cli/patch-installation.js');

const W = K.world;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const world = require('../examples/world-access/harbor.world.json');
const policy = require('../examples/world-access/harbor.access.json');
const transports = { midi: { channel: 2 }, osc: { address: '/ink/preset' }, dimensions: { width: 100, height: 100 } };
const bindings = {
  tracking: { output: 'regions', dwellFrames: 2, zones: { gate: { rect: [.5, .5, .5, .5], grant: 'release-lantern' } } },
  midi: { notes: { 60: 'hold-lantern' }, programs: { 3: 'release-lantern' } },
  osc: { address: '/ink/choice', choices: { open: 'release-lantern' } }
};

test('tracking dwell needs consecutive fresh observations and rearms only after vacancy', () => {
  const events = [], watch = Installation.open(Installation.prepare(W, bindings, transports), (grant, device) => {
    events.push({ grant, device });
    return true;
  });
  const track = (confidence = .8, id = 2) => [{ id, center: [75, 66], confidence }];
  watch.sample(0, track());
  watch.sample(2, track());
  assert.equal(events.length, 0);
  watch.sample(3, track(.17));
  watch.sample(4, track());
  assert.equal(events.length, 0);
  watch.sample(5, track());
  watch.sample(6, track(.2));
  watch.sample(7, track(.9, 4));
  assert.deepEqual(events, [{ grant: 'release-lantern', device: {
    kind: 'tracking', zone: 'gate', track: 2, center: [75, 66], confidence: .8, dwellFrames: 2
  } }]);
  watch.sample(8, []);
  watch.sample(9, track());
  watch.sample(10, track());
  assert.equal(events.length, 2);
});

test('device maps accept only documented choices and MIDI notes rearm on release', () => {
  const events = [];
  const watch = Installation.open(Installation.prepare(W, bindings, transports), (grant, device) => {
    events.push({ grant, device });
    return true;
  });
  watch.midi([0x91, 60, 90]);
  watch.midi([0x91, 60, 91]);
  watch.midi([0x91, 61, 90]);
  watch.midi([0x91, 60, 0]);
  watch.midi([0x91, 60, 92]);
  watch.midi([0xc1, 3]);
  watch.osc('/ink/preset', ['open']);
  watch.osc('/ink/choice', ['open', 'other']);
  watch.osc('/ink/choice', ['other']);
  watch.osc('/ink/choice', ['open']);
  assert.deepEqual(events.map(({ grant, device }) => [grant, device.data ?? device.choice]), [
    ['hold-lantern', [0x91, 60, 90]], ['hold-lantern', [0x91, 60, 92]],
    ['release-lantern', [0xc1, 3]], ['release-lantern', 'open']
  ]);
  assert.throws(() => Installation.prepare(W, { osc: { ...bindings.osc, address: '/ink/preset' } }, transports), /separate address/);
  assert.throws(() => Installation.prepare(W, { midi: bindings.midi }, { ...transports, midi: undefined }), /needs show MIDI/);
});

test('native replay links a recorded input to its committed branch and verifies native rejection separately', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-installation-replay-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data));
  const run = W.runtime.create(world);
  run.advance(1);
  const release = { id: 'let-the-signal-out', tick: 2, ...policy.interventions['release-lantern'] };
  const hold = { id: 'missed-the-window', tick: 3, ...policy.interventions['hold-lantern'] };
  run.schedule([release, hold]);
  run.advance(4);
  save('run.json', run.recording());
  const header = { format: 'ink-studio/patch-intervention-journal', version: 1, mode: 'submit' };
  function rows(index, grant, command, tick, cursorTick, request = 'source-' + index) {
    const input = { time: index / 10, channel: 'world-intervention', kind: 'pulse', value: { id: grant, request } };
    return [{ kind: 'proposal', index, frame: index, after: { stream: 'operator', revision: cursorTick, tick: cursorTick }, input },
      { kind: 'outcome', index, status: 'scheduled', httpStatus: 202, receipt: { command, tick } }];
  }
  const journal = [header, ...rows(1, 'release-lantern', release.id, 2, 1),
    ...rows(2, 'hold-lantern', hold.id, 3, 2),
    ...rows(3, 'release-lantern', release.id, 2, 3, 'source-1')];
  const saveJournal = data => fs.writeFileSync(file('journal.ndjson'), data.map(row => JSON.stringify(row)).join('\n') + '\n');
  const invoke = (...args) => spawnSync(process.execPath, [cli, 'patch', 'choices', 'journal.ndjson', 'run.json', ...args],
    { cwd: folder, encoding: 'utf8' });
  saveJournal(journal);
  const verified = invoke('--out', 'review.json', '--track', 'track.json');
  assert.equal(verified.status, 0, verified.stderr);
  const report = read('review.json');
  assert.equal(report.verification.status, 'verified');
  assert.deepEqual(report.choices.map(row => row.status), ['committed', 'choice-rejected', 'committed']);
  assert.equal(report.choices[0].ending.outcome, 'lit');
  assert.equal(report.choices[0].beatId, report.choices[2].beatId);
  assert.equal(report.choices[1].rejection.reason, 'story-not-active');
  assert.deepEqual(read('track.json').events, [journal[1].input]);

  saveJournal([...journal, ...rows(4, 'release-lantern', 'missing-command', 4, 3)]);
  const missing = invoke();
  assert.equal(missing.status, 2, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).choices.at(-1).status, 'command-missing');
});
