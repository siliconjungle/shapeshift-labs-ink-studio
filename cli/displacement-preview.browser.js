const el = id => document.getElementById(id);
const plan = displacementPreview;
const labels = { flat: 'Flat', parallax: 'Parallax', relief: 'Real relief', tessellation: 'Increase tessellation', outside: 'Out of view' };
const locale = new Intl.NumberFormat('en-US');
const short = n => Number(n.toFixed(3)).toString();
const labelMode = choice => labels[choice];
const compare = (camera, settings) => DisplacementRenderer.compare(renderer, camera, settings, plan.view);
const slots = new Map(), tiles = el('tiles');
const canvases = Object.fromEntries(plan.modes.map(mode => [mode, el(mode).querySelector('canvas')]));
const cameraRows = el('cameras');
let renderer, current, active = plan.cameras[0].id, settings = plan.settings, rows = {}, queued, batch, version = 0;

el('title').textContent = plan.label;
document.title = plan.label + ' · Ink Studio';
document.documentElement.style.setProperty('--ratio', plan.view.width / plan.view.height);
for (const canvas of Object.values(canvases)) {
  canvas.width = plan.view.width;
  canvas.height = plan.view.height;
}
const span = Math.max(.001, plan.maps.height.max - plan.maps.height.min);
const magnitude = Math.max(plan.controls.maxScale, Math.abs(settings.scale));
Object.assign(el('scale'), { min: -magnitude, max: magnitude, value: settings.scale });
Object.assign(el('bias'), { min: Math.min(settings.bias, plan.maps.height.min - span * .5),
  max: Math.max(settings.bias, plan.maps.height.max + span * .5), value: settings.bias });
el('segments-u').value = settings.tessellation[0];
el('segments-v').value = settings.tessellation[1];
el('tangent').value = settings.tangent;
el('tangent').disabled = !plan.maps.normal;
if (!plan.maps.normal) el('tangent').title = 'Normals are derived from the height field';
el('seam').value = settings.seam;
tiles.value = settings.repeats[0];
if (settings.repeats[1] > 1) {
  tiles.options[0].text = 'One column';
  tiles.options[1].text = 'Two columns';
}
for (const camera of plan.cameras) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.camera = camera.id;
  button.onclick = () => choose(camera.id);
  cameraRows.append(button);
  slots.set(camera.id, button);
}
function labelsForCameras() {
  for (const camera of plan.cameras) {
    const button = slots.get(camera.id), row = rows[camera.id];
    button.textContent = camera.label + (row ? ' · ' + labelMode(row.choice) : '');
    button.setAttribute('aria-pressed', String(camera.id === active));
  }
}
function read() {
  return { ...settings, scale: Number(el('scale').value), bias: Number(el('bias').value),
    tessellation: ['segments-u', 'segments-v'].map((key, i) => Math.min(160, Math.max(1,
      Math.round(Number(el(key).value) || settings.tessellation[i])))),
    tangent: el('tangent').value, seam: el('seam').value, repeats: [Number(tiles.value), settings.repeats[1]] };
}
function schedule() {
  if (!renderer) return;
  clearTimeout(batch);
  el('download').disabled = true;
  cancelAnimationFrame(queued);
  const token = ++version;
  queued = requestAnimationFrame(() => {
    settings = read();
    rows = {};
    choose(active);
    batch = setTimeout(() => {
      if (token !== version) return;
      for (const camera of plan.cameras) if (!rows[camera.id]) {
        const { scores, segments, choice } = compare(camera, settings);
        rows[camera.id] = { scores, segments, choice };
      }
      labelsForCameras();
      el('download').disabled = false;
    }, 125);
  });
}
function choose(id) {
  active = id;
  const camera = plan.cameras.find(row => row.id === active);
  labelsForCameras();
  if (!renderer) return;
  current = compare(camera, settings);
  const { scores, segments, choice } = current;
  rows[id] = { scores, segments, choice };
  labelsForCameras();
  draw(camera);
}
function draw(camera = plan.cameras.find(row => row.id === active)) {
  if (!current) return;
  const { frames, reference, scores, choice, segments } = current;
  const view = el('view').value, span = view === 'depth' && DisplacementRenderer.depthSpan({ ...frames, reference });
  for (const mode of plan.modes) {
    const panel = el(mode), s = scores[mode];
    panel.dataset.choice = String(mode === choice);
    panel.querySelector('.mode').textContent = mode === choice ? 'Within tolerance' : '';
    panel.querySelector('[data-error]').textContent = locale.format(s.profile) + ' profile px · ' +
      (s.colorRmse === null ? '—' : s.colorRmse.toFixed(1)) + ' RGB error';
    panel.querySelector('[data-triangles]').textContent = locale.format(s.triangles) + ' tris';
    DisplacementRenderer.paint(canvases[mode], frames[mode], reference, view, span || undefined);
  }
  const summary = el('summary'), strong = document.createElement('strong');
  strong.textContent = labelMode(choice);
  const reasons = {
    flat: ' meets the error limits at this camera range.',
    parallax: ' meets the limits with plane depth.',
    relief: ' meets the limits. Parallax exceeds the tolerance at this range.',
    tessellation: ' until the relief matches the finer reference.',
    outside: ' at this camera range.'
  };
  summary.replaceChildren(strong, document.createTextNode(reasons[choice]));
  const difference = (scores.parallax.maxDepthError ?? 0).toFixed(3);
  el('evidence').textContent = 'Parallax depth error ' + difference + ' world units · reference ' + segments.join(' × ');
  el('scale-value').textContent = short(settings.scale);
  el('bias-value').textContent = short(settings.bias);
  el('foot').textContent = plan.view.width + ' × ' + plan.view.height + ' native pixels · camera distance ' +
    short(camera.distance) + ' · profile limits ' + plan.view.profilePixels + ' px and ' + short(plan.view.profileFraction * 100) +
    '% · RGB RMS limit ' + short(plan.view.colorRmse) +
    (view === 'difference' ? ' · amber shows lost coverage and cyan shows added coverage' : '');
}

for (const key of ['scale', 'bias', 'segments-u', 'segments-v', 'tangent', 'seam', 'tiles'])
  el(key).addEventListener('input', schedule);
el('view').onchange = () => draw();
el('download').onclick = () => {
  const review = {
    format: 'ink-studio/displacement-preview-review', version: 1, label: plan.label, settings, view: plan.view,
    maps: Object.fromEntries(Object.entries(plan.maps).map(([name, row]) => [name, row.sha256])),
    cameras: plan.cameras.map(camera => ({ camera, ...rows[camera.id] }))
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'displacement-review.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
try {
  renderer = DisplacementRenderer.create(plan);
  schedule();
} catch (error) {
  labelsForCameras();
  el('summary').textContent = error.message;
  el('summary').classList.add('notice');
}
