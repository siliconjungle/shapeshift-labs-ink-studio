const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: pause } = require('node:timers/promises');
const PNG = require('./png.js');
const Assets = require('./asset-files.js');
const { withChrome } = require('./canvas-grid-chrome.js');
const { measure, trackEdge } = require('./canvas-grid-metrics.js');

const defaults = [416, 443, 512].flatMap(width => [1, 1.25, 2].map(dpr => ({ width, height: 380, dpr })));
const fixture = pathToFileURL(path.join(__dirname, 'canvas-grid-fixture.mjs')).href;
const webgl = pathToFileURL(path.join(__dirname, '../webgl.mjs')).href;

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function planSettings(plan, root) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('Expected a canvas grid check plan');
  const { cases = defaults, frames = 15, pixelsPerFrame = .5, page } = plan;
  if (!Array.isArray(cases) || !integer(cases.length, 1, 24))
    throw new RangeError('Canvas grid check needs between 1 and 24 viewport cases');
  const viewports = cases.map(view => {
    const { width, height, dpr } = view ?? {};
    if (!integer(width, 120, 2048) || !integer(height, 120, 2048) || !Number.isFinite(dpr) ||
        dpr < .5 || dpr > 4 || Math.ceil(width * dpr) * Math.ceil(height * dpr) > 5000000)
      throw new RangeError('Each case needs integer CSS width and height (120–2048), DPR (.5–4) and at most 5M device pixels');
    return { width, height, dpr };
  });
  if (!integer(frames, 5, 40) || !Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0 || pixelsPerFrame > 1)
    throw new RangeError('Use 5–40 slow-pan frames and pixelsPerFrame greater than zero and at most 1');
  if (page !== undefined && (typeof page !== 'string' || !/\.html?$/i.test(page) || !fs.statSync(path.resolve(root, page)).isFile()))
    throw new TypeError('Canvas grid check page must be a local HTML file');
  return { cases: viewports, frames, pixelsPerFrame, ...(page && { page: path.resolve(root, page) }) };
}

function materializeFixture(directory) {
  const file = path.join(directory, 'index.html');
  fs.writeFileSync(path.join(directory, 'bundle.js'), require('../index.js').bundle());
  fs.writeFileSync(file, `<!doctype html>
<meta charset="utf-8">
<title>Ink canvas grid calibration</title>
<style>
html{background:#111922}
body{margin:16px}
canvas{display:block;width:100%;height:auto;image-rendering:pixelated}
</style>
<canvas width="96" height="64" aria-label="Ink WebGL calibration scene and pixel grid"></canvas>
<script src="bundle.js"></script>
<script type="module">
try {
  const {createRenderer} = await import(${JSON.stringify(webgl)});
  const {mountGridFixture} = await import(${JSON.stringify(fixture)});
  globalThis.inkCanvasGrid = mountGridFixture(createRenderer);
} catch (error) {
  globalThis.inkCanvasGridError = error.stack;
}
</script>`);
  return file;
}

async function captureBrowser(frame) {
  const { canvas, draw, probes } = globalThis.inkCanvasGrid;
  if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected || typeof draw !== 'function')
    throw new Error('inkCanvasGrid needs an attached HTML canvas and a draw function');
  const bytes = await draw.call(globalThis.inkCanvasGrid, frame);
  const { width, height } = canvas;
  if (!width || !height || width * height > 500000 ||
      !(bytes instanceof Uint8Array || bytes instanceof Uint8ClampedArray) || bytes.length !== width * height * 3)
    throw new Error('inkCanvasGrid.draw must return the canvas’s opaque RGB bytes in top-down order (up to 500,000 native pixels)');
  const rect = canvas.getBoundingClientRect();
  const presentation = getComputedStyle(canvas);
  if (['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth'].some(key => parseFloat(presentation[key]) > 0))
    throw new Error('Put canvas padding and borders on a containing element for pixel-grid checks');
  return {
    width, height, rect: rect.toJSON(), imageRendering: presentation.imageRendering, dpr: devicePixelRatio,
    probes, rgb: bytes.toBase64?.() ?? btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
  };
}

function validatedProbes(probes, width, height) {
  if (!Array.isArray(probes) || !integer(probes.length, 2, 16))
    throw new TypeError('inkCanvasGrid needs 2–16 probes, including a ruler and a moving edge');
  const ids = new Set(), kinds = new Set();
  for (const probe of probes) {
    const { id, kind, axis, start, length } = probe ?? {};
    const horizontal = axis === 'x';
    if (typeof id !== 'string' || !id.trim() || ids.has(id) || !['ruler', 'edge'].includes(kind) ||
        !['x', 'y'].includes(axis) || !Array.isArray(start) || start.length !== 2 ||
        !integer(start[0], 0, width - 1) || !integer(start[1], 0, height - 1) ||
        !integer(length, kind === 'ruler' ? 5 : 3, (horizontal ? width : height) - start[horizontal ? 0 : 1]))
      throw new TypeError('Invalid canvas grid probe ' + JSON.stringify(probe));
    ids.add(id);
    kinds.add(kind);
  }
  if (kinds.size !== 2) throw new TypeError('Canvas grid check needs both a ruler and a moving edge');
}

async function openPage(browser, file) {
  const url = pathToFileURL(file).href;
  const navigation = await browser.send('Page.navigate', { url });
  if (navigation.errorText) throw new Error('Could not open canvas check page: ' + navigation.errorText);
  for (let i = 0; i < 100; i++) {
    // Runtime evaluation can briefly see the old document while navigation commits.
    const ready = await browser.evaluate('location.href === ' + JSON.stringify(url) +
      ' && (globalThis.inkCanvasGridError || Boolean(globalThis.inkCanvasGrid))');
    if (ready === true) return;
    if (ready) throw new Error(ready);
    await pause(50);
  }
  throw new Error('Canvas check page did not expose globalThis.inkCanvasGrid');
}

