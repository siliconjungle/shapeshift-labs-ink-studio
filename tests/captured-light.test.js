const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();

function fixture() {
  const palette = [0, 0x304054, 0xa1bcde, 0xfffaf0, 0xfb4010, 0xffa100];
  const ramp = [0, 1, 2, 3], data = new Float32Array(64);
  const capture = { ramp: [1, 1, 1], t: [0.18, 0.55, 0.62], n: [[0, 1, 0], [1, 0, 0], [0, 0, 1]], ramps: [ramp] };
  const packedColor = i => ((palette[i] & 255) << 16) | (palette[i] & 65280) | (palette[i] >>> 16);
  for (let i = 0; i < 4; i++) {
    data[i * 16] = (i - 1) * 0.5;
    data[i * 16 + 3] = 3;
    data[i * 16 + 7] = packedColor(i);
  }
  const stage = K.stage({ count: 4, data, pal: palette });
  stage.rig = {
    bid: Uint16Array.of(1, 1, 0, 0), part: name => name === 'moving' ? 1 : -1,
    M: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)
  };
  return { stage, capture, data, packedColor };
}
const lamp = (extra = {}) => ({ p: [0.15, 1, 0], r: 2, s: 0.75, ...extra });

test('capture chains its predecessor with every argument and the original receiver', () => {
  let seen;
  const sculpt = { tap(...args) { seen = { receiver: this, args }; } };
  const cap = K.light.capture({ count: () => 8 }, sculpt);
  const ramp = [2, 3];
  sculpt.tap(ramp, 0.5, 0, 1, 0, false, 3);
  assert.deepEqual(seen, { receiver: sculpt, args: [ramp, 0.5, 0, 1, 0, false, 3] });
  assert.equal(cap.ramp[8], 1);
  sculpt.tap(ramp, 0.5, 0, 1, 0, true, 3);
  assert.equal(seen.args[5], true);
});

test('packed light reference agrees with painted rows through rotating, masked, coloured and flashed lights', () => {
  for (const keep of [undefined, 0, Infinity]) {
    const { stage, capture, data, packedColor } = fixture();
    const sun = { dir: [0, 1, 0], amb: 0.2, sky: 0.28, k: 0.31, parts: ['moving'], keep,
      lights: [lamp({ p: [-1, 0.8, 0], s: 0.35 })], shade: (x, y, z) => 0.9 + 0.1 * Math.cos(x + z) };
    const lights = [];
    const options = { sun }, packed = K.light.pack(stage, capture, options);
    const system = stage.add(K.light.system(stage, capture, lights, options));
    assert.equal(packed.count, 4);
    assert.deepEqual(Array.from(packed.rigRamp.slice(0, 3)), [0, 1, 1]);
    assert.equal(packed.rigRamp[12], -1);
    if (keep === Infinity) {
      for (let i = 0; i < 2; i++) {
        assert.equal(K.light.step(packed, i, data.subarray(i * 16, i * 16 + 3), capture.n[i]), i);
      }
      system.update(0);
      assert.equal(data[7], packedColor(0));
      assert.equal(data[23], packedColor(1));
    }
    assert.equal(K.light.step(packed, 3, [0, 0, 0], [0, 1, 0]), -1);
    lights.push(lamp(), lamp({ p: [0, 0.4, 0], ramp: [4, 5], vis: Uint8Array.of(255, 33, 220, 0) }));
    for (const [angle, flash] of [[0, 0], [0.7, 0.16], [-1.1, 0]]) {
      const c = Math.cos(angle), s = Math.sin(angle);
      stage.rig.M.set([c, -s, 0, s, c, 0, 0, 0, 1], 12);
      data[16] = 0.18 * angle;
      lights[0].p[0] = angle;
      lights[1].off = angle < 0;
      system.flash(flash, 0.2);
      stage.update(0, 0);
      for (let i = 0; i < 3; i++) {
        const [x, y, z] = capture.n[i], normal = i < 2 ? [c*x - s*y, s*x + c*y, z] : [x, y, z];
        const index = K.light.step(packed, i, data.subarray(i * 16, i * 16 + 3), normal, lights, flash);
        assert.equal(data[i * 16 + 7], packedColor(index), 'row ' + i + ' at angle ' + angle + ' with keep ' + keep);
      }
    }
  }
});

