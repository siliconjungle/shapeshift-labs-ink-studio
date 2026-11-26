(() => {
  const entry = name => document.getElementById(name);
  const status = entry('status');
  const P = KIT.procedural, I = P.graphImages;
  const bitmapTypes = { unorm8: Uint8Array, unorm16: Uint16Array, float32: Float32Array, float64: Float64Array };
  const canvas = entry('surface'), ctx = canvas.getContext('2d');
  const { size } = demo;
  canvas.width = canvas.height = size;
  const zero = new Uint8Array(size * size);
  const mask = data => I.declare({ width: size, height: size, channels: 1, data }, { intent: 'mask' });
  const blank = mask(zero), controls = {}, fields = {};
  for (const [key, { width, height, channels, descriptor, bytes }] of Object.entries(demo.packed)) {
    const buffer = Uint8Array.from(atob(bytes), c => c.charCodeAt(0)).buffer;
    const data = new bitmapTypes[descriptor.precision](buffer);
    controls['bake-' + key.slice(0, -3)] = I.declare({ width, height, channels, data }, descriptor);
  }
  for (const name of demo.names) {
    controls[name + 'Paint'] = blank;
    controls[name + 'Protect'] = blank;
    fields[name] = { Paint: zero, Protect: zero };
  }
  const runtime = P.graph.create(demo.browser);
  const views = document.querySelectorAll('[data-view]'), recipes = entry('recipe');
  const state = { view: 'surface', bare: false, recipe: 'rust', level: demo.defaults.waterline.level };
  let outputs, frame = 0, dirty = true, pointer = null;
  entry('bake-review').href = demo.bakeReview;
  for (const name of demo.names) {
    const option = new Option(demo.titles[name], name, false, name === state.recipe);
    recipes.add(option);
  }

  function draw() {
    frame = 0;
    if (dirty) {
      outputs = runtime.evaluate(controls).outputs;
      dirty = false;
    }
    ctx.putImageData(LockNine.render(outputs, state), 0, 0);
    const report = outputs[state.recipe + 'Info'], title = demo.titles[state.recipe];
    entry('ingredients').textContent = report.ingredients;
    entry('input-maps').textContent = report.inputs.join(' · ');
    entry('tide-value').textContent = state.level.toFixed(2);
    entry('amount-value').textContent = (controls[state.recipe + 'Options']?.amount ?? 1).toFixed(2);
    const label = { surface: state.bare ? 'Bare cast iron' : 'Weathered cast iron', '': 'Corrected mask', Raw: 'Generated mask',
      Evidence: 'Bake evidence' };
    status.textContent = label[state.view] + ' · ' + title + ' selects ' +
      Math.round(100 * report.affected / report.covered) + '% of covered texels';
  }

  function request(evaluate = false) {
    dirty ||= evaluate;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  for (const button of views) button.addEventListener('click', () => {
    state.view = button.dataset.view;
    for (const item of views) item.setAttribute('aria-pressed', String(item === button));
    request();
  });
  recipes.addEventListener('change', () => {
    state.recipe = recipes.value;
    entry('amount').value = controls[state.recipe + 'Options']?.amount ?? 1;
    request();
  });
  entry('bare').addEventListener('input', () => { state.bare = entry('bare').checked; request(); });
  entry('tide').addEventListener('input', () => {
    state.level = Number(entry('tide').value);
    controls.waterlineOptions = { ...(controls.waterlineOptions ?? demo.defaults.waterline), level: state.level };
    request(true);
  });
  entry('amount').addEventListener('input', () => {
    const key = state.recipe + 'Options';
    controls[key] = { ...(controls[key] ?? demo.defaults[state.recipe]), amount: Number(entry('amount').value) };
    request(true);
  });
  entry('brush').addEventListener('change', () => {
    const mode = entry('brush').value;
    canvas.dataset.brush = mode;
    entry('save-paint').disabled = !mode;
  });

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * size / rect.width, (event.clientY - rect.top) * size / rect.height];
  }

  function paint(mode, start, end) {
    const [x, y] = start, dx = end[0] - x, dy = end[1] - y;
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    const data = fields[state.recipe][mode].slice();
    const radius = 6;
    for (let step = 0; step <= count; step++) {
      const u = x + dx * step / count, v = y + dy * step / count;
      for (let row = Math.max(0, Math.floor(v - radius)); row <= Math.min(size - 1, Math.ceil(v + radius)); row++)
        for (let col = Math.max(0, Math.floor(u - radius)); col <= Math.min(size - 1, Math.ceil(u + radius)); col++) {
          const i = row * size + col;
          const coverage = Math.max(0, Math.min(1, (radius - Math.hypot(col + .5 - u, row + .5 - v)) / 2));
          data[i] = Math.max(data[i], Math.round(coverage * 255));
        }
    }
    fields[state.recipe][mode] = data;
    controls[state.recipe + mode] = mask(data);
    request(true);
  }

  canvas.addEventListener('pointerdown', event => {
    const mode = entry('brush').value;
    if (!mode) return;
    pointer = point(event);
    canvas.setPointerCapture(event.pointerId);
    paint(mode, pointer, pointer);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer) return;
    const end = point(event), mode = entry('brush').value;
    if (mode) paint(mode, pointer, end);
    pointer = end;
  });
  canvas.addEventListener('lostpointercapture', () => { pointer = null; });
  entry('clear-paint').addEventListener('click', () => {
    for (const mode of ['Paint', 'Protect']) {
      fields[state.recipe][mode] = zero;
      controls[state.recipe + mode] = blank;
    }
    request(true);
  });
  entry('save-paint').addEventListener('click', () => {
    const mode = entry('brush').value;
    if (!mode) return;
    const data = fields[state.recipe][mode], png = document.createElement('canvas');
    png.width = png.height = size;
    const pixels = new ImageData(size, size);
    for (let p = 0; p < data.length; p++) pixels.data.set([data[p], data[p], data[p], 255], p * 4);
    png.getContext('2d').putImageData(pixels, 0, 0);
    const link = document.createElement('a');
    link.href = png.toDataURL();
    link.download = state.recipe + '-' + mode.toLowerCase() + '.png';
    link.click();
  });
  draw();
})();
