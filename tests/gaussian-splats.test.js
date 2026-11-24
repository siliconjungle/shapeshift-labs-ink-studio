const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const ink = require('..');

const fields = ['rot_3', 'z', 'x', 'scale_2', 'f_dc_1', 'rot_1', 'opacity', 'scale_0', 'y',
  'f_dc_2', 'rot_0', 'rot_2', 'scale_1', 'f_dc_0'];
const values = [Math.SQRT1_2, 3, -2, Math.log(.05), -.5, 0, 0, Math.log(.2), 1, 0, Math.SQRT1_2, 0, Math.log(.1), 1];
const approx = (a, b, tolerance = 1e-5) => assert(Math.abs(a-b) <= tolerance, `${a} differs from ${b}`);

function ply(format = 'ascii', coefficients = [], count = 1) {
  const eol = format === 'binary_big_endian' ? '\r\n' : '\n';
  const header = Buffer.from(['ply', 'format ' + format + ' 1.0', 'comment importer fixture', 'element vertex ' + count,
    ...fields.map(name => 'property float ' + name),
    ...coefficients.map((_, i) => 'property float f_rest_' + i),
    'element face 0', 'property list uchar int vertex_indices', 'end_header', ''].join(eol));
  const vertex = [...values, ...coefficients];
  if (format === 'ascii') return Buffer.concat([header, Buffer.from(vertex.join(' '))]);
  const payload = Buffer.alloc(vertex.length * 4);
  for (const [i, value] of vertex.entries()) payload[format === 'binary_little_endian' ? 'writeFloatLE' : 'writeFloatBE'](value, i * 4);
  return Buffer.concat([header, payload]);
}

function spz(version) {
  const header = Buffer.alloc(version === 4 ? 32 : 16);
  header.write('NGSP');
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(1, 8);
  header[12] = 1;
  header[13] = 12;
  header[14] = 1;
  const positions = version === 1 ? Buffer.from([0, 0xc0, 0, 0x3c, 0, 0x42]) : Buffer.alloc(9);
  if (version > 1) [-2, 1, 3].forEach((value, i) => positions.writeIntLE(value * 4096, i * 3, 3));
  const rotation = version < 3 ? Buffer.from([128, 128, 128]) : Buffer.from([0xff, 1, 0, 0xc0]);
  const streams = [positions, Buffer.from([128]), Buffer.from([128, 180, 90]), Buffer.from([128, 144, 160]),
    rotation, Buffer.from([128, 144, 112, 128, 128, 128, 160, 128, 128])];
  if (version < 4) return zlib.gzipSync(Buffer.concat([header, ...streams]));
  header[15] = streams.length;
  header.writeUInt32LE(header.length, 16);
  const table = Buffer.alloc(16 * streams.length);
  const compressed = streams.map((stream, i) => {
    let frame;
    if (zlib.zstdCompressSync) frame = zlib.zstdCompressSync(stream);
    else {
      /* A single-segment Zstandard frame containing one raw last block. */
      frame = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, stream.length, stream.length * 8 + 1, 0, 0]), stream]);
    }
    table.writeBigUInt64LE(BigInt(frame.length), 16 * i);
    table.writeBigUInt64LE(BigInt(stream.length), 16 * i + 8);
    return frame;
  });
  return Buffer.concat([header, table, ...compressed]);
}

