/* Native pigment, ripple heights and a periodic flow field share the same tile coordinates. */
const tidalWidth = 128, tidalHeight = 84;
const tidalModes = {
  vectorWarp: 'Vector', directionalWarp: 'Directional', nonuniformWarp: 'Nonuniform',
  slopeWarp: 'Slope', multiDirectionalWarp: 'Multidirectional'
};
const tidalControl = { amount: 15, smooth: 2, angle: 24, axes: 2, combine: 'chain',
  u: 'wrap', v: 'wrap', driver: 'inherit', filter: 'nearest', masked: true };

function tidalSources() {
  const width = tidalWidth, height = tidalHeight, count = width * height;
  const paint = new Uint8Array(count * 4), flow = new Float64Array(count * 2);
  const distance = new Float64Array(count), direction = new Float64Array(count);
  const lift = new Float64Array(count), intensity = new Float64Array(count);
  const tau = Math.PI * 2, sin = n => Math.sin(tau * n), cos = n => Math.cos(tau * n);
  const delta = (x, center, period) => x - center - period * Math.round((x - center) / period);
  const frac = n => n - Math.floor(n);
  const colors = {
    deep: [20, 43, 58], ink: [18, 37, 50], teal: [34, 77, 86], shade: [29, 61, 74], lap: [41, 97, 103],
    mint: [85, 158, 143], foam: [151, 195, 160], stem: [45, 111, 100], pad: [59, 127, 108],
    rust: [150, 65, 60], red: [195, 93, 69], salmon: [228, 124, 79], gold: [241, 173, 101],
    light: [249, 201, 126], cream: [250, 224, 169], plum: [108, 53, 60], purple: [142, 86, 95]
  };
  const fish = [
    { x: 99, y: 30, heading: -.64, scale: 1.0, cream: false },
    { x: 38, y: 62, heading: 2.57, scale: .83, cream: true }
  ].map(f => ({ ...f, c: Math.cos(f.heading), s: Math.sin(f.heading) }));
  const pads = [[18, 22, 8, .5], [11, 35, 4.5, -1], [115, 70, 6, 2], [2, 6, 6, .2], [65, 5, 4, 1]];
  const sparks = [[35, 15], [58, 27], [51, 37], [76, 65], [81, 71], [95, 63], [4, 51], [121, 49], [65, 81]];

  function koi(x, y, fish, fleck) {
    const dx = delta(x, fish.x, width), dy = delta(y, fish.y, height);
    const along = (dx * fish.c + dy * fish.s) / fish.scale;
    const across = (-dx * fish.s + dy * fish.c) / fish.scale;
    if (Math.abs(along) > 32 || Math.abs(across) > 19) return null;
    const bend = .012 * (along + 1) ** 2 - 2.5;
    const v = across - bend;
    const core = Math.sqrt(Math.max(0, 1 - ((along - 1) / 20) ** 2)) * (5.4 + .11 * (along + 8));
    const belly = v > 0, w = Math.abs(v);
    const rear = along < -13 && along > -30 && Math.abs(w - (-along - 13) * .33) <=
      Math.max(0, 3.1 - .021 * (along + 22) ** 2);
    const fin = along > -10 && along < 7 && Math.abs(w - 7.5) < Math.max(0, 4 - Math.abs(along + 2) * .52);
    if ((along < -19 || along > 21 || w > core + .45) && !rear && !fin) return null;
    if (w > core || along < -18) {
      if (!rear && !fin) return 'ink';
      if (Math.floor(w * 1.6 + along * .7) % 4 === 0) return fish.cream ? 'purple' : 'rust';
      return fish.cream ? 'light' : 'salmon';
    }
    let ink = fish.cream ? (belly ? 'gold' : 'cream') : (belly ? 'red' : 'gold');
    const marking = Math.sin(along * .23 + v * .32) + Math.cos(along * .38 - v * .3);
    if (marking > .61 && along < 13) ink = fish.cream ? (belly ? 'plum' : 'red') : (belly ? 'rust' : 'salmon');
    if (w > core - .8 && belly) ink = fish.cream ? 'rust' : 'plum';
    if (!belly && w > core - 1.5 && along > -13 && along < 16) ink = 'light';
    if (along > 12 && Math.abs(v - (belly ? 3.2 : -3.2)) < 1.1 && along < 15.2) ink = 'ink';
    if (along > 17.5 && along < 19.5 && w < .72) ink = 'plum';
    if (along > -10 && along < 9 && w < core - 1 && fleck) ink = fish.cream ? 'light' : 'cream';
    return ink;
  }

  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    const fleck = ((Math.imul(x + 3, 1307) ^ Math.imul(y + 7, 3583)) >>> 0) % 101 < 3;
    const lane = 5 * v + .27 * sin(u * 2 + v) + .17 * sin(u - 2 * v);
    const iso = frac(lane), cut = Math.min(iso, 1 - iso);
    const glimmer = cos(u * 3 - v) + .58 * sin(2 * v + 2 * u);
    let ink = cos(2 * u - v) > .15 ? 'deep' : 'shade';
    if (cut < .055) ink = glimmer > .59 ? 'mint' : 'lap';
    else if (cut < .11) ink = 'teal';
    if (iso > .36 && iso < .398 && glimmer > .8) ink = 'lap';
    if (fleck && glimmer > -.3) ink = 'lap';

    for (const [px, py, radius, angle] of pads) {
      const dx = delta(x, px, width), dy = delta(y, py, height) * 1.29, size = Math.hypot(dx, dy);
      const slit = Math.cos(Math.atan2(dy, dx) - angle) > .86;
      if (size < radius + 1.25) ink = 'ink';
      if (size < radius && (!slit || size < radius * .18))
        ink = (dx + dy < 0) ? size > radius - 1 ? 'mint' : 'pad' : 'stem';
      if (size < radius + 2.9 && size > radius + 1.9 && dx + dy < -radius * .4) ink = 'mint';
    }
    for (const [sx, sy] of sparks) {
      const dx = Math.abs(delta(x, sx, width)), dy = Math.abs(delta(y, sy, height));
      if (dx + dy < 3) ink = dx + dy < 1.7 ? 'foam' : 'lap';
    }
    for (const swimmer of fish) ink = koi(x, y, swimmer, fleck) ?? ink;
    paint.set(colors[ink], i * 4);
    paint[i * 4 + 3] = 255;

    const phase = v + .22 * sin(u);
    flow[i * 2] = .53 * sin(phase) + .27 * sin(2 * v - u);
    flow[i * 2 + 1] = .58 * cos(u - .18 * sin(2 * v)) - .13 * sin(u + v);
    distance[i] = .49 + .29 * sin(u + v + .15 * sin(2 * v)) + .15 * sin(3 * u - v);
    direction[i] = frac(Math.atan2(flow[i * 2 + 1], flow[i * 2]) / tau + .96);
    lift[i] = 7 * sin(2 * v + .24 * sin(u)) + 5 * cos(u - v) + 1.8 * sin(4 * u + 3 * v);
    intensity[i] = .21 + .79 * (.5 + .5 * cos(u - v - .25)) ** 1.5;
  }
  const raster = (data, channels = 1) => ({ width, height, channels, data });
  return { paint: raster(paint, 4), flow: raster(flow, 2), distance: raster(distance), direction: raster(direction),
    lift: raster(lift), intensity: raster(intensity) };
}

