const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const folder = path.resolve(process.argv[2]);
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const cli = path.join(repo, 'cli/ink-studio.js');
const file = name => path.join(folder, name);
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [cli, ...args],
  { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });

fs.mkdirSync(folder, { recursive: true });
const world = require(path.join(repo, 'examples/world-access/harbor.world.json'));
world.causality = true;
world.custody = { objects: { 'archive/causeway-chart': {} } };
world.facts.types.argument = { fields: { topic: 'string' } };
world.commands.push(
  { tick: 2, action: 'world/event', args: { kind: 'arrival', actor: 'survey-skiff', label: 'Survey skiff enters the harbor',
    document: 'harbor-watch', story: 'dispatch', timing: { format: 'ink-studio/event-time', time: .16 } } },
  { tick: 3, action: 'world/discover-object', args: { object: 'archive/causeway-chart',
    to: { kind: 'actor', id: 'crew/surveyor' }, at: { place: 'harbor/quay' } } },
  { tick: 4, action: 'world/fact', args: { type: 'argument', at: { place: 'harbor/quay' },
    data: { topic: 'Which channel to signal' } } },
  { tick: 7, action: 'world/event', args: { kind: 'chart-checked', label: 'Signal team reviews the chart' } }
);
const boxes = [
  ['quay', [-1.8, -.18, -.25], [.75, .62, 1.85], [7, 8, 9, 10, 11]],
  ['jetty', [-.26, .03, -.2], [.92, .17, .25], [19, 20, 21, 22, 23]],
  ['chart-table', [-.65, .32, -.23], [.24, .045, .13], [20, 21, 22, 23]],
  ['chart', [-.64, .371, -.21], [.16, .009, .095], [18, 22, 23, 24]],
  ['skiff-hull', [.82, -.15, .57], [.47, .19, .24], [19, 20, 21, 22]],
  ['skiff-well', [.82, .015, .57], [.29, .047, .17], [0, 1, 2, 3]],
  ['skiff-mast', [.65, .35, .55], [.022, .34, .022], [19, 20, 21, 22]],
  ['skiff-sail', [.85, .47, .55], [.18, .19, .025], [4, 5, 6]],
  ['lantern-base', [-1.3, .57, -.8], [.21, .17, .19], [19, 20, 21, 22]],
  ['lantern', [-1.3, .81, -.8], [.1, .11, .09], [20, 22, 23, 24]],
  ['water-pool', [0, -.38, 0], [2.5, .025, 1.95], [13, 14, 15, 16]]
];
for (const [id, position, half, ramp] of boxes) world.entities[id] = { position, visual: { half, ramp } };
world.visual = { bounds: { min: [-2.6, -.5, -2.1], max: [2.6, 1.5, 2.1] },
  ground: -.48, resolution: .09, camera: { target: [-.25, .08, .02], dist: 6.3, yaw: .58, pitch: .6 } };
save('harbor.world.json', world);
save('release.actions.json', [
  { tick: 5, id: 'deck-release', action: 'world/story-choose', args: {
    document: 'harbor-watch', story: 'dispatch', stage: 'plan', visit: 1, branch: 'release', reason: 'crew-authorized'
  } }
]);

run('sim', 'run', 'harbor.world.json', '--ticks', '13', '--actions', 'release.actions.json', '--record', 'harbor.run.json');
assert.equal(read('harbor.run.json').end.history.length, 0);
run('sim', 'verify', 'harbor.run.json', '--out', 'harbor.verified.json');
assert.equal(read('harbor.verified.json').status, 'verified');
run('story', 'timeline', 'harbor.run.json', '--out', 'harbor.timeline.json');
const native = read('harbor.timeline.json');
assert.deepEqual(native.markers.map(row => row.category), ['arrival', 'discovery', 'argument', 'choice', 'outcome']);
assert.equal(native.markers[0].time, .16);
assert.equal(native.markers[0].source.tick, 2);
const discovery = native.markers.find(row => row.category === 'discovery');
run('sim', 'render', 'harbor.run.json', '--beat', discovery.beatId, '--w', '420', '--h', '260',
  '--colored', '--out', 'quay.png');
assert.equal(read('quay-beat.json').tick, discovery.source.tick);
run('timeline', 'harbor.timeline.json', '--out', 'harbor.timeline-inspection.json');

save('marker-plan.json', { format: 'ink-studio/story-marker-plan', version: 1, rules: [
  { on: { kind: 'world-fact', where: { path: '/payload/fact/type', value: 'argument' } },
    category: 'argument', label: 'The crew disputes the signal route' },
  { on: { kind: 'chart-checked' }, category: 'review', label: 'The signal team reviews the causeway chart' }
] });
run('story', 'timeline', 'harbor.run.json', '--plan', 'marker-plan.json', '--out', 'selected.timeline.json');
const selected = read('selected.timeline.json');
assert.equal(selected.markers.find(row => row.category === 'review').source.tick, 7);
assert.equal(selected.markers.find(row => row.category === 'argument').label, 'The crew disputes the signal route');
const choice = selected.markers.find(row => row.category === 'choice');
const sourceTime = choice.source.timecode;
const sourceBeat = choice.beatId;
choice.time = .75;
choice.label = 'Hold on the decision to light the lantern';
save('edited.timeline.json', {
  duration: 3, markers: [], sequences: { dispatch: selected },
  clips: [
    { id: 'review', sequence: 'dispatch', time: 1 },
    { id: 'recap', sequence: 'dispatch', time: 2.6, in: .5, out: 1, duration: .25 }
  ]
});
run('timeline', 'edited.timeline.json', '--out', 'edited.timeline-inspection.json');
const placements = read('edited.timeline-inspection.json').cues.filter(row => row.beatId === sourceBeat);
assert.deepEqual(placements.map(row => [row.path[0], row.time]), [['review', 1.75], ['recap', 2.725]]);
assert(placements.every(row => row.source.timecode.numerator === sourceTime.numerator &&
  row.source.timecode.denominator === sourceTime.denominator));
run('trace', 'harbor.run.json', 'world/cause', '--beat', sourceBeat, '--out', 'choice.trace.json');
run('beat', sourceBeat, 'harbor.timeline.json', 'edited.timeline.json', 'edited.timeline-inspection.json',
  'choice.trace.json', '--out', 'choice.inspection.json');
assert.deepEqual(read('choice.inspection.json').unmatched, []);
save('demo-summary.json', {
  markers: native.markers.map(row => ({ category: row.category, label: row.label, time: row.time, tick: row.source.tick })),
  choice: { beatId: sourceBeat, original: sourceTime, edited: placements.map(row => ({ clip: row.path[0], time: row.time })) }
});
console.log('Exported five committed harbor story beats. The edited choice appears at 1.750 and 2.725 seconds with one source ID.');
