/* Enamel and hammered brass, painted directly on the source texel grid. */
const transitSize = 160;
const transitModes = {
  perspective: 'Perspective pin', transform: 'Affine transform', crop: 'Crop',
  symmetry: 'Symmetry', toPolar: 'Unwrap to polar', fromPolar: 'Wrap to Cartesian'
};
const transitCanvas = [232, 174];

function transitPlate() {
  const size = transitSize, data = new Uint8Array(size * size * 4);
  const palette = [
    [20, 24, 41], [33, 38, 64], [47, 53, 84], [68, 80, 109],
    [102, 47, 77], [156, 62, 93], [207, 92, 111], [242, 143, 126],
    [123, 77, 56], [192, 127, 77], [232, 174, 103], [252, 212, 144],
    [30, 74, 85], [41, 117, 123], [75, 159, 151], [143, 206, 175]
  ];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + .5 - size / 2, dy = y + .5 - size / 2, ax = Math.abs(dx), ay = Math.abs(dy);
    const outer = Math.min(x, y, size - 1 - x, size - 1 - y);
    const along = ax > ay ? y : x;
    const salt = (Math.imul(x + 11, 1181) ^ Math.imul(y + 23, 7537)) >>> 0;
    const grout = ((x + y) & 3) === 0, fine = (salt % 67) < 3;
    const diamond = ax + ay, octagon = Math.max(ax, ay, diamond * .69);
    let ink = (x & 7) === 0 || (y & 7) === 0 ? 0 : grout ? 2 : fine ? 3 : 1;
    if (outer >= 4 && outer <= 17) {
      const braid = (along % 12) + Math.abs(outer - 10) * 1.55;
      ink = outer === 4 || outer === 17 ? 8 : outer === 5 || outer === 16 ? 10 :
        braid > 7 && braid < 13 ? (grout ? 9 : 10) : (grout ? 14 : 12);
      if (Math.min(ax, ay) > 60) ink = (diamond % 7) < 2 ? 8 : 10;
    }
    if (outer === 21 || outer === 23) ink = outer === 21 ? 9 : 3;
    if (outer > 25 && Math.min(ax, ay) > 38) {
      const bud = Math.abs(ax - 47) + Math.abs(ay - 47);
      if (bud <= 7) ink = bud <= 2 ? 11 : bud < 5 ? 13 : 0;
    }
    if (octagon < 53) ink = octagon < 51 ? 0 : 9;
    if (octagon < 49) ink = octagon < 47 ? 12 : (grout ? 10 : 11);
    if (octagon < 45) {
      const facet = Math.max(ax, ay), stem = Math.min(ax, ay);
      const petal = facet > 11 && stem > 1 && Math.abs(stem + facet * .34 - 16) < 7 + facet * .06;
      ink = (grout ? 13 : 12);
      if (petal) ink = stem + facet * .34 < 17 ? (grout ? 14 : 15) : (fine ? 15 : 13);
      if (facet > 21 && Math.abs(stem - 20) + Math.abs(facet - 29) < 9) ink = grout ? 4 : 5;
      if (Math.abs(ax - 27) + Math.abs(ay - 27) < 4) ink = fine ? 7 : 6;
    }
    if (diamond < 34) ink = diamond > 31 ? 0 : diamond > 28 ? 10 : diamond > 25 ? 8 : (grout ? 5 : 4);
    if (Math.min(ax, ay) < 3 && Math.max(ax, ay) < 23) ink = 10;
    if (diamond < 14) ink = diamond > 10 ? 6 : diamond > 8 ? 7 : diamond > 4 ? 11 : 0;
    if (dx < -43 && dx > -50 && dy < -29 && dy > -41 && (ax + ay) % 4 < 3) ink = 7;
    if (outer < 3) ink = outer === 1 && (along & 1) === 0 ? 9 : 8;
    data.set(palette[ink], (y * size + x) * 4);
    data[(y * size + x) * 4 + 3] = 255;
  }
  return { width: size, height: size, channels: 4, data };
}

function transitOptions(mode, { position = .65, filter = 'linear', mip = 'linear',
  u = 'wrap', v = 'clamp' } = {}) {
  const [width, height] = transitCanvas, border = { u, v }, extent = { width, height };
  const shift = position - .65;
  const halfTop = .105 + shift * .115, center = .49 + shift * .1;
  const geometry = {
    perspective: { ...extent, corners: [[center - halfTop, .095], [center + halfTop, .065],
      [.94, .829 - shift * .059], [.077, .933 + shift * .04]] },
    transform: { ...extent, units: 'normalized', rotation: 27 + shift * 120, scale: [.68, .66],
      matrix: [[1, .12, 0], [0, 1, 0]], pivot: [.42, .49], offset: [-.08, .13] },
    crop: { width: 188, height: 174, units: 'normalized', rect: [-.13 + shift * .53, .11, .69, .64] },
    symmetry: { width: 174, height: 174, axis: 'x', side: 'low', pivot: [.38 + shift * .5, .5] },
    toPolar: { ...extent, mode: 'toPolar', radius: .69, rotation: shift * 360 },
    fromPolar: { width: 174, height: 174, mode: 'fromPolar', radius: .46, rotation: shift * 360 }
  }[mode];
  const options = { ...geometry, filter, border };
  return { base: { ...options, mip: 'none' }, filtered: { ...options, mip } };
}

function transitGraph(modes = Object.keys(transitModes)) {
  const link = node => ({ node, port: 'value' });
  const graph = {
    format: 'ink-studio/graph-project', version: 1,
    inputs: { plate: 'raster' },
    nodes: {
      enamel: { op: 'image.declare', inputs: { source: { input: 'plate' },
        descriptor: { intent: 'color', precision: 'unorm8', tiling: { u: 'wrap', v: 'clamp' } } } },
      source: { op: 'image.toDisplay', inputs: { source: link('enamel') } }
    },
    outputs: { source: link('source') },
    exports: {}
  };
  for (const mode of modes) {
    for (const [variant, value] of Object.entries(transitOptions(mode))) {
      const settings = mode + (variant === 'base' ? 'Base' : 'Filtered');
      graph.inputs[settings] = { type: 'record', default: value };
      graph.nodes[settings] = { op: 'image.' + (mode.endsWith('Polar') ? 'polar' : mode),
        inputs: { source: link('enamel'), options: { input: settings } } };
      const preview = settings + 'Preview';
      graph.nodes[preview] = { op: 'image.toDisplay', inputs: { source: link(settings) } };
      graph.outputs[settings] = link(preview);
    }
  }
  if (modes.includes('perspective')) {
    graph.exports.levelZero = { output: 'perspectiveBase', format: 'png' };
    graph.exports.autoMip = { output: 'perspectiveFiltered', format: 'png' };
  }
  return graph;
}

if (typeof module !== 'undefined') module.exports = { transitPlate, transitOptions, transitGraph, transitModes };