function verifyCapture(properties, viewport, screenshot) {
  const { rect, dpr } = properties;
  if (Math.abs(dpr - viewport.dpr) > 1e-5 || Math.abs(screenshot.w - viewport.width * dpr) > 1 ||
      Math.abs(screenshot.h - viewport.height * dpr) > 1)
    throw new Error('Chrome did not capture the requested device pixel viewport');
  if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 ||
      rect.right > viewport.width || rect.bottom > viewport.height)
    throw new Error('The canvas must fit fully inside the requested viewport');
  return { origin: [rect.left * dpr, rect.top * dpr],
    scale: [rect.width * dpr / properties.width, rect.height * dpr / properties.height] };
}

function publishEvidence(directory, prefix, capture) {
  const composited = prefix + '.png', native = prefix + '-native.png';
  Assets.write(path.join(directory, composited), capture.png);
  Assets.write(path.join(directory, native), PNG.encode(capture.native.w, capture.native.h, capture.native.rgb));
  return { frame: capture.frame, composited, native };
}

async function checkCase(browser, directory, file, options, viewport, index) {
  const id = 'case-' + String(index + 1).padStart(2, '0');
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: false
  });
  // A fresh document lets projects apply their normal startup sizing at each viewport.
  if (index) await browser.send('Page.navigate', { url: 'about:blank' });
  await openPage(browser, file);
  const frames = [], states = new Map(), flags = new Map(), evidence = {};
  let baseline, probeLayout, previous, firstRuler, firstMotion, beforeMotion;
  for (let frame = 0; frame < options.frames; frame++) {
    const pan = frame * options.pixelsPerFrame;
    const properties = await browser.evaluate('(' + captureBrowser.toString() + ')(' + JSON.stringify({ frame, pan }) + ')');
    const { width: w, height: h, probes } = properties;
    const native = { w, h, rgb: Buffer.from(properties.rgb, 'base64') };
    const { data } = await browser.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false
    });
    const png = Buffer.from(data, 'base64'), screenshot = PNG.read(png);
    const area = verifyCapture(properties, viewport, screenshot);
    const capture = { frame, png, native };
    if (!baseline) {
      validatedProbes(probes, w, h);
      probeLayout = JSON.stringify(probes);
      baseline = capture;
      for (const probe of probes.filter(probe => probe.kind === 'edge'))
        states.set(probe.id, { advances: 0, strides: {} });
    } else if (w !== baseline.native.w || h !== baseline.native.h || JSON.stringify(probes) !== probeLayout) {
      throw new Error('Canvas native dimensions and probes must stay fixed during each pan');
    }
    const samples = probes.map(probe => {
      const sample = measure(native, screenshot, area, probe);
      if (probe.kind === 'edge')
        trackEdge(sample, states.get(probe.id), area.scale[probe.axis === 'x' ? 0 : 1]);
      for (const kind of sample.flags) {
        const key = JSON.stringify([probe.id, kind]);
        if (!flags.has(key)) flags.set(key, { probe: probe.id, kind, frame });
      }
      if (sample.flags.length && probe.kind === 'ruler') firstRuler ??= capture;
      if (sample.flags.length && probe.kind === 'edge' && !firstMotion) {
        firstMotion = capture;
        beforeMotion = previous;
      }
      return { probe: probe.id, ...sample };
    });
    frames.push({ frame, pan, rect: properties.rect, scale: area.scale,
      imageRendering: properties.imageRendering, samples });
    previous = capture;
  }

  for (const [probe, state] of states) {
    if (state.advances === 0) {
      const kind = 'pan-not-observed';
      flags.set(JSON.stringify([probe, kind]), { probe, kind, frame: 0 });
      firstMotion ??= baseline;
    }
  }
  evidence.ruler = publishEvidence(directory, id + '-ruler', firstRuler ?? baseline);
  if (firstMotion) evidence.edge = publishEvidence(directory, id + '-edge', firstMotion);
  if (beforeMotion) evidence.beforeEdge = publishEvidence(directory, id + '-before-edge', beforeMotion);
  return { id, viewport, native: { width: baseline.native.w, height: baseline.native.h },
    flags: [...flags.values()].sort((a, b) => a.frame - b.frame),
    edgeStrides: Object.fromEntries([...states].map(([probe, state]) => [probe, state.strides])), frames, evidence };
}

async function run(directory, { plan = {}, root = process.cwd(), chrome, hardware, onCase } = {}) {
  const settings = planSettings(plan, root), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-canvas-grid-'));
  try {
    const file = settings.page ?? materializeFixture(temp);
    return await withChrome(temp, { chrome, hardware }, async browser => {
      const browserVersion = await browser.send('Browser.getVersion');
      await browser.send('Page.enable');
      const cases = [];
      for (const [index, viewport] of settings.cases.entries()) {
        const result = await checkCase(browser, directory, file, settings, viewport, index);
        cases.push(result);
        onCase?.(result);
      }
      const report = { format: 'ink-studio/canvas-grid-check', version: 1, browser: browserVersion.product,
        fixture: settings.page ?? 'Ink WebGL calibration scene',
        frames: settings.frames, pixelsPerFrame: settings.pixelsPerFrame, cases };
      Assets.json(path.join(directory, 'report.json'), report);
      return report;
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { run };
