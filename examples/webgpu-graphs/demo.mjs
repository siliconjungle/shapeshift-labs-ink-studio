import { createWebGPUGraph } from '../../webgpu.mjs';
import { createRenderer, decodeGaussianSplat, gaussianSplatWorld } from '../../webgl.mjs';
import { samplePly, sampleSpz } from './sample.mjs';
import {
  textureWidth, textureHeight, gridSize, generateTexture, filterTexture, generateMesh, shapeMesh, presentTexture, presentMesh
} from './kernels.mjs';

const el = id => document.getElementById(id);
const status = el('gpu-status'), shaderStatus = el('compile-status');
const shader = el('shader'), pause = el('pause'), orbit = el('orbit');
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let elapsed = 0, previous, world, renderer, gpu, loadId = 0;
pause.setAttribute('aria-pressed', paused);
pause.textContent = paused ? 'Play motion' : 'Pause motion';
pause.addEventListener('click', () => {
  paused = !paused;
  pause.setAttribute('aria-pressed', paused);
  pause.textContent = paused ? 'Play motion' : 'Pause motion';
});

function indexedGrid() {
  const indices = new Uint16Array((gridSize - 1) ** 2 * 6);
  let i = 0;
  for (let y = 0; y < gridSize - 1; y++) for (let x = 0; x < gridSize - 1; x++) {
    const a = y * gridSize + x, b = a + gridSize;
    indices.set([a, b, a + 1, b, b + 1, a + 1], i);
    i += 6;
  }
  return indices;
}
const port = (mode, resource) => ({ mode, resource });
function definition(filter) {
  const image = { type: 'texture', width: textureWidth, height: textureHeight, format: 'rgba8unorm' };
  const vertex = { type: 'buffer', size: gridSize ** 2 * 16 };
  const uniform = { type: 'buffer', size: 16 };
  const imageGroups = [Math.ceil(textureWidth / 8), Math.ceil(textureHeight / 8)];
  const vertexGroups = [Math.ceil(gridSize ** 2 / 64)];
  return {
    resources: {
      interference: image, finalImage: image, grid: vertex, shaped: vertex,
      textureControls: uniform, meshControls: uniform
    },
    nodes: [
      { id: 'Refraction', shader: filter, workgroups: imageGroups, bindings: [
        port('uniform', 'textureControls'), port('read-texture', 'interference'), port('write-texture', 'finalImage')
      ] },
      { id: 'Interference', shader: generateTexture, workgroups: imageGroups, bindings: [
        port('uniform', 'textureControls'), port('write-texture', 'interference')
      ] },
      { id: 'Generate grid', shader: generateMesh, workgroups: vertexGroups, bindings: [port('write-buffer', 'grid')] },
      { id: 'Deform surface', shader: shapeMesh, workgroups: vertexGroups, bindings: [
        port('uniform', 'meshControls'), port('read-buffer', 'grid'), port('write-buffer', 'shaped')
      ] }
    ]
  };
}

async function initWebGPU() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('Open in a browser with WebGPU enabled to run Refraction and Fold.');
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const canvases = ['texture', 'mesh'].map(el);
  const contexts = canvases.map(canvas => canvas.getContext('webgpu'));
  for (const context of contexts) context.configure({ device, format, alphaMode: 'opaque' });
  const depth = device.createTexture({
    size: [textureWidth, textureHeight], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT
  });
  const indices = indexedGrid();
  const index = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(index, 0, indices);
  function pipeline(code, mesh) {
    const module = device.createShaderModule({ code });
    return device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      ...(mesh && { depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } })
    });
  }
  const [texturePipe, meshPipe] = await Promise.all([pipeline(presentTexture), pipeline(presentMesh, true)]);
  let scene;
  async function useFilter(code) {
    const graph = await createWebGPUGraph(device, definition(code));
    const finalImage = graph.get('finalImage').createView();
    const textureBind = device.createBindGroup({
      layout: texturePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: finalImage }]
    });
    const meshBind = device.createBindGroup({
      layout: meshPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: graph.get('meshControls') } },
        { binding: 1, resource: { buffer: graph.get('shaped') } },
        { binding: 2, resource: finalImage }
      ]
    });
    const previousScene = scene;
    scene = { graph, textureBind, meshBind };
    previousScene?.graph.dispose();
  }
  await useFilter(filterTexture);
  device.lost.then(info => {
    gpu = undefined;
    status.textContent = 'WebGPU device disconnected. Reload to start again. ' + info.message;
    status.dataset.state = 'error';
    for (const control of ['shift', 'deform', 'shader', 'compile', 'reset']) el(control).disabled = true;
  });
  const textureControls = new Float32Array(4), meshControls = new Float32Array(4);
  return {
    useFilter,
    draw(time) {
      const { graph, textureBind, meshBind } = scene;
      textureControls.set([time, Number(el('shift').value), 0, 0]);
      meshControls.set([time, Number(el('deform').value), textureWidth / textureHeight, 0]);
      graph.writeBuffer('textureControls', textureControls);
      graph.writeBuffer('meshControls', meshControls);
      const encoder = device.createCommandEncoder();
      graph.encode(encoder, ['finalImage', 'shaped']);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: contexts[0].getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }]
      });
      pass.setPipeline(texturePipe);
      pass.setBindGroup(0, textureBind);
      pass.draw(3);
      pass.end();
      const mesh = encoder.beginRenderPass({
        colorAttachments: [{
          view: contexts[1].getCurrentTexture().createView(), clearValue: [.019, .057, .087, 1],
          loadOp: 'clear', storeOp: 'store'
        }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
      });
      mesh.setPipeline(meshPipe);
      mesh.setBindGroup(0, meshBind);
      mesh.setIndexBuffer(index, 'uint16');
      mesh.drawIndexed(indices.length);
      mesh.end();
      device.queue.submit([encoder.finish()]);
    }
  };
}

