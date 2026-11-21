const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('a whole take publishes the same picture and sound, resumes, and replays shots after relocation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-take-bundle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source'), archive = path.join(dir, 'take.json');
  const source = file => path.join(root, file);
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(source(file)), { recursive: true });
    fs.writeFileSync(source(file), Buffer.isBuffer(data) ? data : JSON.stringify(data));
  };
  const run = (cwd, ...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const clock = { fps: 8, simulationRate: 32, sampleRate: 8000, cuts: [{ frame: 2, id: 'cut' }] };
  const take = { format: 'ink-studio/take', version: 1, clock, id: 'transfer',
    world: '../world/native.json', graph: '../graphs/animation.json', assetPack: '../looks/catalog.json',
    audio: '../media/sound.json', shots: { cover: '../shots/cover.json' } };
  write('take/take.json', take);
  write('world/native.json', { format: 'ink-studio/world', id: 'transfer', dt: 1 / 32,
    entities: { signal: { position: [0, 0, 0], visual: { half: [.4, .5, .2], ramp: [2, 4, 7] } } },
    timeline: { duration: .5, audio: [{ id: 'click', cue: 'signal', time: .125 }],
      tracks: [{ target: '/camera/yaw', keys: [{ time: 0, value: .4 }, { time: .5, value: -.35 }] }] } });
  write('graphs/groups/frame.json', { format: 'ink-studio/graph-group', version: 1,
    nodes: { solid: { op: 'raster.canvas', inputs: { width: 9, height: 5, color: [217, 130, 70] } } },
    outputs: { image: { node: 'solid' } } });
  const simulation = ink.load().KIT.procedural.rasterSimulation;
  const grain = simulation.session(simulation.define('grain', { width: 12, height: 8 }, { dt: 1 / 32 }));
  const graphStore = ink.openCheckpointStore(source('save/graph-blocks'));
  const savedGrain = graphStore.save(grain.seek(0).checkpoint).reference;
  write('save/grain.checkpoint', { ...savedGrain, store: 'graph-blocks' });
  write('graphs/animation.json', { format: 'ink-studio/graph-project', version: 1,
    groups: { Frame: 'groups/frame.json' },
    assets: { input: { file: '../media/switches.json', format: 'inputs' },
      grain: { file: '../save/grain.checkpoint', format: 'json' },
      signal: { file: '../media/signal.wav', format: 'wav' } },
    nodes: {
      render: { op: 'Frame' }, input: { op: 'inputAsset', params: { name: 'input' } },
      replay: { op: 'input.replay', inputs: { source: { node: 'input' } } },
      tone: { op: 'audioAsset', params: { name: 'signal' } },
      saved: { op: 'jsonAsset', inputs: { name: 'grain' } },
      resumed: { op: 'sim.run', inputs: { checkpoint: { node: 'saved' } } }
    },
    outputs: { picture: { node: 'render', port: 'image' }, input: { node: 'replay' }, tone: { node: 'tone' },
      simulation: { node: 'resumed' } } });
  write('media/switches.json', { format: 'ink-studio/input-recording', version: 1, initial: { switch: false },
    events: [{ time: .25, channel: 'switch', kind: 'set', value: true }] });
  write('media/signal.wav', ink.encodeWav({ sampleRate: 8000, channels: 1, samples: [.5, .25, .125] }));
  write('media/sound.json', { format: 'ink-studio/scene-audio', version: 1, sampleRate: 8000,
    assets: { signal: 'signal.wav', synth: { graph: 'synth.json', output: 'tone' } },
    tracks: [{ asset: 'synth', time: 0 }], spatial: { cues: { signal: 'signal' } } });
  write('media/synth.json', { format: 'ink-studio/graph-project', version: 1,
    nodes: { audio: { op: 'audio.buffer', params: { sampleRate: 8000, channels: 1, samples: [.25, -.25] } } },
    outputs: { tone: { node: 'audio' } } });
  write('looks/catalog.json', fs.readFileSync(path.join(__dirname, '../examples/relay-look-pack.json')));
  write('sets/cover.json', { id: 'cover', name: 'Cover',
    camera: { target: [0, .4, 0], dist: 4, yaw: .5, pitch: .25 },
    finish: { look: { asset: 'relay/glazed-enamel' } },
    solids: [{ id: 'lamp', kind: 'box', at: [0, .35, 0], half: [.4, .5, .3], mat: 'stone', res: .16 }] });
  run(root, 'render', 'sets/cover.json', '--asset-pack', 'looks/catalog.json',
    '--w', '48', '--h', '32', '--px', '1', '--recipe', 'shots/cover.json', '--out', path.join(dir, 'cover.png'));

  const { take: playback } = ink.readTake(source('take/take.json'));
  playback.seek(1);
  const blocks = source('save/blocks'), store = ink.openCheckpointStore(blocks);
  const { reference } = store.save(playback.checkpoint());
  write('save/resume.json', { ...reference, store: 'blocks' });
  write('save/blocks/unreachable.txt', 'Unused data');
  write('take/take.json', { ...take, checkpoint: '../save/resume.json' });
  const report = run(root, 'take', 'sample', 'take/take.json', '--frame', '3');
  assert.equal(JSON.parse(report).frame.fps, 8);
  const exportArgs = ['--w', '48', '--h', '32', '--to', '.5', '--formats', 'loop'];
  run(root, 'export-scene', 'take/take.json', ...exportArgs, '--out', '../before');
  run(root, 'graph', 'clip', 'graphs/animation.json', '--output', 'picture',
    '--from', '0', '--to', '4', '--fps', '8', '--out', '../before-graph');
  run(root, 'project', 'pack', 'take/take.json', '--root', '.', '--out', archive);

  const relocated = path.join(dir, 'relocated');
  fs.mkdirSync(relocated);
  const bundle = path.join(relocated, 'whole-take.json');
  fs.renameSync(archive, bundle);
  fs.renameSync(root, path.join(dir, 'former-source'));
  const project = ink.readProjectBundle(bundle);
  assert.equal(project.metadata.kind, 'take');
  assert.equal(project.snapshot().version, 2);
  assert.equal(project.takeDocument().shots.cover, '../shots/cover.json');
  assert(project.files().includes('graphs/groups/frame.json'));
  assert(project.files().includes('media/synth.json'));
  const rootBlock = 'save/blocks/' + reference.root.slice(0, 2) + '/' + reference.root.slice(2);
  assert(project.files().includes(rootBlock));
  assert(project.files().some(file => file.startsWith('save/graph-blocks/')));
  assert(!project.files().includes('save/blocks/unreachable.txt'));
  assert.equal(run(relocated, 'take', 'sample', bundle, '--frame', '3'), report);
  const graphAfter = JSON.parse(run(relocated, 'graph', 'clip', bundle, '--output', 'picture',
    '--from', '0', '--to', '4', '--out', 'after-graph'));
  assert.equal(graphAfter.frames.length, 4);
  assert.deepEqual(graphAfter.cuts, clock.cuts);
  assert.deepEqual(fs.readFileSync(path.join(relocated, 'after-graph/' + graphAfter.frames[0].file)),
    fs.readFileSync(path.join(dir, 'before-graph/' + graphAfter.frames[0].file)));
  run(relocated, 'shot', 'replay', bundle, '--shot', 'cover', '--out', 'cover.png');
  assert.deepEqual(fs.readFileSync(path.join(relocated, 'cover.png')), fs.readFileSync(path.join(dir, 'cover.png')));

  run(relocated, 'project', 'unpack', bundle, '--out', 'unpacked');
  fs.renameSync(path.join(relocated, 'unpacked'), path.join(dir, 'moved-project'));
  const moved = path.join(dir, 'moved-project');
  assert.equal(run(moved, 'take', 'sample', 'take/take.json', '--frame', '3'), report);
  const before = path.join(dir, 'before');
  const publication = directory => {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'export.json')));
    const files = [manifest.loop.file, manifest.audio.mix, ...Object.values(manifest.audio.stems).map(stem => stem.file)];
    assert(ink.readWav(path.join(directory, manifest.audio.mix)).samples.some(sample => sample !== 0));
    return files.map(file => fs.readFileSync(path.join(directory, file)));
  };
  const original = publication(before);
  for (const [cwd, input, output] of [[relocated, bundle, 'after-archive'], [moved, 'take/take.json', 'after-move']]) {
    run(cwd, 'export-scene', input, ...exportArgs, '--out', output);
    assert.deepEqual(publication(path.join(cwd, output)), original);
  }
  assert.throws(() => ink.unpackProject(bundle, { out: moved }), /EEXIST/);
  const missing = project.snapshot();
  delete missing.files['graphs/groups/frame.json'];
  fs.writeFileSync(bundle, JSON.stringify(missing));
  assert.throws(() => ink.unpackProject(bundle, { out: path.join(relocated, 'incomplete') }), /Missing project file/);
  assert(!fs.existsSync(path.join(relocated, 'incomplete')));
  const damaged = project.snapshot();
  damaged.files[rootBlock] = { encoding: 'utf8', data: '{}' };
  fs.writeFileSync(bundle, JSON.stringify(damaged));
  assert.throws(() => ink.unpackProject(bundle, { out: path.join(relocated, 'corrupt') }), /Corrupt checkpoint block/);
  assert(!fs.existsSync(path.join(relocated, 'corrupt')));
});