test('Gaussian PLY is property-ordered, accepts ASCII and both byte orders, and keeps SH', async () => {
  const { decodeGaussianPly, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  for (const encoding of ['ascii', 'binary_little_endian', 'binary_big_endian']) {
    const cloud = decodeGaussianPly(ply(encoding, [1,2,3,4,5,6,7,8,9]));
    assert.deepEqual([...cloud.positions], [-2, 1, 3]);
    assert.deepEqual([...cloud.sh], [1,4,7,2,5,8,3,6,9]);
    approx(cloud.rotations[2], Math.SQRT1_2);
    approx(cloud.scales[0], .2);
    approx(cloud.opacity[0], .5);
    const world = gaussianSplatWorld(cloud, { size: 1.2 });
    approx(world.data[4], .01);
    approx(world.data[8], .04);
    approx(world.data[10], .0025);
    assert.notEqual(gaussianSplatWorld(cloud, { viewDirection: [0,0,1] }).data[7], world.data[7]);
    approx(gaussianSplatWorld(cloud, { size: 1.2, up: 'z' }).data[8], .0025);
  }
  assert.throws(() => decodeGaussianPly(ply('binary_little_endian').subarray(0, -3)), /Truncated/);
  assert.throws(() => decodeGaussianPly(ply('ascii', [], 2), { maxPoints: 1 }), /point count/);
  assert.throws(() => decodeGaussianPly('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0'), /Gaussian fields/);
});

test('SPZ versions 1 through 4 decode positions, covariance inputs, alpha and SH', async () => {
  const { decodeGaussianSplat, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  for (const version of [1, 2, 3, 4]) {
    const cloud = await decodeGaussianSplat(spz(version));
    assert.equal(cloud.version, version);
    assert.deepEqual([...cloud.positions], [-2, 1, 3]);
    assert.deepEqual([...cloud.sh], [0,.125,-.125,0,0,0,.25,0,0]);
    assert.equal(cloud.antialiased, true);
    approx(cloud.opacity[0], 128 / 255);
    approx(cloud.scales[0], Math.exp(-2));
    if (version >= 3) {
      approx(cloud.rotations[2], Math.SQRT1_2);
      approx(cloud.rotations[3], Math.SQRT1_2);
    }
    assert.equal(gaussianSplatWorld(cloud).data.length, 16);
  }
  const badTable = spz(4);
  badTable.writeBigUInt64LE(22n, 40);
  await assert.rejects(decodeGaussianSplat(badTable), /stream size/);
  await assert.rejects(decodeGaussianSplat(spz(4).subarray(0, -2)), /stream size/);
  await assert.rejects(decodeGaussianSplat(new Uint8Array([1,2,3,4])), /Expected PLY/);
});

test('the public Node and CLI entry points render imported Gaussian data', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-gaussian-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.spz'), out = path.join(dir, 'sample.png');
  fs.writeFileSync(file, spz(4));
  const cloud = await ink.readGaussianSplat(file);
  const world = await ink.gaussianSplatWorld(cloud);
  const frame = ink.render(world, { w: 36, h: 32, px: 1, raw: true });
  assert(frame.rgb.some((value, i) => value !== world.bg[i % 3]));
  execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), 'render', file,
    '--raw', '--w', '36', '--h', '32', '--out', out], { cwd: dir });
  assert.equal(fs.readFileSync(out).subarray(1, 4).toString(), 'PNG');

  const editable = await ink.gaussianSplatWorld(cloud, { colorMode: 'rgb', objectId: 'gaussian-cloud' });
  const { idAt } = ink.load().KIT.procedural.splatProvenance.identities(editable);
  const fit = path.join(dir, 'fit.json'), atlas = path.join(dir, 'atlas');
  fs.writeFileSync(fit, JSON.stringify({ format: 'ink-studio/splat-fit', version: 2,
    target: { object: 'gaussian-cloud' }, edits: [], attributes: [[idAt(0), { pigment: 0xd05136 }]] }));
  execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), 'atlas', file,
    '--w', '24', '--h', '24', '--directions', '2', '--splat-fit', fit, '--out', atlas], { cwd: dir });
  assert.match(JSON.parse(fs.readFileSync(path.join(atlas, 'atlas.json'))).splatFitRevision, /^[a-f0-9]{64}$/);
});

