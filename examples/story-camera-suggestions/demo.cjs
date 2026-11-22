const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..')), folder = path.resolve(process.argv[2]);
const cli = path.join(repo, 'cli/ink-studio.js'), file = name => path.join(folder, name);
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });

fs.mkdirSync(folder, { recursive: true });
const world = require(path.join(repo, 'examples/world-access/harbor.world.json'));
world.id = 'chartroom-harbor';
world.causality = true;
world.visual = { bounds: { min: [-3, -.6, -2.6], max: [3, 2.4, 2.7] },
  ground: -.46, resolution: .055, camera: { target: [0, .43, .25], dist: 7, yaw: 0, pitch: .52 } };
world.custody = { objects: { 'archive/tide-chart': { label: 'Copper tide chart', entity: 'chart' } } };
world.facts.types.argument = { subjects: { pilot: 'actor', keeper: 'actor' }, fields: { topic: 'string' } };
const scope = { document: 'harbor-watch', story: 'dispatch' };
const story = world.storyDocuments[0].stories.dispatch;
story.roles = { pilot: { kind: 'actor' }, keeper: { kind: 'actor' } };
story.stages.plan.roles = ['pilot', 'keeper'];
world.storyBindings = { 'harbor-watch/dispatch': {
  pilot: { kind: 'actor', value: { entity: 'pilot' } },
  keeper: { kind: 'actor', value: { entity: 'keeper' } }
} };
world.commands.push(
  { tick: 2, action: 'world/event', args: { kind: 'arrival', actor: 'pilot', ...scope,
    label: 'Pilot reaches the tide chartroom', at: { entity: 'doorway', place: 'chartroom' } } },
  { tick: 3, action: 'world/discover-object', args: { object: 'archive/tide-chart',
    to: { kind: 'actor', id: 'pilot' }, at: { entity: 'chart', place: 'chartroom/cabinet' } } },
  { tick: 4, action: 'world/fact', args: { type: 'argument', subjects: { pilot: 'pilot', keeper: 'keeper' },
    at: { place: 'chartroom/jetty' }, data: { topic: 'Which passage to signal' } } }
);

const pieces = [
  ['platform', [0, -.14, .05], [2.45, .22, 1.85], [7, 8, 9, 10, 11]],
  ['dock', [0, -.41, 0], [2.9, .025, 2.4], [13, 14, 15, 16]],
  ['doorway', [-1.86, .44, -.78], [.10, .51, .18], [19, 20, 21, 22]],
  ['doorway-post', [-2.13, .44, -.78], [.07, .51, .18], [19, 20, 21, 22]],
  ['doorway-lintel', [-2, 1.0, -.78], [.24, .09, .19], [19, 20, 21, 22]],
  ['pilot', [-1.05, .59, -.55], [.19, .33, .16], [13, 14, 15, 16]],
  ['pilot-face', [-1.05, 1.0, -.55], [.12, .13, .12], [20, 21, 22, 23]],
  ['pilot-cap', [-1.05, 1.15, -.53], [.15, .055, .13], [14, 15, 16, 17]],
  ['keeper', [1.04, .65, -.27], [.24, .37, .18], [19, 20, 21, 22]],
  ['keeper-face', [1.04, 1.06, -.27], [.13, .14, .13], [20, 21, 22, 23]],
  ['keeper-cap', [1.04, 1.21, -.25], [.17, .052, .16], [0, 1, 2, 3]],
  ['cabinet-base', [.14, .27, 1.01], [.35, .20, .29], [19, 20, 21, 22]],
  ['cabinet-back', [.14, .62, .77], [.35, .26, .05], [19, 20, 21, 22]],
  ['cabinet-door', [.14, .58, 1.40], [.35, .30, .055], [19, 20, 21, 22]],
  ['cabinet-side', [-.20, .59, 1.10], [.045, .30, .30], [19, 20, 21, 22]],
  ['chart', [.14, .52, 1.02], [.16, .06, .09], [19, 22, 23, 24]],
  ['marker-post', [1.85, .60, .94], [.08, .55, .08], [19, 20, 21, 22]],
  ['signal-lantern', [1.85, 1.23, .94], [.12, .13, .105], [19, 22, 23, 24]]
];
for (const [id, position, half, ramp] of pieces) world.entities[id] = { position, visual: { half, ramp } };
for (const actor of ['pilot', 'keeper']) for (const part of ['face', 'cap']) {
  const entity = world.entities[actor + '-' + part];
  entity.parent = actor;
  entity.position = entity.position.map((value, axis) => value - world.entities[actor].position[axis]);
}
save('chartroom.world.json', world);
save('release.actions.json', [{ tick: 5, id: 'chartroom-release', action: 'world/story-choose',
  args: { ...scope, stage: 'plan', visit: 1, branch: 'release', reason: 'watch-authorized' } }]);

