const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KIT: K } = require('..').load();
const PNG = require('../cli/png.js');
const { videoFrames } = require('../cli/patch-media.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const fps = { numerator: 30000, denominator: 1001 };
const width = 80, height = 64;
const dimensions = { width, height };
const plan = { format: 'ink-studio/story-presentation-plan', version: 1, id: 'review',
  window: { fps, fromFrame: 1, toFrame: 4 }, performance: 'cast.json',
  views: { map: { mode: 'debug', ...dimensions }, stage: { mode: 'puppet', ...dimensions, graph: 'stage.json' } }
};

function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-story-presentation-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8', stdio: 'pipe' });
  const run = K.world.runtime.create({
    id: 'review', dt: .025, history: { enabled: false },
    takeClock: { fps, simulationRate: 40, sampleRate: 8000, cuts: [{ frame: 2, id: 'closer' }] },
    entities: { guide: { position: [0, 0, 0] } },
    commands: [
      { tick: 2, action: 'world/patch', args: { edits: [{ op: 'set', path: '/entities/guide/position', value: [2, 0, 0] }] } },
      { tick: 2, action: 'world/event', args: { kind: 'arrival', actor: 'guide' } }
    ]
  });
  run.advance(8);
  save('run.json', run.recording());
  save('cast.json', { format: K.world.actorPerformance.planFormat, version: 1, id: 'cast',
    cast: { guide: { actor: { entity: 'guide' } } },
    rules: { line: { on: { kind: 'arrival' }, cue: { kind: 'dialogue', target: 'guide',
      detail: { text: 'HERE', duration: .5 } } } }
  });
  save('stage.json', { format: 'ink-studio/graph-project', version: 1, inputs: { performance: { type: 'record' } },
    nodes: {
      blank: { op: 'raster.canvas', inputs: { width, height, color: [0, 0, 0, 0] } },
      cues: { op: 'scene.actorPerformance', inputs: { sheet: { input: 'performance' }, actor: 'guide' } },
      line: { op: 'draw.text', inputs: { text: { node: 'cues', port: 'caption' }, options: { color: '#ebb574' } } },
      stage: { op: 'raster.blend', inputs: { background: { node: 'blank' }, foreground: { node: 'line' } } }
    }, outputs: { picture: { node: 'stage' } }
  });
  return { call, file, read, save };
}

test('cropped views use the same historical positions, source beats, and fractional clock', t => {
  const { call, file, read, save } = setup(t);
  save('plan.json', plan);
  call('story', 'present', 'run.json', 'plan.json', '--out', 'pack');
  const { clock, frames, views } = read('pack/presentation.json');
  assert.deepEqual(clock.frameRate, fps);
  assert.deepEqual([clock.firstSample, clock.endSample], [266, 1067]);
  assert.deepEqual(frames.map(row => [row.frame, row.offset, row.tick, row.firstSample]),
    [[1, 0, 1, 266], [2, 1, 2, 533], [3, 2, 4, 800]]);
  assert.deepEqual(views.map.frames.map(row => row.details.locations[0].point),
    [[0, 0, 0], [2, 0, 0], [2, 0, 0]]);
  assert.equal(views.stage.frames[0].details.cues.length, 0);
  assert.equal(views.stage.frames[1].details.cues[0].kind, 'dialogue');
  assert.notEqual(views.stage.frames[0].sha256, views.stage.frames[1].sha256);
  const beat = frames[1].beats.find(row => row.kind === 'arrival');
  assert.ok(beat);
  const locate = JSON.parse(call('beat', beat.beatId, 'pack/presentation.json', 'pack/timeline.json'));
  assert.deepEqual(locate.unmatched, []);
  const images = locate.matches.map(row => row.artifact).filter(Boolean);
  assert.deepEqual([...new Set(images)].sort(), ['pack/views/map/frame-000001.png', 'pack/views/stage/frame-000001.png',
    'pack/views/stage/frame-000002.png']);
  assert(images.every(name => fs.existsSync(file(name))));
});

test('projector only accepts art and gives the show decoder opaque frames at the authored rate', async t => {
  const { call, file, read, save } = setup(t);
  save('blocked.json', { ...plan, views: { ...plan.views, screen: { mode: 'projector', source: 'map' } } });
  assert.throws(() => call('story', 'present', 'run.json', 'blocked.json', '--out', 'blocked'),
    /projector view screen needs an art view/);
  assert.equal(fs.existsSync(file('blocked')), false);
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) return t.skip('FFmpeg is unavailable');
  save('screen.json', { ...plan, views: { stage: plan.views.stage, screen: { mode: 'projector', source: 'stage' } } });
  call('story', 'present', 'run.json', 'screen.json', '--out', 'pack');
  const { views } = read('pack/presentation.json');
  const show = read('pack/' + views.screen.feed.show);
  assert.deepEqual([show.fps, show.frames, show.size], ['30000/1001', 3, '80x64']);
  const expected = views.screen.frames.map(row => Buffer.from(PNG.raster(file('pack/' + row.file)).data));
  assert.deepEqual(expected[0].subarray(0, 4), Buffer.from([0, 0, 0, 255]));
  const decoded = [];
  for await (const frame of videoFrames(file('pack/' + views.screen.feed.file), { width, height, rate: show.fps }))
    decoded.push(Buffer.from(frame.data));
  assert.deepEqual(decoded, expected);
});
