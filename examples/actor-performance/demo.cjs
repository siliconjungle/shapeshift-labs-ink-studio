const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const root = path.resolve(process.argv[3] ?? path.join(__dirname, '../..')), folder = path.resolve(process.argv[2]);
const { KIT: K } = require(root).load(), W = K.world, P = K.procedural, R = P.raster, D = P.drawing2d;
const PNG = require(path.join(root, 'cli/png.js')), { grid } = require(path.join(root, 'cli/render.js'));
const cli = path.join(root, 'cli/ink-studio.js'), file = name => path.join(folder, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const run = (...args) => execFileSync(process.execPath, [cli, ...args],
  { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });
const writePng = (name, source) => {
  const image = R.rgba(source);
  fs.writeFileSync(file(name), PNG.encode(image.width, image.height, image.data, 4));
};

const story = 'harbor-watch/dispatch', scope = { document: 'harbor-watch', story: 'dispatch' };
const rect = (x, y, w, h, fill, radius) => ({ type: 'rect', rect: [x, y, w, h], fill, ...(radius !== undefined && { radius }) });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const glyph = (value, x, y, color, scale = 1) => ({ type: 'text', text: value, at: [x, y], color, scale });
const raster = (width, height, commands) => D.render({ width, height, commands, edges: 'hard' });

function portrait(coat, accent, skin, cap) {
  return raster(132, 124, [
    rect(53, 91, 12, 25, '#28394e', 3), rect(70, 91, 12, 25, '#28394e', 3),
    rect(49, 111, 17, 7, '#1d293a', 2), rect(70, 111, 17, 7, '#1d293a', 2),
    rect(43, 61, 47, 44, coat, 9), rect(50, 69, 7, 30, accent, 3),
    rect(64, 58, 14, 12, skin, 4), ellipse(48, 26, 48, 39, skin),
    ellipse(44, 43, 10, 13, skin), ellipse(90, 43, 8, 13, skin),
    rect(46, 23, 49, 16, cap, 4), rect(53, 16, 38, 12, cap, 6),
    rect(48, 31, 48, 6, accent, 2),
    rect(62, 43, 5, 5, '#172338', 1), rect(79, 43, 5, 5, '#172338', 1),
    rect(60, 39, 10, 2, '#3b2831', 1), rect(77, 39, 10, 2, '#3b2831', 1),
    rect(68, 55, 11, 3, '#935454', 1), ellipse(76, 49, 8, 4, '#f7ceb2'),
    { type: 'polygon', points: [[82, 69], [89, 66], [111, 85], [104, 95], [85, 80]], fill: coat },
    ellipse(101, 85, 15, 12, skin), rect(81, 67, 9, 14, accent, 2),
    rect(65, 81, 8, 9, '#e8c66b', 2)
  ]);
}

fs.mkdirSync(folder, { recursive: true });
const world = structuredClone(require(path.join(root, 'examples/world-access/harbor.world.json')));
world.id = 'tide-signal';
world.causality = true;
world.entities.pilot = { position: [-1, 0, 0] };
world.entities.keeper = { position: [1, 0, 0] };
world.storyDocuments[0].stories.dispatch.roles = { pilot: { kind: 'actor' }, keeper: { kind: 'actor' } };
world.storyBindings = { [story]: {
  pilot: { kind: 'actor', value: { entity: 'pilot' } },
  keeper: { kind: 'actor', value: { entity: 'keeper' } }
} };
world.commands.push(
  { tick: 1, action: 'world/event', args: { kind: 'keepers-arrival', ...scope } },
  { tick: 2, action: 'world/event', args: {
    kind: 'tide-warning', ...scope, transcript: 'THE TIDE IS RISING.',
    timing: { format: 'ink-studio/event-time', time: .185 }
  } },
  { tick: 15, action: 'world/event', args: { kind: 'shelve-chart', ...scope } }
);
save('tide.world.json', world);
save('choose.actions.json', [{ tick: 8, action: 'world/story-choose', id: 'answer-the-pilot',
  args: { ...scope, stage: 'plan', visit: 1, branch: 'release', reason: 'watch-authorized' } }]);
const warning = { kind: 'tide-warning', story }, answer = { kind: 'story-branch-chosen', story,
  where: { path: '/payload/branch', value: 'release' } };
const motion = (angle, scale) => ({
  gestures: { signal: { duration: .52, tracks: { arm: [
    { time: 0, angle: 0 }, { time: .15, angle }, { time: .32, angle }, { time: .52, angle: 0 }
  ] } } },
  expressions: { alert: { duration: .46, tracks: { brow: [
    { time: 0, scale: 1 }, { time: .15, scale, translate: [0, -2] }, { time: .46, scale: 1 }
  ] } } }
});
const slot = (name, label, visible, angle, scale) =>
  ({ role: { story, role: name }, label, visible, sockets: { hand: 'grip' }, ...motion(angle, scale) });
const cue = (on, kind, target, detail, extra) => ({ on, cue: { kind, target, detail, ...extra } });
const plan = { format: W.actorPerformance.planFormat, version: 1, id: 'tide-signal', cast: {
  pilot: slot('pilot', 'PILOT', true, -.95, 1.22),
  keeper: slot('keeper', 'KEEPER', false, -.74, .88)
}, props: { chart: { home: 'stand' } }, rules: {
  '01-keeper-enters': cue({ kind: 'keepers-arrival', story }, 'cast', 'keeper', { visible: true }),
  '02-pilot-points': cue(warning, 'gesture', 'pilot', { clip: 'signal' }),
  '03-pilot-reacts': cue(warning, 'expression', 'pilot', { clip: 'alert' }),
  '04-pilot-warns': cue(warning, 'dialogue', 'pilot', { text: '', duration: .55 }, { bindings: { '/text': '/payload/transcript' } }),
  '05-pilot-chart': cue(warning, 'prop', 'chart', { actor: 'pilot', socket: 'hand' }),
  '06-keeper-points': cue(answer, 'gesture', 'keeper', { clip: 'signal' }),
  '07-keeper-reacts': cue(answer, 'expression', 'keeper', { clip: 'alert' }),
  '08-keeper-replies': cue(answer, 'dialogue', 'keeper', { text: 'LIGHT THE LANTERN.', duration: .62 }),
  '09-chart-handoff': cue(answer, 'prop', 'chart', { actor: 'keeper', socket: 'hand' }),
  '10-chart-home': cue({ kind: 'shelve-chart', story }, 'prop', 'chart', { actor: null })
} };
save('performance-plan.json', plan);
run('sim', 'run', 'tide.world.json', '--ticks', '17', '--actions', 'choose.actions.json', '--record', 'tide.run.json');
run('story', 'performance', 'tide.run.json', 'performance-plan.json', '--out', 'performance');
const sheet = read('performance/performance.json'), adapter = W.actorPerformance.open(sheet);
assert.deepEqual(sheet.cast.pilot.actor, { entity: 'pilot' });
assert.deepEqual(sheet.cast.keeper.actor, { entity: 'keeper' });
assert.equal(adapter.dialogue.length, 2);

writePng('pilot.png', portrait('#287c86', '#62b6ac', '#dba283', '#254455'));
writePng('keeper.png', portrait('#9a553c', '#e58b55', '#b77761', '#4d3350'));
const bones = [
  { id: 'body', pivot: [68, 103], tip: [68, 62] },
  { id: 'arm', parent: 'body', pivot: [85, 72], tip: [109, 91] },
  { id: 'brow', parent: 'body', pivot: [75, 40], tip: [87, 38] }
];
const segments = [33, 31];
const weights = [];
for (let j = 0; j <= segments[1]; j++) for (let i = 0; i <= segments[0]; i++) {
  const x = i * 4, y = j * 4;
  const fade = a => Math.min(1, Math.max(0, a));
  const arm = fade((x - 81) / 13) * fade((y - 55) / 13) * fade((113 - y) / 12);
  const brow = fade((x - 60) / 14) * fade((99 - x) / 14) * fade(1 - Math.abs(y - 40) / 10);
  weights.push({ body: 1 - arm - brow, arm, brow });
}
const link = (node, port) => ({ node, ...(port && { port }) });
const nodes = { cues: { op: 'jsonAsset', inputs: { name: 'performance' } } };
const outputs = {}, exported = {};
for (const actor of ['pilot', 'keeper']) {
  nodes[actor] = { op: 'pngAsset', inputs: { name: actor } };
  nodes[actor + 'Performance'] = { op: 'scene.actorPerformance', inputs: { sheet: link('cues'), actor } };
  nodes[actor + 'Bind'] = { op: 'rig.bindSprite', inputs: { source: link(actor), bones,
    options: { segments, weights } } };
  nodes[actor + 'Skin'] = { op: 'rig.skinSprite', inputs: {
    source: link(actor), bind: link(actor + 'Bind'), pose: link(actor + 'Performance', 'pose')
  } };
  outputs[actor] = link(actor + 'Skin');
  outputs[actor + 'Joints'] = link(actor + 'Skin', 'joints');
  exported[actor] = { output: actor, format: 'png' };
  exported[actor + 'Joints'] = { output: actor + 'Joints', format: 'json' };
}
nodes.caption = { op: 'draw.text', inputs: { text: link('pilotPerformance', 'caption'),
  options: { columns: 26, scale: 2, color: '#e6dfc9' } } };
outputs.caption = link('caption');
outputs.state = link('pilotPerformance');
exported.caption = { output: 'caption', format: 'png' };
exported.state = { output: 'state', format: 'json' };
save('performance.graph.json', { format: 'ink-studio/graph-project', version: 1, assets: {
  pilot: { format: 'png', file: 'pilot.png' }, keeper: { format: 'png', file: 'keeper.png' },
  performance: { format: 'json', file: 'performance/performance.json' }
}, nodes, outputs, exports: exported });

const chart = raster(18, 18, [rect(0, 0, 18, 18, '#b97645', 3),
  rect(2, 2, 14, 13, '#f2cf7b', 2), rect(4, 6, 9, 1, '#9d6745'), rect(4, 9, 7, 1, '#9d6745')]);
const stage = raster(344, 224, [
  rect(0, 0, 344, 224, '#122037'), rect(10, 36, 324, 119, '#1d3551', 8),
  ellipse(57, 39, 51, 51, '#23445b'), ellipse(226, 38, 52, 52, '#283f57'),
  rect(32, 151, 280, 3, '#4b6267', 1), rect(161, 124, 25, 24, '#75594b', 2),
  rect(157, 122, 33, 5, '#b28a60', 2), rect(10, 168, 324, 46, '#0d192c', 5),
  glyph('TIDE SIGNAL', 15, 12, '#68c5bd', 2), glyph('HARBOR WATCH', 238, 17, '#d4a96a'),
  glyph('PILOT', 80, 143, '#8fd6d2'), glyph('KEEPER', 221, 143, '#f0af8b')
]);
const locations = { pilot: [19, 25], keeper: [185, 25] };
const shadow = raster(132, 124, [ellipse(24, 109, 89, 11, '#122237')]);
const loadPng = name => {
  const { w, h, data } = PNG.raster(file(name));
  return { width: w, height: h, data };
};
const rgb = source => {
  const { width: w, height: h, data } = R.rgba(source), bytes = new Uint8Array(w * h * 3);
  for (let n = 0; n < w * h; n++) bytes.set(data.subarray(n * 4, n * 4 + 3), n * 3);
  return { w, h, rgb: bytes };
};
const samples = [['ready', .04], ['warning', .43], ['handoff', 1.04], ['return', 1.6]];
const receipts = [];
for (const [name, time] of samples) {
  const out = 'samples/' + name, asset = value => out + '/artifacts/' + value;
  run('graph', 'run', 'performance.graph.json', '--at', String(time), '--out', out);
  const sample = read(asset('state.json'));
  const stageNodes = { stand: { transform: { position: [173, 123, 0] } }, chart: {} };
  for (const [actor, [x, y]] of Object.entries(locations)) {
    const tip = read(asset(actor + 'Joints.json')).arm.tip;
    stageNodes[actor] = { transform: { position: [x, y, 0] }, sockets: { grip: { position: [...tip, 0] } } };
  }
  const graph = W.actorPerformance.scene({ nodes: stageNodes }, sample), frame = graph.frame('chart');
  let image = stage;
  for (const [actor, [x, y]] of Object.entries(locations)) if (graph.frame(actor).visible) {
    image = R.blend(image, shadow, { x, y });
    image = R.blend(image, loadPng(asset(actor + '.png')), { x, y });
  }
  if (frame.visible) image = R.blend(image, chart, { x: Math.round(frame.position[0]) - 9, y: Math.round(frame.position[1]) - 9 });
  image = R.blend(image, loadPng(asset('caption.png')), { x: 19, y: 176 });
  writePng(name + '.png', image);
  receipts.push({ name, time, caption: sample.caption, cast: sample.cast, prop: sample.props.chart,
    position: frame.position, cues: sample.active });
}
assert.equal(receipts[0].cast.keeper.visible, false);
assert.equal(receipts[1].prop.parent.node, 'pilot');
assert.equal(receipts[2].prop.parent.node, 'keeper');
assert.equal(receipts[3].prop.parent, 'stand');
assert.equal(receipts[1].cues.filter(row => row.kind === 'gesture' || row.kind === 'expression').length, 2);
save('stage-samples.json', receipts);
const contact = grid(samples.map(([name]) => rgb(loadPng(name + '.png'))), 2);
PNG.write(file('contact.png'), contact.w, contact.h, contact.rgb);

const edited = structuredClone(sheet.presentationCues), reply = edited.cues.find(row => row.kind === 'dialogue' && row.target === 'keeper');
reply.time = 1.12;
delete reply.timecode;
const portable = structuredClone(plan);
for (const [name, actor] of Object.entries(sheet.cast)) portable.cast[name].actor = actor.actor;
delete portable.rules;
save('edited.cue-sheet.json', edited);
save('portable-plan.json', portable);
run('story', 'performance', 'edited.cue-sheet.json', 'portable-plan.json', '--out', 'offline');
const line = read('offline/lettering.json').lines.find(row => row.actor === 'keeper');
assert.deepEqual([line.time, line.source.tick, line.beatId], [1.12, 8, reply.beatId]);
run('beat', line.beatId, 'performance/performance.json', 'performance/lettering.json', 'offline/lettering.json',
  '--out', 'response.inspection.json');
assert.deepEqual(read('response.inspection.json').unmatched, []);
save('demo-summary.json', { activeCues: sheet.presentationCues.cues.length,
  chart: receipts.map(row => ({ at: row.time, parent: row.prop.parent, position: row.position })),
  reply: { time: line.time, originalTick: line.source.tick, beatId: line.beatId } });
console.log('Rendered the performed exchange and rebuilt the edited captions from a portable cue sheet.');
