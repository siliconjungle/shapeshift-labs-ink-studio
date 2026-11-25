/* Pointer editing and graph evaluation for the Copper Tide demo. */
(() => {
  const I = KIT.procedural.graphImages, T = I.transfers;
  const source = tideImages(I), graph = KIT.procedural.graph.create(tideGraph(T));
  const get = id => document.getElementById(id);
  const chart = get('curve'), bar = get('pins'), reference = get('reference');
  const pad = 16, epsilon = .005;
  const bound = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const pixel = (x, y) => [pad + x * (chart.width - 2 * pad), chart.height - pad - y * (chart.height - 2 * pad)];
  const decimals = n => Number(n.toFixed(3));
  const pinHex = value => typeof value === 'string' ? value : '#' + value.slice(0, 3)
    .map(n => Math.round(bound(n) * 255).toString(16).padStart(2, '0')).join('');
  let curve = T.preset('soft-contrast').value, ramp = T.preset('copper-tide').value;
  let options = { path: structuredClone(tidePath), count: 7, filter: 'linear' };
  let curveIndex = 1, rampIndex = 1, nextPin = 1, rampDrag = false, curveDrag, pending = 0, latest;
  const state = () => ({ curve: structuredClone(curve), ramp: structuredClone(ramp), sampleOptions: options });

  function paint(canvas, {width, height, channels, data}) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, p = 0; i < data.length; i += channels, p += 4) {
      for (let c = 0; c < 3; c++) rgba[p + c] = data[i + c];
      rgba[p + 3] = channels === 4 ? data[i + 3] : 255;
    }
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  }

  function stroke(context, points, color, width = 1) {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
    context.stroke();
  }

  function handles() {
    if (curve.interpolation !== 'bezier') return [];
    const stop = curve.stops[curveIndex], result = [];
    if (curveIndex > 0) result.push({ side: 'in', xy: stop.in });
    if (curveIndex < curve.stops.length - 1) result.push({ side: 'out', xy: stop.out });
    return result;
  }

  function repairHandles() {
    for (let i = 1; i < curve.stops.length; i++) {
      const a = curve.stops[i - 1], b = curve.stops[i], span = b.at - a.at;
      a.out ??= [a.at + span / 3, a.value];
      b.in ??= [b.at - span / 3, b.value];
      a.out[0] = bound(a.out[0], a.at, b.at);
      b.in[0] = bound(b.in[0], a.out[0], b.at);
    }
  }

  function drawChart() {
    const context = chart.getContext('2d'), sample = ColorCurves.scalar(curve);
    context.clearRect(0, 0, chart.width, chart.height);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      stroke(context, [pixel(0, t), pixel(1, t)], '#314650');
      stroke(context, [pixel(t, 0), pixel(t, 1)], '#314650');
    }
    stroke(context, [pixel(0, 0), pixel(1, 1)], '#48616a');
    stroke(context, Array.from({length: 181}, (_, i) => {
      const t = i === 180 && curve.address === 'repeat' ? 1 - 1e-7 : i / 180;
      return pixel(t, sample(t));
    }), '#f1bd87', 2);
    const active = curve.stops[curveIndex];
    for (const {xy} of handles()) {
      const tip = pixel(...xy);
      stroke(context, [pixel(active.at, active.value), tip], '#76beb5');
      context.fillStyle = '#81ded3';
      context.fillRect(tip[0] - 3, tip[1] - 3, 6, 6);
    }
    for (const [i, point] of curve.stops.entries()) {
      context.fillStyle = i === curveIndex ? '#f5c18e' : '#d0ddda';
      context.beginPath();
      context.arc(...pixel(point.at, point.value), i === curveIndex ? 5 : 4, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawReference() {
    paint(reference, source.reference);
    const context = reference.getContext('2d');
    const path = options.path.map(([x, y]) => [x * reference.width, y * reference.height]);
    stroke(context, path, '#1b162b', 3);
    stroke(context, path, '#ffe3ad');
    context.fillStyle = '#ffe3ad';
    for (const [x, y] of path) context.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  function controls() {
    const active = curve.stops[curveIndex], pin = ramp.stops[rampIndex];
    const stop = get('curve-stop');
    if (Array.from(stop.options).map(o => o.value).join() !== curve.stops.map(row => row.id).join())
      stop.replaceChildren(...curve.stops.map(row => new Option(row.id, row.id)));
    stop.value = active.id;
    get('curve-input').value = decimals(active.at);
    get('curve-input').disabled = curveIndex === 0 || curveIndex === curve.stops.length - 1;
    get('curve-output').value = decimals(active.value);
    get('curve-mode').value = curve.interpolation ?? 'linear';
    get('curve-address').value = curve.address ?? 'clamp';
    get('ramp-mode').value = ramp.interpolation ?? 'linear';
    get('ramp-address').value = ramp.address ?? 'clamp';
    get('pin-position').value = decimals(pin.at);
    get('pin-position').disabled = rampIndex === 0 || rampIndex === ramp.stops.length - 1;
    get('pin-color').value = pinHex(pin.value);
    get('remove-pin').disabled = get('pin-position').disabled;
    get('add-pin').disabled = ramp.stops.length >= 256;
    while (bar.childElementCount > ramp.stops.length) bar.lastElementChild.remove();
    for (const [i, row] of ramp.stops.entries()) {
      const button = bar.children[i] ?? bar.appendChild(document.createElement('button'));
      button.className = 'pin';
      button.type = 'button';
      button.dataset.index = i;
      button.setAttribute('aria-label', 'Ramp pin ' + row.id);
      button.setAttribute('aria-pressed', i === rampIndex);
      button.style.left = (.1 + row.at * .8) * 100 + '%';
      button.style.background = pinHex(row.value);
    }
  }

  function render() {
    try {
      latest = graph.evaluate({ ...source, ...state() }).outputs;
      paint(get('picture'), latest.picture);
      paint(get('strip'), latest.swatches);
      drawChart();
      drawReference();
      controls();
      get('status').textContent = '';
    } catch (error) {
      get('status').textContent = error.message;
    }
  }

  function redraw() {
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); });
  }

  function relative(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }

  function moveCurve(x, y, side) {
    const current = curve.stops[curveIndex], prev = curve.stops[curveIndex - 1], next = curve.stops[curveIndex + 1];
    if (side === 'in') current.in = [bound(x, prev.out[0], current.at), bound(y)];
    else if (side === 'out') current.out = [bound(x, current.at, next.in[0]), bound(y)];
    else {
      if (prev && next) current.at = bound(x, prev.at + epsilon, next.at - epsilon);
      current.value = bound(y);
      repairHandles();
    }
    redraw();
  }

  function movePin(value) {
    const prev = ramp.stops[rampIndex - 1], next = ramp.stops[rampIndex + 1];
    if (prev && next) {
      ramp.stops[rampIndex].at = bound(value, prev.at + epsilon, next.at - epsilon);
      redraw();
    }
  }

  chart.addEventListener('pointerdown', event => {
    const [u, v] = relative(event, chart), x = u * chart.width, y = v * chart.height;
    const candidates = [
      ...handles().map(({side, xy}) => ({ i: curveIndex, side, xy })),
      ...curve.stops.map(({at, value}, i) => ({ i, xy: [at, value] }))
    ];
    let nearest, distance = 14;
    for (const candidate of candidates) {
      const [a, b] = pixel(...candidate.xy), delta = Math.hypot(x - a, y - b);
      if (delta < distance) { nearest = candidate; distance = delta; }
    }
    if (!nearest) return;
    chart.setPointerCapture(event.pointerId);
    curveIndex = nearest.i;
    curveDrag = nearest;
    redraw();
  });
  chart.addEventListener('pointermove', event => {
    if (!curveDrag) return;
    const [u, v] = relative(event, chart);
    moveCurve((u * chart.width - pad) / (chart.width - 2 * pad),
      (chart.height * (1 - v) - pad) / (chart.height - 2 * pad), curveDrag.side);
  });
  chart.addEventListener('lostpointercapture', () => { curveDrag = undefined; });
  bar.addEventListener('pointerdown', event => {
    if (!event.target.matches('.pin')) return;
    rampIndex = Number(event.target.dataset.index);
    rampDrag = true;
    bar.setPointerCapture(event.pointerId);
    redraw();
  });
  bar.addEventListener('pointermove', event => {
    if (rampDrag) movePin((relative(event, bar)[0] - .1) / .8);
  });
  bar.addEventListener('lostpointercapture', () => { rampDrag = false; });
  bar.addEventListener('click', event => {
    if (!event.target.matches('.pin')) return;
    rampIndex = Number(event.target.dataset.index);
    redraw();
  });

  function change(id, action) {
    get(id).addEventListener('change', event => { action(event.currentTarget.value); redraw(); });
  }
  change('curve-preset', id => { curve = T.preset(id).value; curveIndex = Math.min(1, curve.stops.length - 1); repairHandles(); });
  change('ramp-preset', id => { ramp = T.preset(id).value; rampIndex = 1; });
  change('curve-mode', mode => { curve.interpolation = mode; repairHandles(); });
  change('curve-address', address => { curve.address = address; });
  change('curve-stop', id => { curveIndex = curve.stops.findIndex(row => row.id === id); });
  change('curve-input', x => moveCurve(Number(x), curve.stops[curveIndex].value));
  change('curve-output', y => moveCurve(curve.stops[curveIndex].at, Number(y)));
  change('ramp-mode', mode => { ramp.interpolation = mode; });
  change('ramp-address', address => { ramp.address = address; });
  change('pin-position', position => movePin(Number(position)));
  change('pin-color', color => {
    const stop = ramp.stops[rampIndex];
    stop.value = [...ColorCurves.color(color), typeof stop.value === 'string' ? 1 : stop.value[3] ?? 1];
  });
  get('add-pin').addEventListener('click', () => {
    const stops = ramp.stops;
    const i = stops.slice(1).reduce((best, stop, i) =>
      stop.at - stops[i].at > stops[best + 1].at - stops[best].at ? i : best, 0);
    if (stops[i + 1].at - stops[i].at < 2 * epsilon) return;
    const at = (stops[i].at + stops[i + 1].at) / 2;
    const value = T.ramp(ramp).sample(at);
    stops.splice(i + 1, 0, { id: 'pin-' + nextPin++, at, value });
    rampIndex = i + 1;
    redraw();
  });
  get('remove-pin').addEventListener('click', () => {
    ramp.stops.splice(rampIndex, 1);
    rampIndex--;
    redraw();
  });
  change('sample-count', count => { options = { ...options, count: bound(Math.round(Number(count)), 2, 24) }; });
  reference.addEventListener('pointerdown', event => {
    const middle = relative(event, reference).map(value => bound(value));
    if (options.path[0].every((n, i) => n === middle[i]) || options.path[2].every((n, i) => n === middle[i])) return;
    options = { ...options, path: [options.path[0], middle, options.path[2]] };
    redraw();
  });
  get('extract').addEventListener('click', () => {
    render();
    if (get('status').textContent) return;
    ramp = structuredClone(latest.sampled);
    rampIndex = 1;
    get('ramp-preset').value = 'sampled';
    redraw();
  });
  get('save').addEventListener('click', () => {
    const document = tideDefaults(tideGraph(T), source);
    for (const [name, value] of Object.entries(state())) document.inputs[name].default = value;
    const url = URL.createObjectURL(new Blob([JSON.stringify(document)], {type:'application/json'}));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'copper-tide-edited.graph.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  });
  repairHandles();
  render();
})();