test('live worlds share decoded rows and preserve the fixed-view fallback', async () => {
  const { decodeGaussianSplat, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  for (const bytes of [ply('binary_little_endian', Array(9).fill(.1)), spz(4)]) {
    const cloud = await decodeGaussianSplat(bytes);
    const palette = [0x152537, 0xbdad99];
    const viewDirection = [1, 0, 1];
    const baked = gaussianSplatWorld(cloud, { viewDirection });
    assert.equal(baked.gaussianHarmonics, undefined);
    for (const colorMode of ['rgb', 'palette']) {
      const world = gaussianSplatWorld(cloud, { viewDirection, colorMode, palette });
      assert.deepEqual(world.data, baked.data);
      assert.equal(world.gaussianHarmonics.dc, cloud.dc);
      assert.equal(world.gaussianHarmonics.sh, cloud.sh);
      assert.equal(world.gaussianHarmonics.degree, 1);
      assert.equal(world.gaussianHarmonics.colorMode, colorMode);
      assert.deepEqual(world.bg, [0x15, 0x25, 0x37]);
      assert.deepEqual(world.pal, palette);
    }
    assert.throws(() => gaussianSplatWorld(cloud, { colorMode: 'invalid' }), /Gaussian color mode/);
    assert.throws(() => gaussianSplatWorld(cloud, { palette: [] }), /Gaussian palette/);
  }
});

test('WebGL live Gaussian color matches baked harmonics through degree four', { skip: !process.env.INK_TEST_CHROME }, async () => {
  const { decodeGaussianSplat, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  const cases = [];
  const camera = { yaw: .72, pitch: -.31, dist: 4, target: [0, 0, 0] };
  const ray = [-Math.cos(camera.pitch) * Math.sin(camera.yaw), -Math.sin(camera.pitch), -Math.cos(camera.pitch) * Math.cos(camera.yaw)];
  const palette = [0x031528, 0x713f86, 0xc18671, 0x76b9ad, 0xa6dcf9];
  for (let l = 0; l <= 4; l++) {
    const count = 3 * ((l + 1) ** 2 - 1);
    const coeffs = Array.from({ length: count }, (_, i) => Math.sin(i * 2.13 + .2) * .16);
    const cloud = await decodeGaussianSplat(ply('binary_little_endian', coeffs));
    cloud.opacity[0] = 1;
    const up = l % 2 === 0 ? 'z' : 'y';
    const world = gaussianSplatWorld(cloud, { colorMode: 'rgb', size: 1.8, palette, up });
    const baked = gaussianSplatWorld(cloud, { size: 1.8, palette, up,
      viewDirection: up === 'z' ? [ray[0], -ray[2], ray[1]] : ray });
    const { gaussianHarmonics: rows, ...base } = world;
    cases.push({ base: { ...base, data: Array.from(base.data), moving: [], back: [] },
      rows: { ...rows, dc: Array.from(rows.dc), sh: Array.from(rows.sh) }, fixed: Array.from(baked.data) });
  }

  const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend, input) => {
    const renderer = backend(80, 80, { offscreen: true, colored: false, dither: 0, damp: false });
    const center = () => renderer.sample({ p: [40, 40] }).p;
    const results = [];
    for (const { base, rows, fixed } of input.cases) {
      const fallback = { ...base, data: Float32Array.from(fixed), moving: new Int32Array(), back: new Int32Array() };
      const world = { ...fallback, data: Float32Array.from(base.data), gaussianHarmonics: {
        ...rows, dc: Float32Array.from(rows.dc), sh: Float32Array.from(rows.sh)
      } };
      const { camera } = input;
      renderer.draw(fallback, { camera, raw: true });
      const baked = center();
      renderer.draw(world, { camera });
      const rgb = center();
      renderer.draw(world, { camera: { ...camera, ortho: true } });
      const ortho = center();
      renderer.draw(world, { camera: { ...camera, yaw: camera.yaw - Math.PI } });
      const opposite = center();
      renderer.draw(world, { camera, gaussianColor: 'palette', raw: true });
      const palette = center();
      renderer.draw(fallback, { camera, raw: true });
      results.push({ baked, rgb, ortho, opposite, palette, restored: center() });
    }
    renderer.close();
    return { results };
  }, { cases, camera });
  const samples = palette.map(color => [color >> 16, color >> 8 & 255, color & 255]);
  for (const [degree, { baked, rgb, ortho, opposite, palette: stepped, restored }] of result.results.entries()) {
    for (let channel = 0; channel < 3; channel++) {
      approx(rgb[channel], baked[channel], 2);
      approx(ortho[channel], baked[channel], 2);
    }
    assert.deepEqual(restored, baked);
    assert(samples.some(swatch => swatch.every((value, i) => value === stepped[i])));
    if (degree > 0) assert.notDeepEqual(opposite, rgb);
  }
});

