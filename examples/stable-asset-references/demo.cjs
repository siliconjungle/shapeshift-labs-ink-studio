const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const out = path.resolve(process.argv[2] ?? 'studio/out/stable-asset-references');
const root = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const source = path.join(out, 'source'), stage = path.join(source, 'stage');
const engine = path.join(root, 'cli/ink-studio.js');
const WAV = require(path.join(root, 'cli/wav.js'));
const AssetFiles = require(path.join(root, 'cli/asset-references.js'));
const K = require(root).load().KIT;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [engine, ...args], { cwd: source, encoding: 'utf8' });
const ref = (id, revision = 1) => ({ asset: 'beacon/' + id, revision });
const entry = (id, kind, file, revision) => ({ ...ref(id, revision), kind, file: 'stage/' + file });
const registry = '../assets.json', catalog = path.join(source, 'assets.json');

fs.mkdirSync(stage, { recursive: true });
const wide = { shots: { watch: { target: [0, 1.25, 0], yaw: .53, pitch: .25, dist: 10 } } };
const close = { shots: { watch: { target: [0, 1.45, 0], yaw: -.46, pitch: .16, dist: 6.8 } } };
save(path.join(stage, 'rig-wide.json'), wide);
save(path.join(stage, 'rig-close.json'), close);
save(path.join(stage, 'signal-look.json'), { emission: { colors: ['#512532', '#ff7b42', '#fff5c2'], threshold: .12 } });
save(path.join(stage, 'screen.json'), [{ id: 'harbor-screen', corners: [[.04, .06], [.94, .02], [1, .95], [0, .92]],
  crop: [.04, 0, .97, 1], edges: [.06, .05, 0, 0], gain: .94, gamma: 1.1 }]);

function wav(file, duration, sample) {
  const sampleRate = 16000, count = Math.round(duration * sampleRate);
  const samples = Float64Array.from({ length: count }, (_, i) => sample(i / sampleRate));
  fs.writeFileSync(path.join(stage, file), WAV.encode({ sampleRate, channels: 1, samples }));
}
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);
wav('bell.wav', .65, t => .45 * Math.min(1, 400 * t) * Math.exp(-7 * t) *
  (.61 * sine(570, t) + .28 * sine(930, t) + .11 * sine(1613, t)));
// A synthetic two-syllable radio cue keeps the example reproducible without a speech service.
wav('radio.wav', .48, t => {
  const syllable = t < .24 ? 0 : 1, local = t % .24;
  const envelope = Math.min(1, local * 32) * Math.max(0, 1 - local * 4.2);
  const base = syllable ? 145 : 168;
  return envelope * (.19 * sine(base * 3, t) + .16 * sine(base * (syllable ? 6 : 5), t) + .065 * sine(base * 13, t));
});

const scene = { id: 'beacon-station', name: 'Beacon Station', seed: 7, style: 'slate', assetRegistry: registry,
  finish: { look: { effectPalettes: ref('signal-look') } }, solids: [
    { kind: 'ground', rad: 4, res: .18, mat: 'earth' },
    { kind: 'box', at: [0, .22, 0], half: [1.15, .22, .95], round: .05, mat: 'stone', res: .12 },
    { kind: 'box', at: [0, .62, 0], half: [.76, .22, .69], round: .05, mat: 'metal', res: .1 },
    { kind: 'lathe', at: [0, 1.26, 0], h: 1.2, r: [[0, .42], [.82, .3], [1, .35]], mat: 'pale', res: .09 },
    { kind: 'torus', at: [0, 1.92, 0], R: .44, r: .075, mat: 'metal', res: .065 },
    { kind: 'ball', at: [0, 2.17, 0], r: .33, mat: { role: 'glow', glow: true }, res: .06 },
    ...[-1, 1].map(side => ({ kind: 'box', at: [side * 1.05, .62, .41], half: [.12, .3, .12],
      mat: 'accent', res: .085 }))
  ] };
save(path.join(stage, 'scene-wide.json'), { ...scene, cameraRig: ref('camera', 1) });
save(path.join(stage, 'scene-close.json'), { ...scene, cameraRig: ref('camera', 2) });
const graph = { format: 'ink-studio/graph-project', version: 1, assetRegistry: registry,
  assets: { bell: { format: 'wav', file: ref('bell') } },
  nodes: {
    picture: { op: 'raster.canvas', inputs: { width: 128, height: 64, color: [40, 146, 151, 255] } },
    audio: { op: 'audioAsset', inputs: { name: 'bell' } }
  }, outputs: { picture: { node: 'picture' }, audio: { node: 'audio' } } };
save(path.join(stage, 'patch.json'), graph);
const assets = { scene: ref('station', 2), rig: ref('camera', 2), effect: ref('signal-look'), voice: ref('radio'),
  sound: ref('bell'), graph: ref('display'), projection: ref('screen') };
