const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [webgpu-module]');
const root = path.resolve(process.env.INK_STUDIO_REPO ?? path.join(__dirname, '../..'));
const folder = path.resolve(process.argv[2]);
const gpu = process.argv[3] ? ['--gpu-module', path.resolve(process.argv[3])] : [];
const { KIT: K } = require(root).load(), { world: W, procedural: P } = K;
const PNG = require(path.join(root, 'cli/png.js'));
const { grid } = require(path.join(root, 'cli/render.js'));
const cli = path.join(root, 'cli/ink-studio.js');
const file = name => path.join(folder, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
  { cwd: folder, maxBuffer: 12 * 1024 * 1024 });

fs.mkdirSync(folder, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'beacon.wgsl'), file('beacon.wgsl'));

const scope = { document: 'harbor-watch', story: 'dispatch' };
const sid = 'harbor-watch/dispatch';
const lantern = [0.45, 1.13, -0.6];
const solid = (position, half, ramp) => ({ position, visual: { half, ramp } });
const stone = [1, 2, 3, 4, 5], wood = [13, 14, 15, 16, 17], metal = [19, 20, 21, 22, 23];
const world = structuredClone(require(path.join(root, 'examples/world-access/harbor.world.json')));
Object.assign(world, {
  id: 'beacon-shift',
  causality: true,
  takeClock: { fps: 10, simulationRate: 10, sampleRate: 48000, cuts: [{ frame: 0, id: 'harbor' }] },
  entities: {
    pier: solid([0, -.12, -.46], [1.94, .17, .44], wood),
    lighthouse: solid([.45, .47, -.60], [.23, .53, .23], stone),
    lantern: solid(lantern, [.26, .13, .26], wood),
    roof: solid([.45, 1.32, -.60], [.31, .08, .31], metal),
    seawall: solid([-1.06, .12, -1.11], [1.17, .26, .11], stone),
    skiff: solid([-1.52, .03, .65], [.41, .10, .21], metal),
    keeper: solid([1.26, .23, -.42], [.11, .25, .10], wood)
  },
  visual: {
    bounds: { min: [-2.9, -.26, -2.0], max: [2.9, 1.7, 1.8] }, ground: -.24, resolution: .077,
    skyEnvironment: { defaults: { zenith: '#293b61', horizon: '#6a86a9', ground: '#254251', sunStrength: 0 } },
    camera: { target: [.03, .42, -.12], dist: 6.2, yaw: .34, pitch: .38 }
  },
  eventActions: {
    light: { on: { kind: 'story-branch-chosen', where: { path: '/branch', value: 'release' } },
      actions: [{ action: 'world/event', args: { kind: 'beacon-lit', ...scope, point: lantern, load: .92 } }] }
  },
  commands: [
    { tick: 1, action: 'world/event', args: { kind: 'dispatch-ready', ...scope } },
    ...Array.from({ length: 9 }, (_, i) => ({ tick: i + 8, action: 'world/patch', args: {
      edits: [{ op: 'set', path: '/entities/skiff/position', value: [-1.42 + i * .16, .03, .65] }]
    } }))
  ]
});
save('beacon.world.json', world);
save('choice.json', [{ tick: 6, action: 'world/story-choose', id: 'light-the-beacon',
  args: { ...scope, stage: 'plan', visit: 1, branch: 'release', reason: 'skiff-in-range' } }]);
save('performance.plan.json', { format: W.actorPerformance.planFormat, version: 1, id: 'beacon', cast: {
  keeper: { actor: { entity: 'keeper' }, label: 'KEEPER', gestures: { light: { duration: .9, tracks: { arm: [
    { time: 0, angle: 0 }, { time: .2, angle: -1.65 }, { time: .64, angle: -1.65 }, { time: .9, angle: 0 }
  ] } } } }
}, rules: {
  lift: { on: { kind: 'beacon-lit', story: sid }, cue: { kind: 'gesture', target: 'keeper', detail: { clip: 'light' } } },
  speak: { on: { kind: 'beacon-lit', story: sid }, cue: { kind: 'dialogue', target: 'keeper',
    detail: { text: 'COME IN.', duration: 1 } } }
} });
const fx = (kind, detail, target) => ({ on: { kind: 'beacon-lit', story: sid }, cue: { kind,
  ...(target && { target }), detail: { value: 0, duration: .75, release: .38, ...detail },
  bindings: { '/value': '/payload/load' } } });
save('effects.plan.json', { format: W.eventVisualEffects.planFormat, version: 1, id: 'beacon', rules: {
  light: fx('light', { radius: 2.2, intensity: 3.5, color: '#ffd28d' }),
  mist: fx('fog', { offset: [0, -.82, 0], radius: 1.9, height: .42, density: .9, color: '#77aab9' }),
  sparks: fx('particles', { offset: [0, .06, 0], radius: .038, count: 24, speed: .72, color: '#ffe297' }),
  refraction: fx('shader', {}, 'beacon-refract')
} });

