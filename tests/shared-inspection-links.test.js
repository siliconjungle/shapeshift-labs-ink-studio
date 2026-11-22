const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { KIT: K } = require('..').load();
const W = K.world;
const { locate } = require('../cli/inspection-links.js');
const { showReport } = require('../cli/patch-show-report.js');

const links = W.inspectionLinks;
const trace = (run, beatId) => run.query().trace('world/cause', {}, { beatId });

test('a beat identifies its committed branch even when another branch uses the same local event ID', () => {
  const run = W.runtime.create({
    id: 'gate', dt: .1, causality: true, commands: [
      { tick: 1, action: 'world/event', args: { kind: 'arrival' } },
      { tick: 2, action: 'world/event', args: { kind: 'departure' } }
    ]
  });
  run.step();
  const [arrival] = run.committedEvents();
  const east = run.fork({ branch: 'east' }), west = run.fork({ branch: 'west' });
  east.step();
  west.step();
  const [a] = east.committedEvents(), [b] = west.committedEvents();
  assert.equal(a.id, b.id);
  assert.equal(links.identify(a), 'ink:beat:gate/east/2.0');
  assert.equal(links.identify(b), 'ink:beat:gate/west/2.0');
  assert.equal(trace(east, links.identify(a)).value.nodes[0].beatId, links.identify(a));
  assert.equal(trace(west, links.identify(a)).status, 'missing');
  for (const branch of [east, west])
    assert.equal(trace(branch, links.identify(arrival)).value.nodes[0].beatId, 'ink:beat:gate/main/1.0');
  assert.throws(() => trace(east, links.make(a, true)), /native beat ID/);
  assert.throws(() => links.identify({ ...a, beatId: links.identify(b) }), /differs from its event identity/);
});

test('a legacy audience frame emits projection-specific links through both its frame and pulse', () => {
  const frame = {
    format: 'ink-studio/world-graph-frame', version: 1, dt: .1, tick: 1, eventFrom: 1,
    visibility: { kind: 'spectator' },
    events: [{ version: 1, id: '1.0', world: 'gate', branch: 'public', tick: 1, kind: 'signal',
      system: 'presentation', payload: { color: 'amber' } }]
  };
  const pulse = W.graphPorts.operations['sim.worldPulse'].run({ source: frame, options: {} }).value;
  const publicId = 'ink:public-beat:gate/public/1.0';
  assert.equal(pulse.entries[0].event.beatId, publicId);
  assert.equal(links.references(frame)[0].beatId, publicId);
  assert.equal(links.references(pulse)[0].beatId, publicId);
});

test('report links retain the watch line, escaped pointer, source tick and relative rendered artifact', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-beat-inspect-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const frames = path.join(folder, 'watches'), out = path.join(folder, 'index');
  fs.mkdirSync(frames);
  fs.mkdirSync(out);
  const id = 'ink:beat:gate/main/4.0', wc = path.join(frames, 'watch.ndjson'), other = path.join(folder, 'other.json');
  const watch = {
    frame: 18, time: 1.8, frameFolder: 'frames/000018',
    previews: { 'pulse~/event': { file: 'previews/event.json', links: [{ beatId: id, tick: 4 }] } }
  };
  fs.writeFileSync(wc, '\n' + JSON.stringify(watch) + '\n');
  fs.writeFileSync(other, JSON.stringify({ beatId: 'ink:beat:gate/west/4.0' }));
  const result = locate(links, id, [wc, other], out);
  assert.deepEqual(result.matches, [{
    report: '../watches/watch.ndjson', pointer: '/previews/pulse~0~1event/links/0', line: 2,
    frame: 18, time: 1.8, tick: 4, artifact: '../watches/frames/000018/previews/event.json'
  }]);
  assert.deepEqual(result.unmatched, ['../other.json']);
  fs.writeFileSync(wc, JSON.stringify(watch));
  assert.equal(locate(links, id, [wc], out).matches[0].line, 1);
});

test('rehearsal keeps separate source observations and scheduled cue placements', () => {
  const id = 'ink:beat:gate/main/4.0';
  const cues = [2, 7, 10].map(frame => ({ frame, preset: 'amber', beatId: id }));
  const report = showReport({ cues, fps: 10, slowMs: 100 }, true);
  report.frame(4);
  report.cueLink(2, 'applied');
  report.graphLink('pulse', { beatId: id, tick: 4 });
  report.frame(8);
  report.cueLink(7, 'superseded');
  const { beatLinks } = report.finish('completed');
  assert.deepEqual(beatLinks.map(row => [row.beatId, row.status, row.scheduledFrame, row.frame, row.tick]), [
    [id, 'applied', 2, 4, undefined], [id, 'superseded', 7, 8, undefined],
    [id, 'not-reached', 10, undefined, undefined], [id, 'observed', undefined, 4, 4]
  ]);
});

test('legacy editorial reports resolve their original event references', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-beat-legacy-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const event = { world: 'gate', branch: 'main', id: '4.0', tick: 4 };
  const map = path.join(folder, 'map.json'), timeline = path.join(folder, 'timeline.json');
  fs.writeFileSync(map, JSON.stringify({
    format: 'ink-studio/clock-map-report',
    events: [{ event, edited: { seconds: 1.2, frame: 12 } }],
    cues: [{ anchor: { event }, at: { seconds: 1.2, showFrame: 12 } }]
  }));
  fs.writeFileSync(timeline, JSON.stringify({
    presentationCues: { format: 'ink-studio/presentation-cues', cues: [
      { source: event, time: 1.2, detail: { showFrame: 12 } }
    ] }
  }));
  const { matches } = locate(links, links.identify(event), [map, timeline], folder);
  assert.deepEqual(matches.map(({ pointer, frame, tick }) => [pointer, frame, tick]),
    [['/events/0', 12, 4], ['/cues/0', 12, 4], ['/presentationCues/cues/0', 12, 4]]);
});