test('Gaussian color inspection follows one patch and reads the rendered palette pixel', async () => {
  const { createGaussianColorInspector, gaussianSwatchJump, decodeGaussianPly, gaussianSplatWorld } = await import('../webgl.mjs');
  const packed = [0x081523, 0x276383, 0xda8f7d, 0x286484];
  const cloud = decodeGaussianPly(ply('binary_little_endian', [0, 0, .8, 0, 0, 0, 0, 0, -.1]));
  const world = gaussianSplatWorld(cloud, { colorMode: 'rgb', up: 'z', palette: packed });
  const picker = ink.load().KIT.procedural.contributions.create(world);
  let hidden = false;
  const renderer = { pick(w, ray) {
    assert.equal(w, world);
    return hidden ? { dominant: null, contributions: [] } : picker.ray(ray);
  } };
  const tool = createGaussianColorInspector(renderer, world, { width: 320, height: 240 });
  const camera = { target: [0, 0, 0], dist: 10, yaw: .4, pitch: -.2 };
  const frame = { camera };
  assert.equal(tool.inspect(frame, assert.fail), null);
  assert.equal(tool.select(0, 0, frame), null);
  const selection = tool.select(.5, .5, frame);
  assert.equal(selection.index, 0);
  const read = rgb => (x, y) => {
    assert.equal(Math.abs(x - 160) <= 1, true);
    assert.equal(Math.abs(y - 120) <= 1, true);
    return rgb;
  };
  const first = tool.inspect(frame, read([0x27, 0x63, 0x83]));
  assert.equal(first.selection, selection);
  assert.equal(first.state, 'visible');
  assert.deepEqual(first.swatch, { index: 1, rgb: [0x27, 0x63, 0x83] });
  const baked = gaussianSplatWorld(cloud);
  assert.deepEqual(first.base, [baked.data[7] & 255, baked.data[7] >> 8 & 255, baked.data[7] >> 16]);
  const fixed = gaussianSplatWorld(cloud, { viewDirection: [
    -Math.cos(camera.pitch) * Math.sin(camera.yaw),
    Math.cos(camera.pitch) * Math.cos(camera.yaw), -Math.sin(camera.pitch)
  ] });
  assert.deepEqual(first.rgb, [fixed.data[7] & 255, fixed.data[7] >> 8 & 255, fixed.data[7] >> 16]);
  const step = { camera: { ...camera, yaw: camera.yaw + Math.PI / 180 } };
  const second = tool.inspect(step, read([0xda, 0x8f, 0x7d]));
  assert.equal(second.selection, selection);
  const jump = gaussianSwatchJump(first, second);
  assert.equal(jump.from.index, 1);
  assert.equal(jump.to.index, 2);
  assert(jump.degrees > .9 && jump.degrees < 1.1);
  assert.equal(gaussianSwatchJump(first, tool.inspect(step, read([0x28, 0x64, 0x84]))), null);
  assert.equal(gaussianSwatchJump(first, tool.inspect(step, read([1, 2, 3]))), null);
  assert.equal(gaussianSwatchJump(first, tool.inspect({
    camera: { ...camera, yaw: camera.yaw + .1 }
  }, read([0xda, 0x8f, 0x7d]))), null);
  hidden = true;
  assert.equal(tool.inspect(step, assert.fail).state, 'obscured');
  assert.equal(tool.inspect({ camera: { ...camera, target: [50, 0, 0] } }, assert.fail).state, 'offscreen');
  tool.clear();
  assert.equal(tool.inspect(frame, assert.fail), null);
});

test('a splat mask stroke retains nearby contributors and supports erase, undo and clear', async () => {
  const { createSplatMaskPainter } = await import('../webgl.mjs');
  const data = new Float32Array(3 * 16);
  for (const o of [0, 16, 32]) for (const field of [4, 8, 10]) data[o + field] = .0025;
  const world = { data, count: 3, gaussianHarmonics: { count: 3 }, cam: { dist: 4 } };
  const dominant = { index: 0, distance: 4, weight: .5 };
  const contributions = [dominant, { index: 1, distance: 4.08, weight: .12 }, { index: 2, distance: 5, weight: .15 }];
  let queries = 0;
  const painter = createSplatMaskPainter({ pick(w, ray) {
    assert.equal(w, world);
    assert(ray.soft);
    queries++;
    return { dominant, contributions };
  } }, world, { width: 100, height: 75 });
  const empty = painter.mask;
  assert.equal(painter.stroke([[-1, -.2]], {}, { radius: 3 }), empty);
  const painted = painter.stroke([[.3, .5], [.7, .5]], {}, { radius: 3 });
  assert(queries > 12);
  assert.deepEqual(painted.indices, [0, 1]);
  assert.deepEqual(empty.indices, []);
  assert.equal(painter.stroke([[.5, .5]], {}, { radius: 2 }), painted);
  assert.deepEqual(painter.stroke([[.5, .5]], {}, { radius: 2, erase: true }).indices, []);
  assert.deepEqual(painter.undo().indices, [0, 1]);
  assert.deepEqual(painter.clear().indices, []);
  assert.deepEqual(painter.undo().indices, [0, 1]);
  assert.deepEqual(painter.undo().indices, []);
  assert.equal(painter.canUndo, false);
});

