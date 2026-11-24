const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const codes = report => report.issues.map(issue => issue.code);
const view = { w: 48, h: 32, px: 1, time: .5 };
const fog = K.atmosphere.box({ id: 'dock-fog', min: [-2, -1, -2], max: [2, 1, 2], density: .4, lit: true });
const shaped = { id: 'mist', source: { type: 'path', points: [[-3, 0, 0], [3, 0, 0]], radius: 1 }, lit: false };

test('the same frame review reaches the headless render output without changing its pixels', async () => {
  const world = makeBuilder(7, Array.from({ length: 65 }, (_, i) => i * 0x010101))
    .finish({ atmosphere: [fog], shapedAtmosphere: [shaped] });
  const plain = ink.render(world, view);
  const frame = ink.render(world, { ...view, captureCompatibility: true });
  assert.deepEqual(frame.rgb, plain.rgb);
  assert.equal(plain.compatibility, undefined);
  assert.deepEqual(frame.compatibility, ink.describeRenderFrame(world, view).compatibility);
  assert.deepEqual(codes(frame.compatibility), ['palette-limit', 'density-field', 'lit-fog']);
  assert.deepEqual(frame.compatibility.issues[0].detail, { count: 65, limit: 64 });
  assert.deepEqual(frame.compatibility.issues[1].detail, { count: 1, volumes: ['mist'] });
  assert.deepEqual(codes(ink.describeRenderFrame(world, { ...view, raw: true, atmosphere: false }).compatibility), []);
  assert.deepEqual(codes(ink.describeRenderFrame(world, { ...view, shapedAtmosphere: false }).compatibility),
    ['palette-limit', 'lit-fog']);
  assert.equal(frame.compatibility.issues[0].detail.limit, (await import('../src/webgl/shaders.mjs')).scenePaletteSize);
});

test('fog review matches the enabled WebGL limit, weather overrides and fog cutouts', async () => {
  const world = makeBuilder(8, [0x192936, 0xb4daec]).finish();
  const review = (source, frame = {}) => K.renderContract.review({ ...world, ...source }, { ...view, ...frame });
  const analytic = Array.from({ length: 17 }, (_, i) => ({ ...fog, id: 'fog-' + i, lit: false }));
  assert.deepEqual(codes(review({ atmosphere: [...analytic.slice(0, 16), { ...fog, density: 0 }] })), []);
  const [limit] = review({ atmosphere: analytic }).issues;
  assert.equal(limit.code, 'analytic-fog-limit');
  assert.deepEqual(limit.detail, { count: 17, limit: (await import('../src/webgl/environment-shaders.mjs')).fogLimit });
  const skyEnvironment = { sky: false, defaults: { fogDensity: 0 }, profiles: { squall: { fogDensity: 2 } } };
  const weatherBinding = { fogVolumes: ['fog-1'],
    fronts: [{ id: 'front', profile: 'squall', radius: 2, route: [{ at: 0, xz: [0, 0] }] }] };
  const wet = { atmosphere: analytic, skyEnvironment, weatherBinding };
  const regional = review(wet, { weatherBinding: { rainFull: 2 } });
  assert.deepEqual(codes(regional), ['regional-fog']);
  assert.deepEqual(regional.issues[0].detail.volumes, ['fog-1']);
  assert.deepEqual(codes(review({ ...wet, weatherBinding: { ...weatherBinding, fogVolumes: undefined } },
    { weatherFronts: false })), []);
  assert.deepEqual(codes(review(wet, { environment: false })), []);
  const cloudZone = { type: 'sphere', at: [0, 0, 0], radius: 1, affects: 'cloud' };
  const withCutout = volumeCutouts => ({ atmosphere: analytic.slice(0, 1), volumeCutouts });
  assert.deepEqual(codes(review(withCutout({ zones: [cloudZone] }))), []);
  assert.deepEqual(codes(review(withCutout({ zones: [{ ...cloudZone, affects: 'fog' }] }))), ['volume-cutouts']);
});

test('CLI preview and export record only frames that actually carry a compatibility issue', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-compatibility-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = name => path.join(dir, name);
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(file('fixture.js'), `module.exports = ({ makeBuilder }) => ({
    id: 'compatibility-fixture', build() {
      const world = makeBuilder(3, [0x102233, 0x559078]).finish();
      const compact = world.pal, wide = [...compact, ...Array(63).fill(0x762514)];
      world.anim = { update(dt, time) { world.pal = time >= .25 && time < .75 ? wide : compact; } };
      return world;
    }
  });`);
  const source = file('fixture.js'), args = ['--w', '48', '--h', '32', '--px', '1'];
  run('render', source, ...args, '--t', '.5', '--compatibility-report', '--out', file('sample.png'));
  const sample = read('sample.compatibility.json');
  assert.equal(sample.time, .5);
  assert.deepEqual(codes(sample), ['palette-limit']);
  run('render', source, ...args, '--t', '.75', '--compatibility-report', '--out', file('safe.png'));
  assert.equal(read('safe.compatibility.json').status, 'no-known-differences');
  run('clip', source, ...args, '--from', '0', '--to', '1', '--fps', '4',
    '--compatibility-report', '--out', file('clip.png'));
  run('export-scene', source, ...args, '--from', '0', '--to', '1', '--t', '.75', '--fps', '4',
    '--formats', 'still,loop', '--out', file('export'));
  const clip = read('clip.compatibility.json'), manifest = read('export/export.json');
  const sequence = { count: 2, first: { frame: 1, time: .25 }, last: { frame: 2, time: .5 } };
  assert.deepEqual(clip.issues[0].sequence, sequence);
  assert.deepEqual(manifest.compatibility.samples, { sequence: 4, still: 1 });
  assert.deepEqual(manifest.compatibility.issues, clip.issues);
  assert.throws(() => run('export-scene', source, ...args, '--to', '1', '--fps', '4',
    '--strict-contract', '--formats', 'loop', '--out', file('strict')), /palette-limit/);
  assert.equal(fs.existsSync(file('strict/export.json')), false);
  assert.deepEqual(fs.readdirSync(file('strict')), []);
});