function tidalOptions(mode, settings = {}) {
  const { amount, smooth, angle, axes, combine, u, v, driver, filter } = { ...tidalControl, ...settings };
  const opts = { amount, smooth, border: { u, v }, mapBorder: driver === 'inherit' ? { u, v } : driver, filter };
  if (mode === 'directionalWarp' || mode === 'nonuniformWarp' || mode === 'multiDirectionalWarp') opts.angle = angle;
  if (mode === 'multiDirectionalWarp') Object.assign(opts, { axes, combine });
  return opts;
}

function tidalGraph(modes = Object.keys(tidalModes)) {
  const link = node => ({ node, port: 'value' }), input = input => ({ input });
  const op = (op, inputs) => ({ op, inputs }), tiling = { u: 'wrap', v: 'wrap' };
  const graph = { format: 'ink-studio/graph-project', version: 1, inputs: {},
    nodes: {}, outputs: {}, exports: {} };
  const maps = { paint: { intent: 'color', precision: 'unorm8' }, flow: { intent: 'data', layout: 'rg' },
    distance: { intent: 'mask' }, direction: { intent: 'data' }, lift: { intent: 'height', units: 'art-px' },
    intensity: { intent: 'mask' } };
  for (const [name, descriptor] of Object.entries(maps)) {
    graph.inputs[name] = 'raster';
    graph.nodes[name + 'Map'] = op('image.declare', { source: input(name), descriptor: { ...descriptor, tiling } });
  }
  graph.inputs.maskGain = { type: 'number', default: 1 };
  graph.nodes.fullIntensity = op('image.uniform', {
    value: 1, width: tidalWidth, height: tidalHeight, descriptor: { intent: 'mask', tiling }
  });
  graph.nodes.activeIntensity = op('image.blend', {
    background: link('fullIntensity'), foreground: link('intensityMap'), opacity: input('maskGain')
  });
  graph.nodes.original = op('image.toDisplay', { source: link('paintMap') });
  graph.nodes.maskColor = op('image.gradientMap', { source: link('intensityMap'), ramp:
    { stops: [[0, '#172a42'], [.51, '#376b74'], [1, '#f4bd7c']] } });
  graph.nodes.maskPreview = op('image.toDisplay', { source: link('maskColor') });
  graph.outputs.original = link('original');
  graph.outputs.mask = link('maskPreview');
  for (const mode of modes) {
    const driver = mode === 'vectorWarp' ? 'flow' : mode === 'slopeWarp' ? 'lift' : 'distance';
    const name = mode + 'Options';
    graph.inputs[name] = { type: 'record', default: tidalOptions(mode) };
    graph.nodes[mode] = op('image.' + mode, { source: link('paintMap'), map: link(driver + 'Map'),
      intensity: link('activeIntensity'), options: input(name),
      ...(mode === 'nonuniformWarp' && { direction: link('directionMap') }) });
    graph.nodes[mode + 'Preview'] = op('image.toDisplay', { source: link(mode) });
    graph.outputs[mode] = link(mode + 'Preview');
    graph.exports[mode] = { output: mode, format: 'png' };
  }
  return graph;
}
if (typeof module !== 'undefined') module.exports = { tidalSources, tidalOptions, tidalGraph, tidalModes };
