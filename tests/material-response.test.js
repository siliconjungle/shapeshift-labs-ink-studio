const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ KIT: K, makeBuilder, makeSculpt }) {
  const B = makeBuilder(13, [0x17232c, 0x806956, 0x386c64, 0x444974]), S = makeSculpt(B);
  S.box([-1,-.1,0], [1,.1,1], { r: [1], materialId: 'silt' }, { res: .045 });
  S.box([1,-.1,0], [1,.1,1], { r: [2], materialId: 'water' }, { res: .045 });
  S.box([-.57,.20,0], [.12,.20,.145], { r: [3], materialId: 'blocker' }, { res: .038 });
  S.bake();
  const world = B.finish({ cam: { target: [0,.07,0], dist: 5.6, yaw: 0, pitch: 1.04,
    projection: 'orthographic', sway: 0 }, dither: 0 });
  const recipe = { format: 'ink-studio/material-response', version: 1, materials: {
    silt: { chart: { bounds: [-2,-1,2,1], reach: .16 }, resolution: [59,31],
      mark: { color: '#fd005d', radius: .55 }, sound: 'silt' },
    water: { chart: { bounds: [-2,-1,2,1], reach: .16 }, resolution: [60,31],
      ripple: { color: '#55ffba', radius: .24, speed: .6, width: .09, duration: .7 },
      particles: { color: '#fff2ac', count: 12, radius: .033 }, sound: 'water' }
  } };
  const point = (id, interaction, material, time, x, z = 0) =>
    ({ id, interaction, material, time, point: [x,0,z], speed: 2 });
  const contacts = [point('foot-1', 'step', 'silt', .4, -.42), point('wheel-1', 'roll', 'water', .65, .5),
    point('wheel-2', 'roll', 'water', .70, .6), point('strike', 'impact', 'water', 1.15, 1.25)];
  const track = K.materialResponse.create(recipe, { contacts });
  track.bind(world);
  return { world, track, contacts, recipe };
}

function inspect(bytes, w) {
  let marked = 0, leaked = 0, ripple = 0, blocker = 0, particles = 0;
  for (let p = 0; p < bytes.length; p += 3) {
    const [r, g, b] = bytes.subarray(p,p+3);
    if (r === 253 && g === 0 && b === 93) {
      marked++;
      if (p / 3 % w >= w / 2) leaked++;
    }
    if (r === 85 && g === 255 && b === 186) ripple++;
    if (r === 68 && g === 73 && b === 116) blocker++;
    if (r >= 230 && g >= 214 && b >= 140 && b <= 180) particles++;
  }
  return { marked, leaked, ripple, blocker, particles };
}

test('a portable log drives shared visual and audio clocks and accepts duplicate live reads', () => {
  const { world, track, recipe, contacts } = fixture(ink.load());
  const render = t => ink.render(world, { w: 128, h: 90, px: 1, raw: true, t }).rgb;
  const before = render(.2), after = render(.67);
  assert.equal(inspect(before, 128).marked, 0);
  assert(inspect(after, 128).marked > 40);
  assert(inspect(after, 128).ripple > 8);
  assert(inspect(after, 128).particles > 0);
  assert.equal(inspect(after, 128).leaked, 0);
  assert(inspect(after, 128).blocker > 0);
  assert.deepEqual(render(.2), before);
  assert.deepEqual(render(.67), after);
  assert.deepEqual(track.sounds().map(row => [row.contact,row.time]), [['foot-1',.4], ['wheel-1',.65], ['strike',1.15]]);
  assert.equal(track.add(contacts), 0);
  const newHit = { ...contacts[0], id: 'live', time: undefined };
  assert.throws(() => track.add([newHit, { ...newHit, id: 'bad', speed: -1 }], { time: 2 }), /timestamp/);
  assert.equal(track.add([newHit], { time: 2 }), 1);
  assert.deepEqual(ink.load().KIT.materialResponse.create(recipe, { contacts: track.snapshot().contacts }).sounds(), track.sounds());
  const clock = ink.load().KIT.timeDomains.take({ sampleRate: 24000 });
  assert.deepEqual(track.audioTimeline().audioSchedule(clock).map(row => row.firstSample), [9600, 15600, 27600, 48000]);
});

