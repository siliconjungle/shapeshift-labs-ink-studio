/* Native tonal art, a reference plate and the shared Copper Tide graph. */
const tideWidth = 160, tideHeight = 96;
const tidePath = [[.18, .46], [.51, .24], [.83, .72]];

function tideImages(images) {
  const width = tideWidth, height = tideHeight, data = new Float32Array(width * height);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const grain = (Math.imul(x + 9, 5347) ^ Math.imul(y + 13, 19531)) & 63;
    const horizon = 49, water = y >= horizon;
    const moon = Math.hypot(x - 94, y - 26);
    const farRidge = Math.min(46, 37 + Math.abs(x - 27) * .23 - Math.sin(x * .23) * 2,
      42 + Math.abs(x - 132) * .19 - Math.sin(x * .31) * 2);
    const cliffs = x < 48 && y > Math.floor(26 + x * .89 + Math.sin(x * .27) * 4) ||
      x > 122 && y > Math.floor(77 - (x - 122) * .8 + Math.sin(x * .25) * 3);
    let tone = water ? .31 + Math.floor((y - horizon) / 7) * -.024 : .38 + Math.floor(y / 7) * .019;
    if (!water && moon < 31) tone += moon < 16 ? .05 : .025;
    if (!water && moon <= 12) tone = y < 27 ? .96 : .86;
    if (!water && y >= 16 && y <= 37 && (y + (x >> 3) * 7) % 23 === 4 && moon > 17) tone += .055;
    if (!water && grain === 2 && y < 32 && moon > 14) tone = .64;
    if (y >= farRidge && y < horizon) tone = y - farRidge < 1 ? .52 : .36 - (y - farRidge) * .004;
    if (water) {
      const shimmer = (Math.floor(x / (y < 65 ? 4 : 6)) + y * 11) % 37;
      const dx = Math.abs(x - 94);
      if (y % 3 === 1 && shimmer < 5) tone += .11;
      if (y % 4 === 2 && dx < 6 + (y - horizon) * .58 && shimmer < 24) tone = .78 - (y - horizon) * .009;
      if (y === 49 || y === 50 && shimmer < 20) tone = .58;
    }
    if (cliffs) {
      tone = .09 + Math.max(0, .105 - Math.max(0, y - (x < 48 ? 27 + x * .84 : 75 - (x - 122) * .8)) * .014);
      if (grain < 8 && y % 7 < 2) tone += .07;
    }
    data[i] = tone;
  }
  const tone = { width, height, channels: 1, data };
  const reference = images.toDisplay(images.transfers.gradientMap(images.declare(tone, { intent: 'data' }), {
    stops: [[0, '#201a35'], [.24, '#515183'], [.50, '#a06588'], [.72, '#e39887'], [1, '#fff1bf']]
  }));
  return { tone, reference };
}

function tideGraph(transfers) {
  const op = (op, inputs) => ({ op, inputs });
  const link = node => ({ node });
  const input = input => ({ input });
  return {
    format: 'ink-studio/graph-project', version: 1,
    inputs: {
      tone: 'raster', reference: 'raster',
      curve: { type: 'record', default: transfers.preset('soft-contrast').value },
      ramp: { type: 'record', default: transfers.preset('copper-tide').value },
      sampleOptions: { type: 'record', default: { path: tidePath, count: 7, filter: 'linear' } }
    },
    nodes: {
      tone: op('image.declare', { source: input('tone'), descriptor: { intent: 'data', precision: 'float32' } }),
      reference: op('image.declare', { source: input('reference'), descriptor: { intent: 'color', precision: 'unorm8' } }),
      curve: op('image.curve', { source: link('tone'), curve: input('curve') }),
      painted: op('image.gradientMap', { source: link('curve'), ramp: input('ramp') }),
      strip: op('image.gradient', { ramp: input('ramp'), width: 320, height: 10, options: { from: [.1, .5], to: [.9, .5] } }),
      sampled: op('image.gradientFromImage', { source: link('reference'), options: input('sampleOptions') }),
      picture: op('image.toDisplay', { source: link('painted') }),
      swatches: op('image.toDisplay', { source: link('strip') })
    },
    outputs: { picture: link('picture'), swatches: link('swatches'), sampled: link('sampled'), graded: link('curve') },
    exports: { picture: { output: 'picture', format: 'png' }, sampled: { output: 'sampled', format: 'json' } }
  };
}

function tideDefaults(graph, inputs) {
  for (const [name, raster] of Object.entries(inputs))
    graph.inputs[name] = { type: 'raster', default: { ...raster, data: Array.from(raster.data) } };
  return graph;
}

if (typeof module !== 'undefined') module.exports = { tideImages, tideGraph, tideDefaults };
