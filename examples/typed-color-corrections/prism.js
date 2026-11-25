/* One editable native plate for the Prism Study demo. */
const prismWidth = 144, prismHeight = 96;
const sourceSwatch = '#a86c40';
const paintPresets = {
  levels: { label: 'Levels', settings: { inputRange: [.09, .81], gamma: 1.22 } },
  autoLevels: { label: 'Auto levels', settings: { percentiles: [.05, .95] } },
  equalize: { label: 'Histogram equalize', settings: { mode: 'equalize', bins: 96 } },
  histogramRange: { label: 'Histogram range', settings: { mode: 'range', position: .52, span: .58 } },
  histogramShift: { label: 'Histogram shift', settings: { mode: 'shift', offset: .25 } },
  histogramScan: { label: 'Histogram scan', settings: { mode: 'scan', position: .58, softness: .10 } },
  histogramSelect: { label: 'Histogram select', settings: { mode: 'select', position: .52, span: .19, softness: .025 } },
  hsl: { label: 'HSL', settings: { degrees: 37, saturation: 1.16, lightness: .03 } },
  hsv: { label: 'HSV', settings: { degrees: -32, saturation: 1.1, valueFactor: 1.18 } },
  exposure: { label: 'Exposure', settings: { stops: 1.05 } },
  contrast: { label: 'Contrast', settings: { factor: 1.44, pivot: .40 } },
  threshold: { label: 'Threshold', settings: { level: .23, softness: .08 } },
  invert: { label: 'Invert', settings: {} },
  posterize: { label: 'Posterize', settings: { steps: 4 } },
  palette: { label: 'Palette posterize', settings: { palette: ['#242338', '#3e6570', '#a86c40', '#f5c68d'] } },
  colorSelect: { label: 'Color selection', settings: { metric: 'perceptual', tolerance: .05, softness: .065 } },
  colorReplace: { label: 'Color replace', settings: { metric: 'perceptual', tolerance: .05, softness: .065 } }
};
const graphOps = { equalize:'histogramAdjust', histogramRange:'histogramAdjust', histogramShift:'histogramAdjust',
  histogramScan:'histogramAdjust', histogramSelect:'histogramAdjust', palette:'posterize' };

function prismPlate() {
  const width = prismWidth, height = prismHeight, data = new Uint16Array(width * height * 3);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const a = x - 72, b = y - 46, da = Math.abs(a), db = Math.abs(b);
    const seed = (Math.imul(x + 19, 15287) ^ Math.imul(y + 9, 29063)) & 127;
    const panel = da <= 60 && db <= 39 && da + db < 91;
    const rim = panel && (da > 57 || db > 36 || da + db > 87);
    const opening = da <= 48 && db <= 31 && da + db < 73;
    const diamond = da * .85 + db;
    const pin = Math.hypot(da - 51, db - 29);
    let color = [30, 28, 41], variation = 0;
    if (panel) {
      color = y < 48 ? [64, 58, 76] : [51, 50, 68];
      if (rim) color = y < 50 ? [97, 77, 72] : [61, 47, 55];
      variation = seed / 36 - 1.75;
    }
    if (opening) {
      const near = Math.floor((b + 4) / 6);
      color = [39 + near, 65 + near * 2, 80 + near * 2];
      if (((x + Math.floor(y / 7) * 8) % 23 === 0 || y % 7 === 1) && diamond > 35)
        color = [32, 49, 69];
      variation = seed / 29 - 2;
      if (diamond <= 30) {
        const band = Math.floor((diamond - (a < 0 ? 1.5 : 0)) / 4);
        color = a < 0 ? [232 - band * 8, 162 - band * 7, 89 - band * 4] :
          [202 - band * 7, 116 - band * 4, 73 - band * 3];
        if (Math.abs(b + a * .20) < 1.1 || da <= 1) color = [123, 83, 68];
        if (diamond < 4) color = [246, 206, 146];
      }
      if (diamond > 30 && diamond < 33) color = [168, 108, 64];
      if (diamond >= 33 && diamond < 35) color = [53, 53, 65];
      if ((da === 42 || db === 28) && diamond > 40 && seed < 48) color = [83, 106, 118];
      if (seed > 123 && diamond > 40) color = [86, 120, 125];
    }
    if (pin <= 4) {
      color = pin >= 3 ? [126, 90, 68] : [168, 108, 64];
      if (a + b < -59 && pin < 2) color = [224, 161, 103];
      variation = 0;
    }
    for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.round((color[c] + variation) * 257);
  }
  return { width, height, channels: 3, data };
}

function prismGraph(preset = 'levels') {
  const op = (op, inputs) => ({ op, inputs });
  const link = (node, port = 'value') => ({ node, port });
  const verb = graphOps[preset] ?? preset, isMask = ['colorSelect', 'threshold'].includes(verb);
  const histogram = { bins: 48, channel: 'luminance' };
  const graph = {
    format: 'ink-studio/graph-project', version: 1,
    inputs: { plate: 'raster', settings: { type: 'record', default: paintPresets[preset].settings } },
    nodes: {
      source: op('image.declare', { source: { input: 'plate' },
        descriptor: { intent: 'color', colorSpace: 'srgb', precision: 'unorm16' } }),
      after: op('image.' + verb, { source: link('source'), options: { input: 'settings' } }),
      beforeBins: op('image.histogram', { source: link('source'), options: histogram }),
      afterBins: op('image.histogram', { source: link('after'), options: histogram }),
      beforeDisplay: op('image.toDisplay', { source: link('source') })
    },
    outputs: { beforeDisplay: link('beforeDisplay'), beforeBins: link('beforeBins'), afterBins: link('afterBins'),
      corrected: link('after') }
  };
  if (verb === 'colorSelect') graph.nodes.after.inputs.color = sourceSwatch;
  if (verb === 'colorReplace') Object.assign(graph.nodes.after.inputs, { from: sourceSwatch, to: '#5db7aa' });
  if (verb === 'autoLevels') graph.outputs.fitted = link('after', 'report');
  if (!isMask) {
    graph.nodes.afterDisplay = op('image.toDisplay', { source: link('after') });
    graph.outputs.afterDisplay = link('afterDisplay');
  }
  return graph;
}

if (typeof module !== 'undefined') module.exports = { prismPlate, prismGraph, paintPresets };