const width = 320, height = 192;
const rect = (x, y, w, h, fill, radius = 0) => ({ type: 'rect', rect: [x, y, w, h], fill, radius });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const polygon = (points, fill) => ({ type: 'polygon', points, fill });
const raster = (w, h, commands) => P.drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
function png(name, source) {
  const image = P.raster.rgba(source);
  fs.writeFileSync(file(name), PNG.encode(image.width, image.height, image.data, 4));
}

png('backdrop.png', raster(width, height, [
  rect(0, 0, width, height, '#273650'), ellipse(232, 25, 30, 30, '#f5cf9e'),
  rect(0, 90, 320, 70, '#31546b'), rect(0, 116, 320, 43, '#284457'),
  ...Array.from({ length: 12 }, (_, i) => rect((i * 79 + 29) % 283, 99 + i * 4, 14 + i % 5 * 3, 1, '#587b89')),
  polygon([[191, 153], [229, 118], [320, 124], [320, 169], [93, 169]], '#333d4f'),
  polygon([[254, 115], [257, 63], [270, 63], [276, 115]], '#e0b294'),
  rect(256, 59, 16, 6, '#502d46'), rect(257, 49, 13, 10, '#ffae69'),
  polygon([[254, 50], [264, 42], [274, 50]], '#793c53'),
  rect(0, 158, 320, 34, '#172437'), rect(0, 158, 320, 2, '#bd805b')
]));
png('keeper.png', raster(120, 120, [
  ellipse(16, 106, 70, 10, '#192b3b'), rect(31, 87, 13, 24, '#273452', 3),
  rect(57, 87, 13, 24, '#273452', 3), rect(26, 108, 19, 7, '#1a2536', 2),
  rect(56, 108, 20, 7, '#1a2536', 2), rect(29, 51, 46, 44, '#bd633f', 7),
  rect(36, 56, 6, 31, '#f1b77a', 3), rect(47, 46, 15, 12, '#a85755', 3),
  ellipse(29, 18, 46, 35, '#d68e72'), rect(29, 14, 43, 15, '#503751', 5),
  rect(34, 9, 29, 11, '#503751', 5), rect(30, 24, 48, 5, '#e08a67', 2),
  rect(43, 33, 4, 5, '#302945'), rect(61, 33, 4, 5, '#302945'),
  rect(55, 44, 11, 2, '#9b4c4b', 1),
  polygon([[70, 54], [78, 57], [102, 77], [94, 86], [72, 70]], '#cb734a'),
  ellipse(92, 76, 13, 12, '#d68e72'),
  rect(97, 81, 15, 18, '#643e52', 3), rect(101, 84, 7, 10, '#ffd185', 2)
]));
const node = (id, port) => ({ node: id, ...(port && { port }) });
const segments = [30, 30], weights = [];
const fade = n => Math.max(0, Math.min(1, n));
for (let j = 0; j <= segments[1]; j++) for (let i = 0; i <= segments[0]; i++) {
  const x = i * 4, y = j * 4;
  const arm = fade((x - 70) / 16) * fade((y - 50) / 9) * fade((110 - y) / 10);
  weights.push({ body: 1 - arm, arm });
}
save('puppet.graph.json', { format: 'ink-studio/graph-project', version: 1,
  assets: { backdrop: { format: 'png', file: 'backdrop.png' }, keeper: { format: 'png', file: 'keeper.png' } },
  inputs: { performance: { type: 'record' } }, nodes: {
    backdrop: { op: 'pngAsset', inputs: { name: 'backdrop' } },
    keeper: { op: 'pngAsset', inputs: { name: 'keeper' } },
    cues: { op: 'scene.actorPerformance', inputs: { sheet: { input: 'performance' }, actor: 'keeper' } },
    bind: { op: 'rig.bindSprite', inputs: { source: node('keeper'), bones: [
      { id: 'body', pivot: [54, 87], tip: [54, 57] },
      { id: 'arm', parent: 'body', pivot: [74, 59], tip: [99, 80] }
    ], options: { segments, weights } } },
    pose: { op: 'rig.skinSprite', inputs: { source: node('keeper'), bind: node('bind'), pose: node('cues', 'pose') } },
    stage: { op: 'raster.blend', inputs: { background: node('backdrop'), foreground: node('pose'), options: { x: 46, y: 39 } } },
    lettering: { op: 'draw.text', inputs: { text: node('cues', 'caption'),
      options: { columns: 25, scale: 2, color: '#ffd393' } } },
    caption: { op: 'raster.blend', inputs: {
      background: node('stage'), foreground: node('lettering'), options: { x: 22, y: 170 }
    } }
  }, outputs: { picture: node('caption') } });

