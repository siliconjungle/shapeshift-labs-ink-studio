/* Native painted seeds and a graph shared by the Seam Garden preview and CLI. */
const gardenWidth = 112, gardenHeight = 72;
const gardenOps = {
  distance: 'Nearest distance', signed: 'Signed distance', propagated: 'Source propagation',
  dilation: 'Dilation', erosion: 'Erosion', outline: 'Outline', edge: 'Edge detection'
};
const gardenProbe = [0, 62];

function gardenImages() {
  const width = gardenWidth, height = gardenHeight;
  const paint = new Uint8Array(width * height * 4), mask = new Uint8Array(width * height);
  const offset = (value, length) => value - Math.round(value / length) * length;
  const leaves = [
    [1, 19, 12, 4.5, -.64, false], [16, 34, 8, 4, .7, false], [32, 21, 10, 4, -.52, true],
    [56, 31, 14, 5, .56, false], [74, 44, 11, 4.5, -.51, true], [93, 29, 10, 4, .57, false],
    [103, 55, 8, 3.4, -.41, false], [36, 1, 11, 4.8, -.60, true], [81, 69, 12, 4.4, .49, false]
  ].map(([x, y, rx, ry, angle, gold]) => ({ x, y, rx, ry, c: Math.cos(angle), s: Math.sin(angle), gold }));
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    let color = [0, 0, 0];
    const stem = 33 + 6 * Math.sin(2 * Math.PI * (x + 12) / width) + 2 * Math.sin(4 * Math.PI * x / width);
    if (Math.abs(y - stem) < .95 && (x < 96 || x > 105)) color = [86, 143, 123];
    for (const leaf of leaves) {
      const dx = offset(x - leaf.x, width), dy = offset(y - leaf.y, height);
      const along = dx * leaf.c + dy * leaf.s, widthwise = -dx * leaf.s + dy * leaf.c;
      const d = (along / leaf.rx) ** 2 + (widthwise / leaf.ry) ** 2;
      if (d > 1) continue;
      const lit = widthwise < -.4 || Math.abs(widthwise) < .55 && along < 3;
      color = leaf.gold ? lit ? [222, 173, 103] : [169, 114, 67] : lit ? [122, 201, 167] : [67, 142, 126];
    }
    const berry = Math.min(Math.hypot(offset(x - 108, width), offset(y - 9, height)),
      Math.hypot(x - 51, y - 58), Math.hypot(x - 88, y - 13));
    if (berry < 2.4) color = berry < 1.3 ? [245, 159, 120] : [191, 96, 81];
    const hasPaint = Number(color.some(Boolean));
    paint.set([...color, hasPaint * 255], i * 4);
    mask[i] = hasPaint * 255;
  }
  return { paint: { width, height, channels: 4, data: paint }, mask: { width, height, channels: 1, data: mask } };
}

function gardenOptions({ border = 'wrap', units = 'pixels', radius = 3 } = {}) {
  const scale = units === 'normalized' ? gardenHeight : 1;
  return {
    distanceSettings: { border, units },
    morphSettings: { border, units, radius: radius / scale },
    outlineSettings: { border, units, inner: radius / scale, outer: (radius + 1) / scale, feather: 1.3 / scale },
    edgeSettings: { border, method: 'scharr', threshold: .12, softness: .22 },
    distanceRange: { range: [0, 20 / scale] }, signedRange: { range: [-6 / scale, 19 / scale] }
  };
}

function gardenGraph() {
  const op = (op, inputs) => ({ op, inputs });
  const link = (node, port = 'value') => ({ node, port });
  const input = input => ({ input });
  const tape = { stops: [[0, '#d3b57c'], [.035, '#709e85'], [.18, '#386d66'], [.51, '#254b53'], [1, '#1b283b']] };
  const signedRamp = { stops: [[0, '#db9c66'], [.17, '#a47b52'], [.24, '#e7d19d'], [.31, '#83b49a'],
    [.53, '#386966'], [1, '#1b283b']] };
  const stamp = { stops: [[0, '#1b2b36'], [1, '#98d4ac']] };
  const graph = {
    format: 'ink-studio/graph-project', version: 1,
    inputs: { paint: 'raster', mask: 'raster',
      ...Object.fromEntries(Object.entries(gardenOptions()).map(([key, value]) => [key, { type: 'record', default: value }])) },
    nodes: {
      plate: op('image.declare', { source: input('paint'), descriptor: { intent: 'color', precision: 'unorm8' } }),
      seeds: op('image.declare', { source: input('mask'), descriptor: { intent: 'mask', precision: 'unorm8' } }),
      distance: op('image.distance', { source: link('seeds'), options: input('distanceSettings') }),
      signed: op('image.signedDistance', { source: link('seeds'), options: input('distanceSettings') }),
      propagated: op('image.propagate', { source: link('plate'), nearest: link('distance', 'nearest') }),
      dilation: op('image.dilate', { source: link('seeds'), options: input('morphSettings') }),
      erosion: op('image.erode', { source: link('seeds'), options: input('morphSettings') }),
      outline: op('image.outline', { source: link('seeds'), options: input('outlineSettings') }),
      edge: op('image.edgeDetect', { source: link('seeds'), options: input('edgeSettings') }),
      seedPreview: op('image.toDisplay', { source: link('plate') })
    },
    outputs: {
      seedPreview: link('seedPreview'), nearest: link('distance', 'nearest'),
      distanceField: link('distance'), signedField: link('signed')
    },
    exports: {
      tile: { output: 'distance', format: 'png' }, signed: { output: 'signedField', format: 'json' },
      owners: { output: 'nearest', format: 'json' }
    }
  };
  for (const name of Object.keys(gardenOps)) {
    let source = link(name);
    if (name !== 'propagated') {
      const mapped = name + 'Map';
      const override = name === 'distance' ? { options: input('distanceRange') } :
        name === 'signed' ? { options: input('signedRange') } : {};
      graph.nodes[mapped] = op('image.gradientMap', { source, ramp: name === 'distance' ? tape :
        name === 'signed' ? signedRamp : stamp, ...override });
      source = link(mapped);
    }
    graph.nodes[name + 'Display'] = op('image.toDisplay', { source });
    graph.outputs[name] = link(name + 'Display');
  }
  return graph;
}

if (typeof module !== 'undefined') module.exports = { gardenImages, gardenOptions, gardenGraph, gardenProbe };