const source = 'chartroom.run.json';
run('sim', 'run', 'chartroom.world.json', '--ticks', '14', '--actions', 'release.actions.json', '--record', source);
run('story', 'shots', source, '--out', 'suggestions.json');
const plan = read('suggestions.json'), find = category => plan.beats.find(row => row.category === category);
const discovery = find('discovery'), argument = find('argument'), choice = find('choice'), outcome = find('outcome');
assert.equal(discovery.subjects[0].entity, 'chart');
assert(discovery.shots.some(row => row.id === 'section' && row.occlusion.blocker === 'cabinet-door'));
assert.equal(argument.selected, 'pair');
assert(Math.abs(argument.relationship.distance - Math.hypot(2.09, .06, .28)) < 1e-9);
assert(choice.turningPoint && outcome.turningPoint);
assert.equal(outcome.selected, null);
save('review-plan.json', { ...plan, beats: [discovery, argument] });
run('story', 'shots-review', source, 'review-plan.json', '--all', '--w', '240', '--h', '156', '--out', 'review');
const first = read('review/report.json'), preview = (row, name) =>
  first.previews.find(frame => frame.shot === row.id + '-' + name);
const occluded = preview(discovery, 'insert'), revealed = preview(discovery, 'section');
const count = row => row.visible.find(subject => subject.id === 'chart')?.pixels ?? 0;
assert(count(revealed) > count(occluded), 'The section should reveal more chart pixels');
assert(first.previews.some(frame => frame.shot === argument.id + '-pair' && frame.visible.every(subject => subject.pixels > 0)));

run('story', 'timeline', source, '--out', 'story.timeline.json');
const timeline = read('story.timeline.json');
const recordedChoice = timeline.markers.find(row => row.category === 'choice');
recordedChoice.time = .72;
recordedChoice.label = 'Hold on the keeper before the answer';
save('editorial.timeline.json', timeline);
run('story', 'shots', source, '--timeline', 'editorial.timeline.json', '--out', 'timed-suggestions.json');
const edited = read('timed-suggestions.json');
const picked = edited.beats.find(row => row.beatId === choice.beatId);
assert.equal(picked.time, .72);
picked.selected = 'insert';
picked.time = .85;
edited.beats.find(row => row.category === 'arrival').selected = null;
save('edited-plan.json', edited);
run('story', 'shots-review', source, 'edited-plan.json', '--w', '240', '--h', '156', '--out', 'edited');
const second = read('edited/report.json'), placement = second.cuts.find(row => row.beatId === choice.beatId);
assert.deepEqual([placement.time, placement.tick], [.85, 5]);
assert.equal(read('edited/camera-rig.json').sequence.at(-1).time, .85);
run('beat', choice.beatId, 'suggestions.json', 'editorial.timeline.json', 'edited/report.json', '--out', 'choice.inspection.json');
assert.deepEqual(read('choice.inspection.json').unmatched, []);
save('demo-summary.json', {
  argument: { distance: argument.relationship.distance, shot: preview(argument, 'pair').file },
  discovery: { blocker: 'cabinet-door', before: occluded.file, after: revealed.file, pixels: [count(occluded), count(revealed)] },
  choice: { beatId: choice.beatId, tick: placement.tick, editedTime: placement.time, shot: placement.shot }
});
console.log('Reviewed the two-person argument and cabinet section. The edited choice still resolves to tick 5.');
