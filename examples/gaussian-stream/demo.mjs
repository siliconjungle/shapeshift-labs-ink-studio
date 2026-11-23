import { createGaussianChunkStream, createGaussianSplatRenderer } from '../../webgpu.mjs';
import { background, passCamera, limits } from './shots.mjs';

const get = id => document.getElementById(id);
const view = get('view'), status = get('status'), position = get('position');
const n = value => value.toLocaleString('en-US');
const mib = bytes => (bytes / 1048576).toFixed(2) + ' MiB';

async function start() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('Open this demo in a WebGPU browser on localhost or HTTPS.');
  const requiredFeatures = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({ requiredFeatures });
  const context = view.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const renderer = await createGaussianSplatRenderer(device, { format });
  const manifestPath = new URLSearchParams(location.search).get('manifest') ?? './pack/manifest.json';
  const url = new URL(manifestPath, location.href);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Pack unavailable. Build it with examples/gaussian-stream/prepare.mjs.');
  const manifest = await response.json();
  const stream = createGaussianChunkStream(renderer, KIT, manifest, { ...limits, url });
  let playing = false, previous, running = false, dirty = true, phase = 0, report;
  let lost = false;
  device.lost.then(error => {
    lost = true;
    status.textContent = error.message || 'WebGPU device lost.';
  });

  const schedule = () => { dirty = true; };
  function toggle(value) {
    playing = value;
    phase = Math.acos(1 - 2 * Number(position.value) / 100);
    get('play').textContent = playing ? 'Pause dolly' : 'Play dolly';
    get('play').setAttribute('aria-pressed', playing);
  }

  async function tick(now) {
    if (lost) return;
    requestAnimationFrame(tick);
    if (playing) {
      phase += Math.min(.05, (now - (previous ?? now)) / 1000) * .55;
      position.value = (1 - Math.cos(phase)) * 50;
      dirty = true;
    }
    previous = now;
    if (running || !dirty) return;
    running = true;
    dirty = false;
    try {
      const camera = passCamera(Number(position.value) / 100);
      const shot = await stream.render(context.getCurrentTexture(), { camera, background, profile: true });
      const s = shot.stream;
      report = { schema: 'ink.gaussian-stream-report.v1', camera, ...shot };
      const levels = new Map();
      for (const { level } of s.chunks) levels.set(level, (levels.get(level) ?? 0) + 1);
      get('measure').hidden = false;
      get('memory').textContent = mib(s.bytes + s.reservedBytes) + ' / ' + mib(s.budgetBytes);
      get('visible').textContent = n(shot.visible) + ' / ' + n(s.maxSplats);
      get('layer').textContent = n(s.layers.shoal.drawSplats) + ' / ' + n(s.layers.shoal.maxSplats);
      get('loads').textContent = n(s.loads) + ' / ' + n(s.evictions);
      get('levels').textContent = [...levels].sort().map(([key, count]) => key + ' × ' + count).join(' · ');
      get('held').textContent = n(s.retained) + ' retained';
      status.textContent = s.pending ? 'Loading shot chunks…' : n(s.ready) + ' drawable chunks';
      if (s.failures.length) status.textContent += ' · ' + s.failures[0].message;
      dirty ||= s.pending > 0;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      running = false;
    }
  }
  position.oninput = () => { toggle(false); schedule(); };
  get('survey').onclick = () => { position.value = '0'; toggle(false); schedule(); };
  get('pass').onclick = () => { position.value = '100'; toggle(false); schedule(); };
  get('play').onclick = () => { toggle(!playing); schedule(); };
  get('receipt').onclick = () => {
    if (!report) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href, download: 'gaussian-stream-report.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  requestAnimationFrame(tick);
}
start().catch(error => { status.textContent = error.message; });
