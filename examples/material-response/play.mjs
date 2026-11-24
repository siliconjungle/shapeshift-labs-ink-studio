import { createRenderer } from '../../src/webgl/renderer.mjs';

const canvas = document.querySelector('canvas'), file = document.querySelector('[type=file]');
const play = document.querySelector('#play'), scrub = document.querySelector('[type=range]');
const output = document.querySelector('output'), status = document.querySelector('[role=status]');
const cursor = document.querySelector('.cursor'), form = document.querySelector('form'), input = form.elements.pixel;
const summary = document.querySelector('#summary'), source = document.querySelector('#source');
const decisions = document.querySelector('#decisions'), details = document.querySelector('details');
const cases = document.querySelector('.cases');
const renderer = createRenderer(canvas, { toolkit: { KIT, makeBuilder, makeSculpt, PixelLook } });
const reasons = {
  applied: 'Contributes to this pixel',
  'receiver-mismatch': 'The visible receiver fails the material selector',
  'no-visible-receiver': 'The pixel has no visible splat receiver',
  'no-receiver-depth': 'The receiver has no usable depth',
  'outside-projection-reach': 'The surface is beyond the projection reach',
  'outside-chart': 'The surface lies outside the field chart',
  'no-active-stamp': 'No active stamp reaches this texel',
  'below-threshold': 'The field value is below the swatch threshold',
  'masked-out': 'The pass mask or opacity excludes the pixel',
  'no-particle': 'No particle covers the pixel',
  'particle-occluded': 'The scene depth occludes the particle',
  'pass-disabled': 'The pass is disabled'
};
let audio, playback, world, running = false, anchor = 0, frame = 0, time = 0, end = 5.8, opening = 0, pixel;

function showReport(report) {
  const { receiver, outputSwatch, winner } = report;
  const chip = document.createElement('span');
  chip.className = 'swatch';
  chip.style.backgroundColor = outputSwatch ?? 'transparent';
  summary.replaceChildren(chip, (outputSwatch ?? 'Transparent') + ' · ' +
    (receiver?.object ?? receiver?.material ?? 'No splat receiver') + ' · ' + report.pixel.join(', ') +
    ' at ' + report.time.toFixed(2) + ' s');
  source.textContent = winner
    ? [winner.kind, winner.event?.id ?? 'Unknown contact', winner.event && winner.event.time.toFixed(2) + ' s',
      winner.sample && 'field ' + winner.sample.value.toFixed(3)].filter(Boolean).join(' · ')
    : 'No material response contributes to this pixel.';
  decisions.replaceChildren(...report.passes.map(pass => {
    const item = document.createElement('li');
    const samples = pass.channels?.filter(channel => channel.sample).map(channel => {
      const { value, event } = channel.sample;
      return channel.kind + ' ' + value.toFixed(3) + ' / ' + channel.threshold.toFixed(2) +
        (event ? ' from ' + event.id : '');
    }) ?? [];
    item.textContent = [pass.material ?? 'Particles', reasons[pass.reason] ?? pass.reason, ...samples].join(' · ');
    return item;
  }));
  details.querySelector('pre').textContent = JSON.stringify(report, null, 2);
  details.hidden = decisions.hidden = false;
}

function draw(t) {
  time = t;
  world.anim?.update(0, t);
  if (pixel && !running) {
    showReport(renderer.inspectEffectPixel(world, pixel, { time: t }));
    cursor.style.left = 100 * (pixel[0] + .5) / canvas.width + '%';
    cursor.style.top = 100 * (pixel[1] + .5) / canvas.height + '%';
  } else renderer.render(world, { time: t });
  cursor.hidden = !pixel || running;
  scrub.value = t;
  output.value = t.toFixed(2) + ' s';
}
function pause() {
  cancelAnimationFrame(frame);
  playback?.stop();
  running = false;
  play.textContent = 'Play';
}
function select(at, t = time) {
  if (!world) return;
  if (at.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n >= [canvas.width,canvas.height][i])) {
    status.textContent = 'Choose a pixel inside the 336 × 192 frame.';
    return;
  }
  pause();
  status.textContent = '';
  pixel = at;
  input.value = at.join(',');
  draw(t);
}
function tick() {
  const at = audio.currentTime - anchor;
  if (at >= end) { pause(); draw(end); return; }
  playback.sync();
  draw(at);
  frame = requestAnimationFrame(tick);
}
async function open(read) {
  const attempt = ++opening;
  pause();
  play.disabled = scrub.disabled = input.disabled = form.querySelector('button').disabled = true;
  status.textContent = '';
  try {
    audio ??= new AudioContext();
    const project = KIT.authoring.projectBundles.open(JSON.parse(await read()));
    const next = project.build(), buffers = new Map();
    if (!next.materialResponse) throw new Error('This project needs a material-response recipe.');
    for (const name of new Set(next.materialResponse.sounds().map(row => row.cue))) {
      const bytes = project.attachment(name).bytes;
      buffers.set(name, await audio.decodeAudioData(Uint8Array.from(bytes).buffer));
    }
    if (attempt !== opening) return;
    world = next;
    playback = world.materialResponse.createPlayback(audio, name => buffers.get(name));
    end = world.timeline?.duration || world.materialResponse.duration;
    scrub.max = end;
    pixel = undefined;
    cases.hidden = world.id !== 'silt-lock';
    details.hidden = decisions.hidden = true;
    if (cases.hidden) {
      summary.textContent = 'Click the scene or enter a pixel.';
      source.textContent = '';
      draw(0);
    } else select([150,98], 3.18);
    play.disabled = scrub.disabled = input.disabled = form.querySelector('button').disabled = false;
  } catch (error) { if (attempt === opening) status.textContent = error.message; }
}
file.addEventListener('change', () => {
  const selected = file.files[0];
  if (selected) open(() => selected.text());
});
play.addEventListener('click', async () => {
  if (running) { pause(); draw(time); return; }
  await audio.resume();
  if (time >= end) draw(0);
  playback.seek(time);
  anchor = audio.currentTime - time;
  running = true;
  play.textContent = 'Pause';
  tick();
});
scrub.addEventListener('input', () => {
  const t = Number(scrub.value);
  if (running) { playback.seek(t); anchor = audio.currentTime - t; }
  draw(t);
});
canvas.addEventListener('click', event => {
  const view = canvas.getBoundingClientRect();
  select([Math.floor((event.clientX - view.left) * canvas.width / view.width),
    Math.floor((event.clientY - view.top) * canvas.height / view.height)]);
});
form.addEventListener('submit', event => { event.preventDefault(); select(input.value.split(',').map(Number)); });
cases.addEventListener('click', event => {
  if (!event.target.dataset.probe) return;
  const [x,y,t] = event.target.dataset.probe.split(',').map(Number);
  select([x,y], t);
});
const embedded = document.querySelector('[data-silt-lock-project]');
if (embedded) open(() => embedded.textContent);
