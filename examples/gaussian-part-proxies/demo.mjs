import { compileGaussianPartProxies, createRenderer, decodeGaussianPly, gaussianSplatWorld } from '../../webgl.mjs';
import { pelagicPalette, samplePly } from '../webgpu-graphs/sample.mjs';

const slider = document.getElementById('angle'), degrees = document.getElementById('degrees');
const play = document.getElementById('play'), status = document.getElementById('status');
const canvases = [...document.querySelectorAll('canvas')];
const world = gaussianSplatWorld(decodeGaussianPly(samplePly()), { colorMode: 'palette', palette: pelagicPalette });
const width = canvases[0].width, height = canvases[0].height;
const views = canvases.map(canvas => createRenderer(canvas, { toolkit: { KIT, PixelLook } }));
const indexOf = (strand, dot) => 31 * 104 + strand * 65 + dot;
const proxies = compileGaussianPartProxies(world, [1, 6, 11].map(strand => {
  const samples = Array.from({ length: 17 }, (_, i) => indexOf(strand, i * 4));
  return {
    mask: { count: world.count, indices: Array.from({ length: 65 }, (_, i) => indexOf(strand, i)) },
    shape: {
      type: 'stroke',
      points: samples.map(row => Array.from(world.data.subarray(row * 16, row * 16 + 3))),
      samples, radii: samples.map((_, i) => .029 * (1 - i / 16) + .009), minPixels: 1
    }
  };
}));

let angle = Number(slider.value), request, last, playing = false;
function draw(time) {
  request = undefined;
  if (playing && last !== undefined) angle = ((angle + Math.min(40, time - last) * .024 + 180) % 360) - 180;
  last = time;
  slider.value = Math.round(angle);
  degrees.value = slider.value + '°';
  const frame = { width, height, camera: { ...world.cam, yaw: angle * Math.PI / 180,
    pitch: -.08, dist: world.cam.dist * 1.06, ortho: true }, colored: false, dither: 0, damp: false, changedRows: [] };
  try {
    views[0].render(world, frame);
    views[1].render(world, { ...frame, gaussianPartProxies: proxies });
    status.hidden = true;
    document.body.dataset.ready = 'true';
  } catch (error) {
    status.hidden = false;
    status.textContent = error.message;
    setPlaying(false);
  }
  if (playing) redraw();
}
function redraw() {
  request ??= requestAnimationFrame(draw);
}
function setPlaying(value) {
  playing = value;
  last = undefined;
  play.textContent = playing ? 'Pause' : 'Play';
  play.setAttribute('aria-pressed', playing);
}
slider.addEventListener('input', () => {
  setPlaying(false);
  angle = Number(slider.value);
  redraw();
});
play.addEventListener('click', () => { setPlaying(!playing); redraw(); });
redraw();