test('WebGL applies a translucent splat mask to its ramp and protects its pixel from cleanup', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend) => {
    const data = new Float32Array(32);
    for (const o of [0, 16]) for (const field of [4, 8, 10]) data[o + field] = .00002;
    data[3] = .92;
    data[7] = 0x707070;
    data[18] = 1;
    data[23] = 0x707070;
    const world = { data, count: 2, radius: 2, pal: [0x101010, 0x505050, 0x707070], dither: 0,
      moving: new Int32Array(), back: new Int32Array(), cam: { dist: 4, target: [0,0,0], yaw: 0, pitch: 0 },
      gaussianHarmonics: { count: 2, degree: 0, dc: Float32Array.of(-.55,-.55,-.55,-.55,-.55,-.55),
        sh: new Float32Array(), up: 'y', colorMode: 'palette' } };
    const mask = { count: 2, indices: [0] };
    const draw = backend(65, 65, { offscreen: true, colored: false, dither: 0, damp: false });
    function center(frame) {
      draw.draw(world, frame);
      return draw.sample({ middle: [32,32] }).middle;
    }
    const plain = center({ clean: false });
    const clean = center({ clean: true });
    const protectedPixel = center({ clean: true, splatPaint: { mask, protect: true } });
    const ramp = center({ clean: false, splatPaint: { mask, ramp: [0x9ddcc7] } });
    const raw = center({ gaussianColor: 'rgb' });
    const rawPaint = center({ gaussianColor: 'rgb', splatPaint: { mask, ramp: [0x9ddcc7], preview: true } });
    world.data = data.slice();
    world.data[19] = 1;
    const covered = center({ clean: false, splatPaint: { mask, ramp: [0x9ddcc7] } });
    draw.close();
    return { plain, clean, protectedPixel, ramp, raw, rawPaint, covered };
  }, {});
  assert.deepEqual(result.plain, [80,80,80]);
  assert.deepEqual(result.clean, [16,16,16]);
  assert.deepEqual(result.protectedPixel, result.plain);
  assert.deepEqual(result.ramp, [157,220,199]);
  assert.deepEqual(result.rawPaint, result.raw);
  assert.notDeepEqual(result.covered, result.ramp);
});

test('the pixel CLI edits a PLY splat while the headless view retains its directional response',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-scan-splat-paint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args],{stdio:'pipe'});
  const write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  fs.writeFileSync(file('scan.ply'),ply('binary_little_endian',[0,-.4,0,0,.12,0,0,0,0]));
  write('document.json',{format:'ink-studio/pixel-art',version:2,width:20,height:20,pixelAspect:[1,1],
    palette:{mint:'#55aa88'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'scan',scene:file('scan.ply'),object:'gaussian-cloud'}],
    destinations:[{id:'paint',kind:'splat-attributes',binding:'scan'}]});
  const binding=['--scene',file('scan.ply')], targets=['pixel-art','targets',file('document.json'),...binding,'--destination','paint'];
  const report=JSON.parse(cli(...targets));
  assert.equal(report.splats[0].directionalAppearance,true);
  write('edit.json',{id:'paint',destination:'paint',frame:'front',revision:report.documentRevision,sourceRevision:report.sourceRevision,
    operation:{splats:[{splat:report.splats[0].id,pigment:'mint'}]}});
  assert.equal(JSON.parse(cli('pixel-art','edit',file('document.json'),file('edit.json'),...binding,'--out',file('fit.json'))).status,'applied');
  assert.equal(JSON.parse(cli(...targets,'--splat-fit',file('fit.json'))).splats[0].pigment,'#55aa88');
  for (const weight of ['0','1']) cli('render',file('scan.ply'),'--w','52','--h','52','--px','1','--yaw','0','--pitch','0',
    '--raw','--splat-fit',file('fit.json'),'--scan-appearance',weight,'--out',file(weight+'.png'));
  assert(!fs.readFileSync(file('0.png')).equals(fs.readFileSync(file('1.png'))));
});