save('markers.plan.json', { format: W.storySceneTimeline.planFormat, version: 1, rules: [
  { on: { kind: 'beacon-lit', story: sid }, category: 'signal', label: 'West beacon lit' }
] });
const size = { width, height };
const plan = { format: 'ink-studio/story-presentation-plan', version: 1, id: 'beacon',
  window: { fromFrame: 0, toFrame: 18, fps: 10 }, performance: 'performance.plan.json', effects: 'effects.plan.json',
  markers: 'markers.plan.json',
  views: {
    operations: { mode: 'debug', ...size, story: sid, entities: ['pier', 'lantern', 'skiff', 'keeper'] },
    stage: { mode: 'puppet', ...size, graph: 'puppet.graph.json' },
    harbor: { mode: 'splat', ...size },
    light: { mode: 'webgpu', source: 'harbor', shader: 'beacon.wgsl', channel: 'beacon-refract' },
    screen: { mode: 'projector', source: 'light', surfaces: [{
      id: 'main', corners: [[0, 0], [1, 0], [1, 1], [0, 1]]
    }] }
  }
};
save('beacon.present.json', plan);
run('sim', 'run', 'beacon.world.json', '--ticks', '18', '--actions', 'choice.json', '--record', 'beacon.run.json');
run('story', 'present', 'beacon.run.json', 'beacon.present.json', '--out', 'pack', ...gpu);
const pack = read('pack/presentation.json');
const beacon = pack.frames.flatMap(row => row.beats).find(row => row.kind === 'beacon-lit');
assert.ok(beacon);
assert.ok(pack.views.stage.frames.some(row => row.details.cues.some(cue => cue.beatId === beacon.beatId)));
assert.ok(pack.views.light.frames.some(row => row.details.cue?.beatId === beacon.beatId && row.details.amount > 0));
run('beat', beacon.beatId, 'pack/timeline.json', 'pack/presentation.json', 'pack/performance.json',
  'pack/effects.json', '--out', 'beacon.inspection.json');
assert.deepEqual(read('beacon.inspection.json').unmatched, []);

const view = (name, index) => PNG.raster(file('pack/' + pack.views[name].frames[index].file));
const banner = (title, tick) => raster(width, 24, [
  rect(0, 0, width, 24, '#121d2c'), rect(0, 23, width, 1, '#526e7b'),
  { type: 'text', text: title, at: [10, 8], color: '#b9e4dc' },
  { type: 'text', text: 'TICK ' + String(tick).padStart(2, '0'), at: [266, 8], color: '#8dabc6' }
]);
const titles = { operations: 'TOP-DOWN DEBUG', stage: 'PUPPET SCENE', harbor: 'NATIVE SPLAT', light: 'WEBGPU TREATMENT' };
const preview = (name, offset, tick) => {
  const picture = view(name, offset);
  const base = P.raster.canvas({ width, height: height + 24, color: [18, 29, 44] });
  const item = P.raster.blend(P.raster.blend(base, banner(titles[name], tick)), {
    width: picture.w, height: picture.h, data: picture.data
  }, { y: 24 });
  const rgb = new Uint8Array(item.width * item.height * 3);
  for (let i = 0; i < item.width * item.height; i++) rgb.set(item.data.subarray(i * 4, i * 4 + 3), i * 3);
  return { w: item.width, h: item.height, rgb };
};
fs.mkdirSync(file('comparison'), { recursive: true });
for (const { offset, tick } of pack.frames) {
  const canvas = grid(Object.keys(titles).map(name => preview(name, offset, tick)), 2);
  PNG.write(file('comparison/' + String(offset).padStart(6, '0') + '.png'), canvas.w, canvas.h, canvas.rgb);
}
fs.copyFileSync(file('comparison/000010.png'), file('beacon-four-views.png'));
ffmpeg('-y', '-framerate', '10', '-i', 'comparison/%06d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'beacon-four-views.mp4');
ffmpeg('-y', '-i', 'pack/views/screen/feed.mkv', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'beacon-projector.mp4');
const rgb = ffmpeg('-i', 'pack/views/screen/feed.mkv', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
assert.deepEqual(rgb, Buffer.concat(pack.frames.map(({ offset }) => Buffer.from(view('light', offset).data))));
run('patch', 'show', 'pack/views/screen/show.json', '--rehearse', '--report', 'rehearsal.json');

save('alternate.present.json', { ...plan, id: 'beacon-closeup', window: { fps: 10, fromFrame: 6, toFrame: 15 },
  views: { closeup: { mode: 'splat', ...size, camera: { target: [.52, .6, -.45], dist: 4.4, yaw: -.54, pitch: .23 } },
    screen: { mode: 'projector', source: 'closeup' } } });
run('story', 'present', 'beacon.run.json', 'alternate.present.json', '--out', 'alternate-pack');
const alternate = read('alternate-pack/presentation.json');
assert.equal(alternate.frames.find(row => row.tick === beacon.tick).beats.some(row => row.beatId === beacon.beatId), true);
fs.copyFileSync(file('alternate-pack/' + alternate.views.closeup.frames[4].file), file('beacon-alternate.png'));

save('demo-summary.json', { beacon, frame: pack.frames.find(row => row.tick === beacon.tick).frame,
  modes: Object.fromEntries(Object.entries(pack.views).map(([name, row]) => [name, row.mode])),
  projectorFramesCompared: pack.frames.length, alternateFromFrame: alternate.clock.fromFrame });
console.log('Rendered five synchronized outputs and verified every decoded projector frame against the WebGPU render.');
