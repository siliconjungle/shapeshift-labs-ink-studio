import { createGaussianSplatRenderer } from '../../webgpu.mjs';
import './study.js';

const study = globalThis[Symbol.for('ink-studio.gaussian-study')];
const get = id => document.getElementById(id);
const compared = { distant: [null, { footprint:'compensated' }], close: [
  { footprint:'compensated' }, { footprint:'compensated', projection:'ray' }
] };

async function start() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('Open the demo in a WebGPU browser on localhost.');
  const device = await adapter.requestDevice(), format = navigator.gpu.getPreferredCanvasFormat();
  const renderer = await createGaussianSplatRenderer(device,{format});
  const contexts = ['before','after'].map(id => {
    const context = get(id).getContext('webgpu');
    context.configure({device,format,alphaMode:'opaque'});
    return context;
  });
  let kind, world, queued;
  function draw() {
    queued = undefined;
    const height = get('before').height, phase = Number(get('phase').value);
    const onePixel = 2*world.cam.dist*Math.tan(world.cam.fov/2)/height;
    const target = [onePixel*phase,onePixel*phase*.5,0];
    contexts.forEach((context,i) => {
      renderer.render(context.getCurrentTexture(),{target,gaussianFilter:compared[kind][i]});
    });
  }
  function schedule() { queued ??= requestAnimationFrame(draw); }
  function choose(name) {
    kind = name;
    world = study[name]();
    renderer.setWorld(world);
    get('phase').value = '0';
    get('beforeLabel').textContent = name === 'distant' ? 'Legacy footprint' : 'Affine projection';
    get('afterLabel').textContent = name === 'distant' ? 'Opacity compensation' : 'Ray projection';
    for(const id of Object.keys(compared)) get(id).setAttribute('aria-pressed',name===id);
    schedule();
  }
  for (const id of Object.keys(compared)) get(id).onclick = () => choose(id);
  get('phase').oninput = schedule;
  choose('distant');
  get('status').textContent = '224 × 128 native art pixels per view';
}
start().catch(error => { get('status').textContent = error.message; });
