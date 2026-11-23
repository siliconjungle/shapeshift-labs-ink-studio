import { createGaussianSplatRenderer, decodeGaussianSplat, gaussianSplatWorld } from '../../webgpu.mjs';
import { cameras, reefPly } from './reef.mjs';

const get = id => document.getElementById(id);
const view = get('view'), status = get('status'), orbit = get('orbit');
const ms = value => Number.isFinite(value) ? value.toFixed(2) + ' ms' : 'Unavailable';
const n = value => value.toLocaleString('en-US');

async function start() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU is unavailable. Open this demo in a WebGPU browser on localhost or HTTPS.');
  const requiredFeatures = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits: {
    maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024)
  } });
  const context = view.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const renderer = await createGaussianSplatRenderer(device, { format });
  let world, demo, current, cloud, report, busy = false, loading = false, needsDraw = false, revision = 0;
  let preset = 'detail';

  device.lost.then(detail => { status.textContent = detail.message || 'WebGPU device lost.'; });

  async function render() {
    if (!world || busy || loading) return;
    const ticket = revision;
    busy = true;
    needsDraw = false;
    try {
      const base = demo ? cameras[preset] : world.cam;
      const camera = { ...base, yaw: base.yaw + Number(orbit.value) * Math.PI / 180 };
      const next = await renderer.render(context.getCurrentTexture(), {
        camera, background: [6, 15, 26], profile: true
      });
      if (ticket !== revision) return;
      report = { schema: 'ink.gaussian-gpu-profile.v1', asset: current, view: preset, size: [view.width, view.height],
        camera, cloud, ...next };
      get('visible').textContent = n(next.visible) + ' / ' + n(next.input);
      get('projection').textContent = ms(next.gpuMs?.projectionCull);
      get('sort').textContent = ms(next.gpuMs?.sorting);
      get('raster').textContent = ms(next.gpuMs?.raster);
      get('camera').textContent = n(next.cameraUpload.bytes) + ' B / frame';
      get('cloud').textContent = (cloud.bytes / 1048576).toFixed(2) + ' MiB once';
      get('measure').hidden = false;
      status.textContent = current + ' · ' + n(next.culled) + ' culled';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      if (needsDraw) requestAnimationFrame(render);
    }
  }

  function schedule() {
    needsDraw = true;
    requestAnimationFrame(render);
  }
  function setPreset(presetName) {
    preset = presetName;
    orbit.value = '0';
    for (const id of Object.keys(cameras)) get(id).setAttribute('aria-pressed', id === preset);
    schedule();
  }
  async function load(bytes, name, isDemo) {
    const ticket = ++revision;
    loading = true;
    status.textContent = 'Importing ' + name + '…';
    try {
      const decoded = await decodeGaussianSplat(await bytes, { maxPoints: renderer.maxSplats });
      const next = gaussianSplatWorld(decoded, { size: isDemo ? 40 : 6 });
      await device.queue.onSubmittedWorkDone();
      if (ticket !== revision) return;
      const time = performance.now();
      const upload = renderer.setWorld(next);
      world = next;
      current = name;
      demo = isDemo;
      await device.queue.onSubmittedWorkDone();
      if (ticket !== revision) return;
      cloud = { ...upload, queueCompletionMs: performance.now() - time };
      for (const id of Object.keys(cameras)) get(id).hidden = !demo;
      setPreset('detail');
    } finally {
      if (ticket === revision) loading = false;
    }
  }

  for (const id of Object.keys(cameras)) get(id).onclick = () => setPreset(id);
  orbit.oninput = schedule;
  get('import').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await load(file.arrayBuffer(), file.name, false);
    } catch (error) {
      status.textContent = error.message;
    }
  };
  get('receipt').onclick = () => {
    if (!report) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = 'gaussian-gpu-render.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  await load(reefPly(), 'Pelagic Current · PLY', true);
}
start().catch(error => { status.textContent = error.message; });
