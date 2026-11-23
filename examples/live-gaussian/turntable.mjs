import { encodeGaussianTurntablePNG, encodeGaussianTurntableNormalPNG } from '../../src/webgl/gaussian-turntable.mjs';
import { previewSpriteNormals } from '../../src/webgl/sprite-normal-preview.mjs';

export function mountTurntable({ renderer, source, pause }) {
  const get = id => document.getElementById(id);
  const canvas = get('turntable-preview'), context = canvas.getContext('2d');
  const generate = get('turntable-generate'), play = get('turntable-play'), step = get('turntable-step');
  const download = get('turntable-png'), metadata = get('turntable-json'), state = get('turntable-status');
  const downloadNormals = get('turntable-normal-png'), mode = get('turntable-preview-mode'), light = get('turntable-light');
  const options = ['angles', 'size', 'columns', 'fps', 'cutoff', 'normals'].map(id => get('turntable-' + id));
  const [angles, tileSize, columns, fps, cutoff, normals] = options;
  let sheet, current = 0, timer, version = 0, encoding = false;

  function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = 'Play loop';
    play.setAttribute('aria-pressed', 'false');
  }

  function buttons() {
    play.disabled = step.disabled = !sheet || sheet.metadata.frames.length < 2;
    download.disabled = !sheet || encoding;
    downloadNormals.disabled = !sheet?.normal || encoding;
    get('turntable-normal-controls').hidden = !sheet?.normal;
    metadata.disabled = !sheet;
  }

  function invalidate() {
    version++;
    sheet = undefined;
    stop();
    buttons();
    context.clearRect(0, 0, canvas.width, canvas.height);
    get('turntable-frame').textContent = '—';
    state.textContent = 'Build a preview to review the loop.';
  }

  function show(index) {
    current = index;
    const { rect, pivot, angle } = sheet.metadata.frames[index];
    const { width, height } = rect, image = context.createImageData(width, height);
    const { palette, transparent } = sheet.metadata;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const slot = sheet.indices[(rect.y + y) * sheet.width + rect.x + x];
      if (slot === transparent) continue;
      const offset = (y * width + x) * 4;
      image.data.set(palette[slot], offset);
      image.data[offset + 3] = 255;
    }
    previewSpriteNormals(image.data, sheet.normal, sheet.width, rect, mode.value, Number(light.value));
    context.putImageData(image, 0, 0);
    const crosshair = get('turntable-crosshair');
    crosshair.style.left = 100 * pivot.x / width + '%';
    crosshair.style.top = 100 * pivot.y / height + '%';
    step.value = index;
    get('turntable-frame').textContent = (index + 1) + ' / ' + sheet.metadata.frames.length + ' · ' + angle + '°';
  }

  function parseAngles() {
    const tokens = angles.value.split(',').map(token => token.trim());
    if (tokens.some(token => !token || !Number.isFinite(Number(token))))
      throw new RangeError('Enter angles as comma-separated numbers.');
    return tokens.map(Number);
  }

  function build() {
    invalidate();
    const ticket = version;
    const { world, frame } = source();
    if (!world || !frame) {
      state.textContent = 'Open a Gaussian cloud first.';
      return;
    }
    pause();
    generate.disabled = true;
    state.textContent = 'Rendering the sprite frames…';
    // Let the progress message paint before the renderer reads back the sheet.
    requestAnimationFrame(() => setTimeout(() => {
      try {
        if (ticket !== version) return;
        const width = Number(tileSize.value);
        sheet = renderer.captureTurntable(world, { angles: parseAngles(), width, height: width,
          columns: Number(columns.value), fps: Number(fps.value), cutoff: Number(cutoff.value) / 100, normals: normals.checked, frame });
        canvas.width = canvas.height = width;
        step.max = sheet.metadata.frames.length - 1;
        const clipped = sheet.metadata.frames.filter(frame => frame.touchesBorder).length;
        const empty = sheet.metadata.frames.filter(frame => frame.pixels === 0).length;
        const warnings = [clipped && clipped + ' touching an edge', empty && empty + ' empty'].filter(Boolean);
        const normalCount = sheet.normal && sheet.metadata.frames.reduce((sum, frame) => sum + frame.normalPixels, 0);
        state.textContent = sheet.metadata.frames.length + ' frames · ' + sheet.width + '×' + sheet.height +
          ' sheet · ' + sheet.metadata.transparent + ' colors' + (warnings.length ? ' · ' + warnings.join(', ') : '');
        if (sheet.normal) state.textContent += ' · ' + normalCount.toLocaleString() + ' pixels with normals';
        show(0);
        buttons();
      } catch (error) {
        state.textContent = error.message;
      } finally {
        generate.disabled = false;
      }
    }, 0));
  }

  function save(name, blob) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.download = name;
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  for (const option of options) option.addEventListener('input', invalidate);
  mode.addEventListener('input', () => {
    get('turntable-light-row').hidden = mode.value !== 'toon';
    if (sheet) show(current);
  });
  light.addEventListener('input', () => { if (sheet) show(current); });
  generate.addEventListener('click', build);
  step.addEventListener('input', () => { stop(); show(Number(step.value)); });
  play.addEventListener('click', () => {
    if (timer !== undefined) return stop();
    play.textContent = 'Pause loop';
    play.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => show((current + 1) % sheet.metadata.frames.length), 1000 / sheet.metadata.fps);
  });
  get('turntable-pivot').addEventListener('input', event => {
    get('turntable-crosshair').hidden = !event.target.checked;
  });
  async function exportPNG(name, encode) {
    const snapshot = sheet;
    encoding = true;
    buttons();
    try {
      const png = await encode(snapshot);
      if (sheet === snapshot) save(name, png);
    } catch (error) {
      state.textContent = error.message;
    } finally {
      encoding = false;
      buttons();
    }
  }
  download.addEventListener('click', () => exportPNG('pelagic-turntable.png', encodeGaussianTurntablePNG));
  downloadNormals.addEventListener('click', () => exportPNG('pelagic-turntable-normal.png', encodeGaussianTurntableNormalPNG));
  metadata.addEventListener('click', () => save('pelagic-turntable.json', new Blob([
    JSON.stringify({ image: 'pelagic-turntable.png', ...(sheet.normal && { normalImage: 'pelagic-turntable-normal.png' }),
      ...sheet.metadata }, null, 2) + '\n'
  ], { type: 'application/json' })));
  return { invalidate };
}