test('captured GLSL matches the CPU palette result in WebGL2', { skip: !process.env.INK_TEST_CHROME }, () => {
  const { stage, capture } = fixture();
  const sun = { dir: [0, 1, 0], amb: 0.2, sky: 0.28, k: 0.31, parts: ['moving'], keep: Infinity,
    lights: [lamp({ p: [-1, 0.8, 0], s: 0.35 })] };
  const packed = K.light.pack(stage, capture, { sun });
  const expected = [], buffer = [];
  const colors = [4, 5];
  for (let i = 0; i < 4096; i++) {
    const row = i % 3;
    const a = i * 1.3453;
    const p = i < 3 ? Array.from(stage.D.subarray(16 * row, 16 * row + 3)) :
      [Math.sin(1.7 * a), Math.sin(a) * 0.3, Math.cos(4.3 * a) * 0.5].map(Math.fround);
    const n = i < 3 ? capture.n[row] : [Math.cos(a), Math.sin(a), 0].map(Math.fround);
    const visibility = i < 3 ? 0 : i % 256;
    const flash = i > 3 && i % 5 === 0 ? Math.fround(0.14) : 0;
    const lamp1 = lamp({ s: i < 3 ? 0 : 0.75, vis: new Uint8Array(3).fill(visibility), ramp: colors });
    const level = packed.normalLevel[row * 4 + 3], reference = packed.rigRamp[row * 4 + 3];
    buffer.push(...p, ...n, level, packed.rigRamp[row * 4 + 2], reference, packed.baked[row],
      lamp1.s, visibility / 255, flash);
    expected.push(K.light.step(packed, row, p, n, [lamp1], flash));
  }
  const shader = `#version 300 es
precision highp float;
layout(location=0) in vec3 p;
layout(location=1) in vec3 n;
layout(location=2) in vec4 entry;
layout(location=3) in vec3 inputs;
out float palette;
${K.light.glsl}
void main() {
  float baked = entry.x;
  float level = capturedSun(n, vec3(0,1,0), vec3(0.2,0.28,0.31));
  level += capturedLampShare(p, n, vec4(-1.0,0.8,0.0,2.0), 0.35, 1.0);
  float base = entry.y > 0.5 ? capturedBase(baked, level, 1.0, entry.z, true) : baked;
  float share = capturedLampShare(p, n, vec4(0.15,1.0,0.0,2.0), inputs.x, inputs.y);
  float additional = inputs.z + share, lit = base + additional;
  if (share > 0.0 && capturedOverride(share, base)) palette = 4.0 + float(capturedStep(lit, 2));
  else if (entry.w >= 0.0 && capturedAtRest(baked, base, additional)) palette = entry.w;
  else palette = float(capturedStep(lit, 4));
  gl_Position = vec4(0,0,0,1);
}`;
  checkWebGL(shader, buffer, expected, [[0,3,0],[1,3,3],[2,4,6],[3,3,10]], 13);
});