async function useShader() {
  const engine = gpu;
  if (!engine) return;
  el('compile').disabled = true;
  el('reset').disabled = true;
  shaderStatus.textContent = 'Compiling…';
  try {
    await engine.useFilter(shader.value);
    shaderStatus.textContent = 'Shader applied';
    dirty = true;
  } catch (error) {
    shaderStatus.textContent = error.message;
  } finally {
    if (gpu === engine) el('compile').disabled = el('reset').disabled = false;
  }
}
shader.value = filterTexture;
el('compile').addEventListener('click', useShader);
el('reset').addEventListener('click', () => {
  shader.value = filterTexture;
  void useShader();
});
let dirty = true;
for (const field of ['shift', 'deform', 'orbit']) el(field).addEventListener('input', () => { dirty = true; });

async function load(name, source) {
  const current = ++loadId, output = el('splat-status');
  output.textContent = 'Opening ' + name + '…';
  try {
    const asset = await decodeGaussianSplat(await source(), { maxPoints: 2_000_000 });
    if (current !== loadId) return;
    world = gaussianSplatWorld(asset);
    output.textContent = asset.count.toLocaleString() + ' splats · ' + asset.format.toUpperCase() +
      (asset.version ? ' v' + asset.version : '') + ' · ' + name;
    output.dataset.state = 'ready';
    dirty = true;
  } catch (error) {
    if (current !== loadId) return;
    output.textContent = error.message;
    output.dataset.state = 'error';
  }
}
function fileSource(file) {
  if (file.size > 768 * 1024 * 1024) throw new Error('Gaussian file exceeds the byte limit');
  return file.arrayBuffer();
}
try {
  renderer = createRenderer(el('splat'), { toolkit: { KIT, PixelLook } });
  el('ply').addEventListener('click', () => load('Pelagic.ply', samplePly));
  el('spz').addEventListener('click', () => load('Pelagic.spz', sampleSpz));
  el('file').addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) void load(file.name, () => fileSource(file));
  });
  void load('Pelagic.ply', samplePly);
} catch (error) {
  el('splat-status').textContent = error.message;
  for (const field of ['ply', 'spz', 'file', 'orbit']) el(field).disabled = true;
}
initWebGPU().then(engine => {
  gpu = engine;
  status.textContent = 'WebGPU active · texture and geometry';
  status.dataset.state = 'ready';
  dirty = true;
  for (const field of ['shift', 'deform', 'shader', 'compile', 'reset']) el(field).disabled = false;
}).catch(error => {
  status.textContent = error.message;
  status.dataset.state = 'error';
});
pause.disabled = false;
function frame(now) {
  if (previous !== undefined && !paused) elapsed += Math.min(.08, (now - previous) / 1000);
  previous = now;
  if (!paused || dirty) {
    gpu?.draw(elapsed);
    if (world) renderer.render(world, {
      width: 672, height: 460, time: 0, raw: true, colored: true, damp: false,
      camera: { ...world.cam, yaw: Number(orbit.value) * Math.PI / 180 + elapsed * .30, pitch: -.12 }
    });
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
