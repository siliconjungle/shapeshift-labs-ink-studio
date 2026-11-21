const { test } = require('node:test');
const assert = require('node:assert/strict');

const binding = (resource, mode) => ({ resource, mode });
const shader = '@compute @workgroup_size(1) fn main() {}';
const node = (id, bindings) => ({ id, bindings, shader, workgroups: [1] });

test('WebGPU graph planning orders producers and rejects invalid resource wiring', async () => {
  const { planWebGPUGraph } = await import('../webgpu.mjs');
  const buffer = { type: 'buffer', size: 16 };
  const texture = { type: 'texture', width: 3, height: 2, format: 'rgba8unorm' };
  const resources = { input: buffer, positions: buffer, image: texture, scratch: texture };
  const geometry = node('geometry', [binding('input', 'read-buffer'), binding('positions', 'write-buffer')]);
  const image = node('paint', [binding('positions', 'read-buffer'), binding('image', 'write-texture')]);
  assert.deepEqual(planWebGPUGraph({ resources, nodes: [image, geometry] }),
    { order: ['geometry', 'paint'], outputs: { image: 'paint', positions: 'geometry' } });
  const secondWriter = node('other', [binding('image', 'write-texture')]);
  assert.throws(() => planWebGPUGraph({ resources, nodes: [image, secondWriter] }), /multiple writers/);
  const draw = node('draw', [binding('image', 'read-texture'), binding('scratch', 'write-texture')]);
  const filter = node('filter', [binding('scratch', 'read-texture'), binding('image', 'write-texture')]);
  assert.throws(() => planWebGPUGraph({ resources, nodes: [draw, filter] }), /Cycle/);
  assert.throws(() => planWebGPUGraph({ resources, nodes: [node('invalid', [binding('image', 'write-buffer')])] }),
    /Invalid GPU binding/);
});