function checkWebGL(shader, buffer, expected, attributes, stride,
  { proxyFrame = null, varyings = ['palette'], tolerance = 0 } = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { execFileSync } = require('node:child_process');
  const filename = 'light.html';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-light-browser-'));
  try {
    fs.writeFileSync(path.join(temp, filename), `<!doctype html><canvas></canvas><pre id="result"></pre><script>
try {
  const gl = document.querySelector('canvas').getContext('webgl2');
  if (!gl) throw new Error('WebGL 2 is unavailable');
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, ${JSON.stringify(shader)}));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER,
    '#version 300 es\\nprecision highp float; out vec4 color; void main(){color=vec4(0);}'));
  gl.transformFeedbackVaryings(program, ${JSON.stringify(varyings)}, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const proxyFrame = ${JSON.stringify(proxyFrame && { uniforms: Array.from(proxyFrame.uniforms), bias: proxyFrame.bias })};
  if (proxyFrame) {
    gl.uniform4fv(gl.getUniformLocation(program, 'uCapturedProxies[0]'), proxyFrame.uniforms);
    gl.uniform1f(gl.getUniformLocation(program, 'uCapturedProxyBias'), proxyFrame.bias);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(${JSON.stringify(buffer)}), gl.STATIC_DRAW);
  for (const [i, size, offset] of ${JSON.stringify(attributes)}) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, ${stride} * 4, offset * 4);
  }
  const expected = ${JSON.stringify(expected)};
  const output = new Float32Array(expected.length);
  const out = gl.createBuffer();
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, output.byteLength, gl.STREAM_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, expected.length / ${varyings.length});
  gl.endTransformFeedback();
  gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
  const mismatch = expected.findIndex((n,i) => !Number.isFinite(output[i]) || Math.abs(output[i] - n) > ${tolerance});
  result.textContent = mismatch < 0 ? 'PASS ' + output.length :
    'Mismatch ' + mismatch + ': expected ' + expected[mismatch] + ' got ' + output[mismatch];
} catch (error) { result.textContent = error.stack; }
</script>`);
    const args = ['--headless', '--no-first-run', '--disable-background-networking', '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader', '--user-data-dir=' + path.join(temp, 'profile'), '--dump-dom',
      pathToFileURL(path.join(temp, filename)).href];
    const html = execFileSync(process.env.INK_TEST_CHROME, args, { timeout: 30000, encoding: 'utf8', maxBuffer: 4e6,
      stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1], 'PASS ' + expected.length);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function proxyFixture() {
  const points = [[0, 0, 0], [2, 0, 0], [0, 0, 0], [0, 1.5, 0], [0, 0, 0]];
  const level = 0.73, palette = Array.from({ length: 10 }, (_, i) => 0x111111 * i);
  const data = new Float32Array(points.length * 16);
  const capture = { ramp: points.map(() => 1), t: points.map(() => level),
    n: points.map(() => [0, 1, 0]), ramps: [palette.map((_, i) => i)] };
  points.forEach((point, i) => {
    data.set(point, i * 16);
    data[i * 16 + 3] = 3;
    data[i * 16 + 7] = palette[7];
  });
  const stage = K.stage({ count: points.length, data, pal: palette });
  const rig = K.rig.fromGroups(stage, { deck: [0, 1], trim: [2], rotor: [3], boom: [4] });
  const sun = {
    dir: [0, 1, 0], amb: 0.18, sky: 0.12, k: 0.43, parts: ['deck', 'trim', 'rotor'], keep: Infinity,
    shadows: { bake: 'unshadowed', casters: [
      { part: 'rotor', type: 'box', center: [0, 1.5, 0], halfSize: [.5, .15, .3], receivers: ['deck', 'rotor'] },
      { part: 'boom', type: 'capsule', a: [1.5, 1, 0], b: [2.5, 1, 0], radius: .25, feather: .1, receivers: ['deck'] }
    ] }
  };
  return { stage, rig, capture, sun, palette };
}

test('proxy shadows follow independent rigs, honor receiver masks, and only attenuate direct sun', () => {
  const { stage, rig, capture, sun, palette } = proxyFixture();
  const { pack, step, proxyFrame, proxyVisibility } = K.light;
  assert.equal(proxyFrame(pack(stage, capture, { sun: { ...sun, shadows: false } })), null);
  assert.throws(() => pack(stage, capture, { sun: { ...sun, shadows: {} } }), /bake: "unshadowed"/);
  const [box, capsule] = sun.shadows.casters;
  for (const [casters, message] of [
    [Array(9).fill(box), /1 to 8/],
    [[{ ...box, receivers: ['missing'] }], /Unknown bound rig part/],
    [[{ ...box, receivers: ['boom'] }], /also be listed in sun.parts/],
    [[{ ...box, receivers: [] }], /explicit list of receivers/],
    [[{ ...box, halfSize: [0, 1, 1] }], /positive XYZ/],
    [[{ ...capsule, feather: 1 }], /between zero and radius/]
  ]) {
    assert.throws(() => pack(stage, capture, { sun: { ...sun, shadows: { ...sun.shadows, casters } } }), message);
  }
  assert.equal(rig.has('missing'), false);
  const packed = pack(stage, capture, { sun });
  const light = stage.add(K.light.system(stage, capture, [], { sun }));
  const frame = proxyFrame(packed);
  assert.deepEqual(Array.from(frame.masks), [0, 3, 0, 1, 0]);
  assert.throws(() => proxyFrame(packed, new Float32Array(12)), /pose palette/);
  const hostPose = rig.M.slice();
  hostPose[rig.part('rotor') * 12 + 9] = 15;
  assert.equal(proxyFrame(packed, hostPose), frame);
  assert.equal(proxyVisibility(frame, 1, [0, 0, 0], [0, 1, 0], sun.dir), 1);
  assert.equal(proxyFrame(packed), frame);
  const facing = [0, 1, 0];
  const visible = (position, mask) => proxyVisibility(frame, mask, position, facing, sun.dir);
  assert.equal(visible([0, 0, 0], 1), 0);
  assert.equal(visible([0, 1.5, 0], 1), 1, 'inside a proxy carries no self shadow');
  assert.equal(visible([0, 2, 0], 1), 1, 'a box behind the ray cannot cast a shadow');
  assert.equal(visible([2, 0, 0], 2), 0);
  assert.ok(Math.abs(visible([2, 0, .2], 2) - .5) < 1e-6, 'capsule edge feathers');
  assert.equal(visible([2, 0, .3], 2), 1);
  assert.equal(proxyVisibility(frame, 1, [0, 0, 0], [0, -1, 0], sun.dir), 1);
  const check = (expected, flash = 0) => {
    rig.apply();
    stage.update(0, 0);
    proxyFrame(packed);
    for (let i = 0; i < expected.length; i++) {
      const pos = stage.D.subarray(i * 16, i * 16 + 3);
      assert.equal(step(packed, i, pos, facing, [], flash), expected[i], 'packed reference row ' + i);
      assert.equal(stage.D[i * 16 + 7], palette[expected[i]], 'stage painter row ' + i);
    }
  };
  check([3, 3, 7, 7, 7]);
  const turn = K.M.rot([0, 1, 0], Math.PI / 2);
  // Turn the caster around its own pivot and slide it away from the deck.
  rig.set('rotor', turn, [0, 1.5, 0], [3, 1.5, 0]);
  check([7, 3, 7, 7, 7]);
  // Slide and squash the capsule independently. The squash narrows its shadow on Z.
  rig.set('boom', [1,0,0, 0,1,0, 0,0,.5], [0,0,0], [-2,0,0]);
  check([3, 7, 7, 7, 7]);
  assert.equal(visible([0, 0, .2], 2), 1);
  // A collapsed affine frame removes the caster, then can recover next pose.
  rig.set('boom', [0,0,0, 0,0,0, 0,0,0], [0,0,0], [0,0,0]);
  check([7, 7, 7, 7, 7]);
  rig.set('boom', K.M.id(), [0,0,0], [0,0,0]);
  check([7, 3, 7, 7, 7]);
  light.flash(.12, .2);
  check([8, 4, 8, 8, 8], .12);
});

test('only proxy receivers require a bake without a shadow march', () => {
  const { stage, capture, sun } = proxyFixture();
  let i = 0;
  const S = { shSteps: 0 }, recorded = K.light.capture({ count: () => i }, S);
  const tap = () => {
    S.tap(capture.ramps[0], capture.t[i], 0, 1, 0, false);
    i++;
  };
  tap();
  tap();
  S.shSteps = 20;
  tap(); // Trim receives no proxy shadow.
  S.shSteps = 0;
  tap();
  assert.doesNotThrow(() => K.light.pack(stage, recorded, { sun }));
  // Use the normal capture callback so the known march is associated with row zero.
  const marched = { shSteps: 20 };
  const recapture = K.light.capture({ count: () => 0 }, marched);
  marched.tap(capture.ramps[0], capture.t[0], 0, 1, 0, false);
  assert.throws(() => K.light.pack(stage, recapture, { sun }), /Set S.shSteps = 0/);
  assert.throws(() => K.light.system(stage, recapture, [], { sun }), /Set S.shSteps = 0/);
  assert.doesNotThrow(() => K.light.pack(stage, recapture, { sun: { ...sun, shadows: false } }));
});

test('a rolling sculpted plane moves its wing shadow across the fuselage under a fixed sun', () => {
  const { makeBuilder, makeSculpt } = require('..').load();
  const B = makeBuilder(7, [0x111623, 0x24344c, 0x486080, 0x7999b1, 0xaec4cf, 0xe3edf4]);
  const S = makeSculpt(B);
  S.shSteps = 0;
  S.sun = K.V.norm([.16, 1, .18]);
  S.amb = .2;
  S.sky = .12;
  S.sunK = .55;
  const cap = K.light.capture(B, S), rig = K.rig(B, S);
  const metal = { r: [0, 1, 2, 3, 4, 5] };
  S.ball([0,0,0], [.43,.42,1.6], metal, { tag:'fuselage', res:.11 });
  S.box([0,.50,0], [1.7,.05,.45], metal, { tag:'wing', res:.11, rd:.035 });
  S.box([0,.25,-1.2], [.64,.07,.24], metal, { tag:'tailplane', res:.11, rd:.04 });
  S.box([0,.4,-1.15], [.07,.32,.25], metal, { tag:'fin', res:.11, rd:.04 });
  S.bake();
  const stage = K.stage(B.finish({}));
  rig.bind(stage);
  const sun = { dir: S.sun, amb: S.amb, sky: S.sky, k: S.sunK, keep: Infinity, parts: rig.names.slice(1),
    shadows: { bake: 'unshadowed', casters: [
      { part:'wing', type:'box', center:[0,.50,0], halfSize:[1.7,.05,.45], receivers:['fuselage'] }
    ] } };
  const pack = K.light.pack(stage, cap, { sun });
  const open = K.light.pack(stage, cap, { sun: { ...sun, shadows:false } });
  stage.add(K.light.system(stage, cap, [], { sun }));
  const side = angle => {
    const rotation = K.M.rot([0,0,1], angle);
    for (const name of sun.parts) rig.set(name, rotation, [0,0,0], [0,0,0]);
    rig.apply();
    stage.update(0, angle + 1);
    K.light.proxyFrame(pack);
    const shadow = [];
    for (const i of rig.list[rig.part('fuselage')]) {
      const position = stage.D.subarray(16*i, 16*i+3), normal = K.M.app(rotation, cap.n[i]);
      const index = K.light.step(pack, i, position, normal);
      if (index < K.light.step(open, i, position, normal)) shadow.push(i);
      assert.equal(stage.D[i*16+7], paletteWord(stage.W.pal[index]));
    }
    assert.ok(shadow.length > 20, 'a visible band of the fuselage is shadowed');
    return shadow;
  };
  function paletteWord(rgb) {
    return ((rgb & 255) << 16) | (rgb & 0xff00) | (rgb >>> 16);
  }
  const left = side(-1.05), right = side(1.05);
  assert.ok(left.filter(i => !right.includes(i)).length > 20);
  assert.ok(right.filter(i => !left.includes(i)).length > 20);
  assert.deepEqual(side(-1.05), left, 'the same pose reproduces the shadow');
});

test('proxy visibility and final palette match WebGL2 on posed boxes and capsules', { skip: !process.env.INK_TEST_CHROME }, () => {
  const { stage, rig, capture, sun } = proxyFixture();
  rig.set('rotor', K.M.rot([0, 0, 1], .47), [0, 1.5, 0], [.3, 1.1, .1]);
  rig.set('boom', [1,.1,0, 0,1,.2, 0,0,.6], [0,0,0], [-1,.3,.5]);
  const packed = K.light.pack(stage, capture, { sun });
  const frame = K.light.proxyFrame(packed);
  const buffer = [], expected = [], samples = [];
  for (let i = 0; i < 4096; i++) {
    const a = i * 1.3241, mask = i % 4;
    const p = [1.7*Math.sin(a), .7*Math.cos(a*1.111), .75*Math.sin(a*.711)].map(Math.fround);
    const n = K.V.norm([.3*Math.cos(a*3), Math.sin(a*5), .4*Math.sin(a*7)]).map(Math.fround);
    const d = K.V.norm([.3*Math.sin(a*2), 1, .6*Math.cos(a*11)]).map(Math.fround);
    const visibility = K.light.proxyVisibility(frame, mask, p, n, d);
    const base = sun.amb + sun.sky * (.5 + .5*n[1]) + sun.k * Math.max(0, K.V.dot(n, d)) * visibility;
    samples.push(visibility);
    buffer.push(...p, ...n, ...d, mask);
    expected.push(visibility, Math.floor(10*base));
  }
  assert.ok(samples.filter(n => n === 0).length > 30);
  assert.ok(samples.filter(n => n > 0 && n < 1).length > 10);
  const shader = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 p;
layout(location=1) in vec3 n;
layout(location=2) in vec3 d;
layout(location=3) in float mask;
out float visible;
out float palette;
${K.light.glsl}
${K.light.proxyGLSL}
void main() {
  visible = capturedProxyVisibility(p, n, d, uint(mask));
  palette = float(capturedStep(capturedSun(n, d, vec3(0.18, 0.12, 0.43), visible), 10));
  gl_Position = vec4(0,0,0,1);
}`;
  checkWebGL(shader, buffer, expected, [[0,3,0],[1,3,3],[2,3,6],[3,1,9]], 10,
    { proxyFrame: frame, varyings: ['visible', 'palette'], tolerance: 2e-5 });
});