test('native footsteps, wheels and an injected impact can feed one live recipe', () => {
  const { KIT: K } = ink.load();
  const source = require('../examples/world-contact-effects.json');
  const material = 'trackside/clay';
  const track = K.materialResponse.create({ format: 'ink-studio/material-response', version: 1,
    materials: { [material]: { sound: 'clay' } } });
  const run = K.world.runtime.create({ ...source, visual: {}, systems: { ...source.systems,
    feedback: { ...source.systems.feedback, config: { ...source.systems.feedback.config, channels: ['steps','impacts'] } },
    walk: { kind: 'agents', config: { bounds: { min: [-2,-1,-3], max: [2,2,3] },
      surface: 'ground/surface', contactEvents: 'material',
      species: { walker: { mode: 'walk', stride: .07, speed: 2, contactLoad: 17 } },
      agents: { foot: { species: 'walker', position: [-1,0,-2], goal: [-1,0,2] } } } }
  }, connections: [...source.connections, { from: 'walk/contacts', to: 'feedback/steps' }],
  commands: [{ tick: 7, action: 'world/input', args: { port: 'feedback/impacts', value: [
    { id: 'injected', interaction: 'impact', material, point: [0,0,0], speed: 2 }] } }] });
  for (let i = 1; i <= 20; i++) {
    run.advance(i);
    const { value } = run.query().probe('feedback/contacts');
    track.add(value, { time: run.view().time });
  }
  assert.deepEqual([...new Set(track.snapshot().contacts.map(row => row.interaction))].sort(), ['impact','roll','step']);
  assert(track.sounds().some(cue => cue.contact === 'injected' && cue.cue === 'clay'));
});

test('WebGL projects chart texels onto the current visible receiver and rewinds', { skip: !process.env.INK_TEST_CHROME }, () => {
  const frames = runWebGL({}, fixture, (kit, make, backend) => {
    const draw = backend(128, 90, { raw: true, offscreen: true });
    const { world } = make(kit);
    try {
      return { images: [[.67,0], [.2,0], [.67,0], [1.19,0], [.67,.3]].map(([time, yaw]) => {
        draw.draw(world, { time, yaw });
        return draw.image();
      }) };
    } finally { draw.close(); }
  });
  const [on, before, seek, impact, orbit] = frames.images.map(image => inspect(Buffer.from(image,'base64'), 128));
  assert(on.marked > 40 && on.ripple > 8 && on.blocker > 0 && on.particles > 0);
  assert.equal(on.leaked, 0);
  assert.equal(before.marked + before.ripple, 0);
  assert.deepEqual(seek, on);
  assert(impact.ripple > 8 && impact.particles > 0);
  assert(orbit.ripple > 8 && orbit.marked > 40);
  assert.notEqual(frames.images[0], frames.images[4]);
  assert.equal(frames.images[0], frames.images[2]);
});

test('audio preview schedules the cue tail after a seek and picks up a live contact', () => {
  const { track, contacts } = fixture(ink.load()), started = [];
  const context = { currentTime: 5, createGain: () => ({ gain: {}, connect() {} }),
    createBufferSource: () => ({ connect() {}, start: (...values) => started.push(values), stop() {} }) };
  const preview = track.createPlayback(context, () => ({ duration: .25 }));
  preview.seek(.5);
  assert.equal(started.length, 1);
  assert(Math.abs(started[0][1] - .1) < 1e-8);
  track.add([{ ...contacts[0], id: 'live', time: .55 }]);
  preview.sync();
  assert.deepEqual(started[1], [5.05, 0]);
  preview.sync();
  assert.equal(started.length, 2);
  preview.stop();
});

test('a reopened project exports contact sound at matching picture times', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ink-material-response-'));
  const root = path.join(__dirname, '..');
  try {
    execFileSync(process.execPath, [path.join(root,'examples/material-response/demo.cjs'), directory, '--pack-only']);
    const file = path.join(directory,'silt-lock.ink.json'), out = path.join(directory,'export');
    rmSync(path.join(directory,'source'), { recursive: true });
    execFileSync(process.execPath, [path.join(root,'cli/ink-studio.js'), 'export-scene', file, '--out', out,
      '--formats', 'loop', '--w', '112', '--h', '66', '--px', '1', '--from', '4', '--to', '4.5', '--fps', '12']);
    const manifest = JSON.parse(readFileSync(path.join(out,'export.json'),'utf8'));
    const wav = ink.readWav(path.join(out,manifest.audio.mix));
    const onset = wav.samples.findIndex(value => Math.abs(value) >= .004) / wav.channels / wav.sampleRate;
    assert(onset >= .06 && onset < .08, 'strike cue must keep its absolute onset inside a cropped export');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
