const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('..');

function testContext() {
  const calls = [];
  const gl = {
    ACTIVE_UNIFORMS: 1, LINK_STATUS: 2, COMPILE_STATUS: 3,
    VERTEX_SHADER: 4, FRAGMENT_SHADER: 5, ARRAY_BUFFER: 6,
    STATIC_DRAW: 7, DYNAMIC_DRAW: 8, FLOAT: 9, INT: 10, TRIANGLE_STRIP: 11,
    createProgram: () => ({ shaders: [] }),
    createShader: type => ({ type }),
    shaderSource: (shader, source) => { shader.source = source; },
    compileShader() {},
    getShaderParameter: () => true,
    attachShader: (program, shader) => { program.shaders.push(shader); },
    linkProgram() {},
    getProgramParameter: (_, name) => name === gl.LINK_STATUS ? true : 0,
    deleteProgram: () => calls.push('delete program'),
    deleteShader: () => calls.push('delete shader'),
    createVertexArray: () => ({}), bindVertexArray() {},
    deleteVertexArray: () => calls.push('delete vao'),
    createBuffer: () => ({}), bindBuffer() {},
    deleteBuffer: () => calls.push('delete buffer'),
    bufferData() {}, bufferSubData() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    vertexAttribIPointer() {}, vertexAttribDivisor() {},
    drawArraysInstanced: (...args) => calls.push(args)
  };
  return { gl, calls };
}

test('the optional entry imports in Node without touching the software renderer', async () => {
  const entry = await import('../webgl.mjs');
  const { createRenderer, splatShaderSources } = entry;
  assert.equal(typeof core.render, 'function');
  assert.equal(entry.default, createRenderer);
  assert.equal(require('../package.json').browser, './webgl.mjs');
  assert(splatShaderSources().vertex.startsWith('#version 300 es'));
  const phased = splatShaderSources(undefined,core.load().KIT.procedural.sampleCoverage).vertex;
  assert.match(phased,/int kraw = int\(t2.w\)/);
  assert.match(phased,/if \(!sampleCoverageVisible\(kraw, u_sampleWithdrawal\)\)/);
  assert.throws(() => createRenderer({}, { toolkit: core.load() }), /canvas/);
  assert.throws(() => createRenderer({ getContext: () => null }, { toolkit: core.load() }), /requires WebGL 2/);
  assert.throws(() => createRenderer({ getContext: () => null }, { toolkit: core.load(), resolve: 'invalid' }),
    /resolve must be 'auto' or 'simple'/);
});

test('the GPU pipeline chooses the full shader as soon as a visual feature turns on', async () => {
  const { createSplatPipeline } = await import('../webgl.mjs');
  const { gl, calls } = testContext();
  const pipeline = createSplatPipeline(gl);
  const full = pipeline.programFor();
  const empty = { lamps: false, fine: false, textZones: false };
  const plain = pipeline.programFor(empty);
  assert.notEqual(full.p, plain.p);
  assert.equal(pipeline.programFor(empty), plain);
  assert.equal(pipeline.programFor({}), full);
  for (const feature of Object.keys(empty))
    assert.equal(pipeline.programFor({ ...empty, [feature]: true }), full);
  const vertex = plain.p.shaders.find(shader => shader.type === gl.VERTEX_SHADER).source;
  assert.match(vertex, /if \(false && \(flags & 22\)/);
  assert.match(vertex, /if \(false && plain/);

  pipeline.setOrder(Int32Array.of(2, 1));
  pipeline.draw();
  assert.deepEqual(calls.at(-1), [gl.TRIANGLE_STRIP, 0, 4, 2]);
  assert.throws(() => pipeline.draw(3), /draw count/);
  pipeline.dispose();
  pipeline.dispose();
  assert.equal(calls.filter(call => call === 'delete program').length, 2);
  assert.equal(calls.filter(call => call === 'delete buffer').length, 2);
  assert.throws(() => pipeline.draw(), /disposed/);
});

test('texture tables batch adjacent dirty rows and zero-pad the final row', async () => {
  const { createTargets } = await import('../src/webgl/targets.mjs');
  const calls = [];
  const gl = {
    activeTexture() {}, bindTexture() {}, texImage2D() {},
    texSubImage2D(...args) {
      const [, , , row, width, height, , , values, offset = 0] = args;
      calls.push([row, height, [...values.subarray(offset, offset + width * height * 4)]]);
    }
  };
  const { table } = createTargets(gl, { texture: () => ({}) });
  const texture = table(1, 0, 8);
  const values = Float32Array.from({ length: 24 }, (_, i) => i + 1);
  texture.upload(values, 22);
  calls.length = 0;
  const dirty = [5, 2, 4, 0, 3, 2];
  texture.upload(values, 22, dirty);
  assert.deepEqual(dirty, [5, 2, 4, 0, 3, 2]);
  assert.deepEqual(calls, [[0, 1, [1, 2, 3, 4]], [2, 3, [...values.slice(8, 20)]], [5, 1, [21, 22, 0, 0]]]);
  calls.length = 0;
  texture.upload(values, 22, []);
  assert.deepEqual(calls, []);
});

test('zero-opacity splats do not change the depth buckets or draw order', async () => {
  const { createDepthSorter } = await import('../src/webgl/view.mjs');
  const sort = createDepthSorter();
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const data = new Float32Array(4 * 16);
  data.set([0, 0, 2, .5], 0);
  data.set([0, 0, 1000000, 0], 16);
  data.set([0, 0, 1, .5], 32);
  data.set([0, 0, 0, 0], 48);
  const world = { count: 4, data };
  const all = [...sort(world, view, 0)];
  const compact = sort(world, view, 0, undefined, undefined, undefined, undefined, undefined, undefined, data);
  assert.deepEqual([...compact], all.filter(i => data[i * 16 + 3] > 0));
  assert.deepEqual([...compact], [0, 2]);
  data[3] = data[35] = 0;
  assert.equal(sort(world, view, 0, undefined, undefined, undefined, undefined, undefined, undefined, data).length, 0);
});