save(path.join(source, 'assets.draft.json'), { format: 'ink-studio/asset-registry', version: 1, entries: [
  entry('camera', 'rig', 'rig-wide.json', 1), entry('camera', 'rig', 'rig-close.json', 2),
  entry('station', 'scene', 'scene-wide.json', 1), entry('station', 'scene', 'scene-close.json', 2),
  entry('signal-look', 'effect', 'signal-look.json'), entry('radio', 'voice', 'radio.wav'),
  entry('bell', 'sound', 'bell.wav'), entry('display', 'graph', 'patch.json'), entry('screen', 'projection', 'screen.json')
] });
run('assets', 'lock', 'assets.draft.json', '--out', catalog);
run('assets', 'validate', catalog, '--out', path.join(out, 'asset-inventory.json'));

const render = ['--px1', '--w', '160', '--h', '120', '--asset-registry', catalog];
const before = path.join(out, 'beacon-wide.png'), after = path.join(out, 'beacon-close.png');
run('render', '@beacon/station@1', ...render, '--out', before);
run('render', '@beacon/station@2', ...render, '--out', after);
assert.notDeepEqual(fs.readFileSync(before), fs.readFileSync(after));
const sceneBundle = path.join(out, 'beacon-scene.bundle.json');
run('project', 'pack', 'stage/scene-close.json', '--root', '.', '--out', sceneBundle);
const moved = path.join(out, 'portable-close.png');
run('render', sceneBundle, '--px1', '--w', '160', '--h', '120', '--out', moved);
assert.deepEqual(fs.readFileSync(after), fs.readFileSync(moved));

const world = { format: K.world.format, version: 1, id: 'beacon-world', dt: .25, assetRegistry: registry,
  visual: { cameraRig: assets.rig, look: { effectPalettes: assets.effect } },
  commands: [{ tick: 1, action: 'world/event', args: { kind: 'beacon-lit' } }] };
save(path.join(stage, 'world.json'), world);
const simulation = K.world.runtime.create(AssetFiles.visual(K.authoring.assetReferences, world, 'world', path.join(stage, 'world.json')));
simulation.step();
save(path.join(out, 'committed.json'), { format: K.world.storyEvents.envelopeFormat, version: 1, world: world.id,
  dt: world.dt, from: 0, to: 1, coverage: 'complete', dropped: 0, events: simulation.committedEvents() });
save(path.join(source, 'cue-plan.json'), { format: K.world.presentationCues.planFormat, version: 1, id: 'beacon-cue',
  rules: { beacon: { on: { kind: 'beacon-lit' }, cue: { kind: 'beacon-call', label: 'Light up', assets } } } });
const cues = path.join(out, 'cue-sheet.json');
run('story', 'cues', path.join(out, 'committed.json'), 'cue-plan.json', '--asset-registry', catalog, '--out', cues);
assert.equal(Object.keys(read(cues).cues[0].assets).length, 7);
assert.match(read(cues).cues[0].assets.voice.sha256, /^[a-f0-9]{64}$/);

save(path.join(stage, 'soundtrack.json'), { format: 'ink-studio/scene-audio', version: 1, sampleRate: 16000,
  assetRegistry: registry, assets: { radio: assets.voice, bell: { graph: assets.graph, output: 'audio' } },
  tracks: [{ asset: 'radio', time: 0 }, { asset: 'bell', time: .5 }] });
run('export-scene', '@beacon/station@2', '--asset-registry', catalog, '--audio', 'stage/soundtrack.json',
  '--formats', 'loop', '--out', path.join(out, 'soundtrack'), '--w', '96', '--h', '64', '--fps', '4', '--to', '1.25');
const mix = path.join(out, 'soundtrack', read(path.join(out, 'soundtrack/export.json')).audio.mix);
assert(WAV.read(mix).samples.some(sample => Math.abs(sample) > .05));

save(path.join(stage, 'take.json'), { format: 'ink-studio/take', version: 1, id: 'beacon-take', assetRegistry: registry,
  clock: { fps: 4, simulationRate: 4, sampleRate: 16000 }, world: 'world.json', graph: assets.graph, audio: 'soundtrack.json' });
const takeBundle = path.join(out, 'beacon-take.bundle.json');
run('project', 'pack', 'stage/take.json', '--root', '.', '--out', takeBundle);
run('take', 'sample', takeBundle, '--frame', '1', '--out', path.join(out, 'take-frame.json'));

save(path.join(stage, 'show.json'), { format: 'ink-studio/patch-show', version: 1, assetRegistry: registry, patch: assets.graph,
  output: 'picture', frames: 2, fps: 5, slowMs: 1000, audio: assets.sound, projector: { wait: false, surfaces: assets.projection } });
const show = path.join(out, 'show-report.json');
run('patch', 'show', 'stage/show.json', '--rehearse', '--report', show);
assert.deepEqual(read(show).assetBindings.map(binding => binding.kind).sort(), ['graph', 'projection', 'sound']);
console.log('Beacon scene revisions select different camera rigs. The portable bundle renders the same close frame.');
console.log('The committed beacon cue pins all seven asset kinds. The take, soundtrack and projector use those same identities.');
