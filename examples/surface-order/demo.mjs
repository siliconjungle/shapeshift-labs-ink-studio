import { createRenderer } from '../../src/webgl/renderer.mjs';

const $ = id => document.getElementById(id), radians = degrees => degrees * Math.PI / 180;
const view = $('surface'), width = view.width, height = view.height;
const offscreen = document.createElement('canvas'), panels = [$('center'), view].map(c => c.getContext('2d', { alpha: false }));
const visibility = $('visibility'), timing = $('timing');
let renderer, gl, previous, pending, playing = false, theta = 0, angle = Number($('orbit').value), measuring = false;

function glass(extra) {
  const b = makeBuilder(84, [0x111722, 0xf8a36c, 0x63e8dd, 0xae8ce8]);
  const axes = sign => {
    const t = Math.SQRT1_2;
    return [[sign * t, 0, t], [t * .7, sign * Math.sqrt(.51), -sign * t * .7]];
  };
  const [leftNormal, leftAxis] = axes(-1), [rightNormal, rightAxis] = axes(1);
  b.dab(-.22, 0, 0, leftNormal, leftAxis, .84, .47, .013, b.P[2], .87);
  b.dab(.22, 0, 0, rightNormal, rightAxis, .84, .47, .013, b.P[1], .87);
  const cutGlass = {
    shape: 'polygon', stretch: [1.26, 1.34], softness: .055,
    vertices: [[-.95, -.36], [-.68, -.9], [.49, -.9], [.92, -.49], [.92, .39], [.61, .9], [-.53, .9], [-.95, .48]]
  };
  b.describeFootprint(0, 2, cutGlass);
  if (extra) {
    b.disc(.46, 0, -.55, [0, 0, 1], .42, .012, b.P[3], .59);
    b.describeFootprint(2, 3, { ...cutGlass, stretch: [.85, 1.16] });
  }
  return b.finish({
    radius: 5, dither: 0, fog: { start: 1, max: 0 },
    cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 3.65, ortho: true }
  });
}

function draw(mode, world, degrees, report) {
  renderer.render(world, {
    width, height, camera: { ...world.cam, yaw: radians(degrees) }, raw: true,
    dither: 0, damp: false, changedRows: [], splatOrder: mode,
    surfaceOrder: { layers: Number($('layers').value) }, surfaceOrderReport: report
  });
}
function showAngle() {
  $('orbit').value = angle;
  document.querySelector('output[for="orbit"]').value = angle.toFixed(1) + '°';
}
function showReport(report) {
  visibility.dataset.mode = report.mode;
  if (report.mode !== 'surface') {
    visibility.textContent = 'Center-order fallback · ' + report.reason;
    return;
  }
  visibility.textContent = report.passes + ' local geometry passes. ' +
    ($('third').checked && $('layers').value === '2'
      ? 'Pixels with three layers use center order.'
      : 'Each sheet can be in front on its side of the crossing.');
}
const worlds = [glass(false), glass(true)];
function frame(now) {
  pending = undefined;
  if (measuring) return;
  const world = worlds[+$('third').checked];
  if (playing && previous !== undefined) {
    theta += Math.min(.05, (now - previous) / 1000) * 1.6;
    angle = Math.sin(theta) * 6;
  }
  previous = now;
  showAngle();
  try {
    draw('center', world, angle);
    panels[0].drawImage(offscreen, 0, 0);
    draw('surface', world, angle, showReport);
    panels[1].drawImage(offscreen, 0, 0);
  } catch (error) {
    visibility.dataset.mode = 'error';
    visibility.textContent = error.message;
    play(false);
  }
  if (playing) redraw();
}
function redraw() { pending ??= requestAnimationFrame(frame); }
function play(active) {
  playing = active;
  previous = undefined;
  if (playing) theta = Math.asin(Math.max(-1, Math.min(1, angle / 6)));
  $('play').setAttribute('aria-pressed', active);
  $('play').textContent = active ? 'Pause sweep' : 'Play sweep';
  if (playing) redraw();
}
function invalidateMeasure() { timing.textContent = 'Measure a fixed sweep on this device.'; }
function measure() {
  if (measuring) return;
  play(false);
  measuring = true;
  $('measure').disabled = true;
  timing.textContent = 'Measuring both modes…';
  setTimeout(() => {
    try {
      const world = worlds[+$('third').checked], modes = ['center', 'surface'], times = [[], []];
      const pixel = new Uint8Array(4);
      function read() {
        gl.readPixels(width >> 1, height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      }
      for (const mode of modes) { draw(mode, world, .8); read(); }
      for (let n = 0; n < 12; n++) for (let j = 0; j < 2; j++) {
        const i = (n + j) & 1;
        const start = performance.now();
        draw(modes[i], world, -6 + n * 12 / 11);
        read();
        times[i].push(performance.now() - start);
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Could not read the benchmark frame');
      const [center, local] = times.map(values => values.sort((a, b) => a - b)[values.length >> 1]);
      timing.textContent = 'Center ' + center.toFixed(2) + ' ms · Surface ' + local.toFixed(2) + ' ms. Median of 12 draws per mode with a one-pixel readback.';
    } catch (error) { timing.textContent = error.message; }
    finally { measuring = false; $('measure').disabled = false; redraw(); }
  }, 40);
}

try {
  renderer = createRenderer(offscreen, { toolkit: { KIT, PixelLook } });
  gl = offscreen.getContext('webgl2');
  $('orbit').addEventListener('input', () => { play(false); angle = Number($('orbit').value); redraw(); });
  $('step').addEventListener('click', () => { play(false); angle = angle > 0 ? -.8 : .8; redraw(); });
  $('play').addEventListener('click', () => play(!playing));
  for (const id of ['third', 'layers']) $(id).addEventListener('change', () => { invalidateMeasure(); redraw(); });
  $('measure').addEventListener('click', measure);
  redraw();
} catch (error) {
  visibility.dataset.mode = 'error';
  visibility.textContent = error.message;
}
