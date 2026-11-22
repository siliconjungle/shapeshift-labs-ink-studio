const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

function createPatchGpu(baseDir, modulePath) {
  const programs = new Map();
  let root, device, createWebGPUGraph;
  async function initialize() {
    if (device) return;
    const local = createRequire(path.join(baseDir, 'package.json'));
    let file;
    try { file = modulePath ? path.resolve(modulePath) : local.resolve('webgpu'); }
    catch {
      try { file = require.resolve('webgpu'); }
      catch { throw new Error('WGSL patches need the optional webgpu package. Install it next to the patch or pass --gpu-module.'); }
    }
    const binding = await import(pathToFileURL(file).href);
    if (typeof binding.create !== 'function' || !binding.globals) throw new TypeError('Expected a node-webgpu module');
    for (const [key, value] of Object.entries(binding.globals)) if (!(key in globalThis)) globalThis[key] = value;
    root = binding.create([]);
    const adapter = await root.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available for this patch');
    device = await adapter.requestDevice();
    ({ createWebGPUGraph } = await import('../webgpu.mjs'));
  }
  return {
    async process({ width, height, data, wgsl, amount, time, position = [0, 0, 0] }) {
      if (width * height > 1048576 || Buffer.byteLength(wgsl) > 65536 || !wgsl.trim() ||
          ![amount, time, ...position].every(n=>Number.isFinite(Math.fround(n)))) throw new RangeError('Patch shader inputs exceed their limits');
      await initialize();
      const key = JSON.stringify([width,height,wgsl]);
      let graph = programs.get(key);
      if (!graph) {
        const texture = { type:'texture', width, height, format:'rgba8unorm' };
        graph = await createWebGPUGraph(device, {
          resources:{ source:texture, result:texture, settings:{ type:'buffer', size:32 } },
          nodes:[{ id:'shader', shader:wgsl, workgroups:[Math.ceil(width/8),Math.ceil(height/8)], bindings:[
            { resource:'source', mode:'read-texture' }, { resource:'result', mode:'write-texture' },
            { resource:'settings', mode:'uniform' }
          ] }]
        });
        if (programs.size >= 8) {
          const first = programs.keys().next().value;
          programs.get(first).dispose();
          programs.delete(first);
        }
        programs.set(key, graph);
      }
      graph.writeTexture('source', data);
      graph.writeBuffer('settings', new Float32Array([time, amount, width, height, ...position, 0]));
      graph.run(['result']);
      return graph.readTexture('result');
    },
    dispose() {
      for (const graph of programs.values()) graph.dispose();
      programs.clear();
      device?.destroy();
      device = root = undefined;
    }
  };
}
module.exports = { createPatchGpu };
