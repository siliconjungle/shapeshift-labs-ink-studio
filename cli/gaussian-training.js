'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const CameraLens = require('../src/camera-lens.js');
const { graphOutputs } = require('./graph-outputs.js');
const { claim } = require('./graph-batch.js');
const Views = require('./gaussian-training-views.js');
const Fit = require('./gaussian-training-fit.js');
const displayBackground = [20, 27, 36].map(n => n / 255);
const sh0 = .28209479177387814;

function encode(values, cell) {
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
    'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  const count = values.length / Fit.stride;
  const header = Buffer.from(['ply', 'format binary_little_endian 1.0', 'element vertex ' + count,
    ...fields.map(name => 'property float ' + name), 'end_header', ''].join('\n'));
  const bytes = Buffer.alloc(count * fields.length * 4);
  for (let i = 0, cursor = 0; i < values.length; i += Fit.stride) {
    const opacity = values[i + 4], scale = values[i + 3] + Math.log(cell);
    const row = [values[i], values[i + 1], values[i + 2], scale, scale, scale, 1, 0, 0, 0,
      Math.log(opacity / (1 - opacity)), ...values.subarray(i + 5, i + 8).map(n => (n - .5) / sh0)];
    for (const n of row) { bytes.writeFloatLE(n, cursor); cursor += 4; }
  }
  return Buffer.concat([header, bytes]);
}

function decodedValues(cloud, cell) {
  const { count, positions, scales, opacity, dc } = cloud, values = new Float64Array(count * Fit.stride);
  for (let i = 0; i < count; i++) {
    const p = 3 * i, j = Fit.stride * i;
    values.set(positions.subarray(p, p + 3), j);
    values[j + 3] = Math.log(scales[p] / cell);
    values[j + 4] = opacity[i];
    for (let c = 0; c < 3; c++) values[j + 5 + c] = Math.min(1, Math.max(0, .5 + sh0 * dc[p + c]));
  }
  return values;
}

function measure(view, rendered, alphaCutoff) {
  const { target, silhouette } = view;
  let sum = 0, absolute = 0, foregroundSSE = 0, intersect = 0, union = 0, alphaError = 0;
  for (let i = 0; i < silhouette.length; i++) {
    const j = i * 4, deltaAlpha = target[j + 3] - rendered[j + 3];
    const expected = silhouette[i], observed = rendered[j + 3] >= alphaCutoff;
    intersect += expected && observed;
    union += expected || observed;
    alphaError += Math.abs(deltaAlpha);
    for (let c = 0; c < 3; c++) {
      const error = target[j + c] - rendered[j + c] - displayBackground[c] * deltaAlpha;
      absolute += Math.abs(error);
      sum += error ** 2;
      if (expected) foregroundSSE += error ** 2;
    }
  }
  const psnr = mse => mse === 0 ? null : -10 * Math.log10(mse);
  const mse = sum / (3 * silhouette.length);
  return { mse, psnrDb: psnr(mse), foregroundPsnrDb: psnr(foregroundSSE / (3 * view.evidence.foreground)),
    mae: absolute / (3 * silhouette.length), alphaMae: alphaError / silhouette.length, silhouetteIoU: intersect / union };
}

function diagnostics(view, initial, optimized) {
  const { width, height, target } = view, size = width * height;
  const residual = new Uint8Array(3 * size);
  const panels = [target, initial, optimized].map(pixels => {
    const rgb = new Uint8Array(3 * size), straight = new Uint8Array(4 * size);
    for (let i = 0; i < size; i++) {
      const j = i * 4, a = pixels[j + 3];
      straight[j + 3] = Math.round(a * 255);
      for (let c = 0; c < 3; c++) {
        straight[j + c] = a ? Math.round(Math.min(1, Math.max(0, pixels[j + c] / a)) * 255) : 0;
        rgb[3 * i + c] = Math.round((pixels[j + c] + displayBackground[c] * (1 - a)) * 255);
      }
    }
    return { rgb, straight };
  });
  for (let i = 0; i < residual.length; i++) residual[i] = Math.min(255, 3 * Math.abs(panels[0].rgb[i] - panels[2].rgb[i]));
  const dir = 'held-out/' + view.id + '/';
  const artifacts = ['reference.png', 'initial.png', 'fit.png', 'residual-x3.png'].map((name, i) => ({
    file: dir + name, bytes: i < 3 ? PNG.encode(width, height, panels[i].straight, 4) : PNG.encode(width, height, residual)
  }));
  return { artifacts, columns: [...panels.map(row => ({ w: width, h: height, rgb: row.rgb })),
    { w: width, h: height, rgb: residual }] };
}

function contactSheet(rows, kit) {
  const longest = Math.max(...rows.map(row => Math.max(row.columns[0].w, row.columns[0].h)));
  const scale = Math.min(3, longest > 200 ? 200 / longest : Math.floor(200 / longest));
  const scaled = n => Math.max(1, Math.floor(n * scale));
  const gap = 8, header = 40, width = Math.max(128, ...rows.map(row => scaled(row.columns[0].w))),
    height = Math.max(...rows.map(row => scaled(row.columns[0].h))), rowPitch = height + 30;
  const w = gap + 4 * (width + gap), h = header + rows.length * rowPitch + gap;
  const instructions = [{ type: 'rect', rect: [0, 0, w, h], fill: '#141b24' }];
  const title = (text, x, y, color, scale = 1) => instructions.push({ type: 'text', text, at: [x, y], scale, color });
  title('GAUSSIAN TRAINING  /  HELD-OUT CAMERAS', gap, 7, '#f1d9a4', 2);
  for (const [i, text] of ['REFERENCE', 'INITIAL HULL', 'FITTED ASSET', 'RGB ERROR X3'].entries())
    title(text, gap + i * (width + gap), 28, '#9abbc1');
  rows.forEach(({ view, fit }, row) => {
    title(view.toUpperCase().slice(0, Math.floor((2 * width - gap) / 6)), gap, header + row * rowPitch + height + 7, '#bbdadd');
    title('IOU ' + fit.silhouetteIoU.toFixed(3) + '   FG PSNR ' + (fit.foregroundPsnrDb?.toFixed(1) ?? 'PERFECT'),
      gap + 2 * (width + gap), header + row * rowPitch + height + 7, '#bbdadd');
  });
  const board = kit.procedural.drawing2d.render({ width: w, height: h, edges: 'hard', commands: instructions });
  for (const [row, { columns }] of rows.entries()) for (const [col, image] of columns.entries()) {
    const tileW = scaled(image.w), tileH = scaled(image.h);
    const left = gap + col * (width + gap) + Math.floor((width - tileW) / 2);
    const top = header + row * rowPitch + Math.floor((height - tileH) / 2);
    for (let y = 0; y < tileH; y++) for (let x = 0; x < tileW; x++) {
      const p = ((top + y) * w + left + x) * 4;
      const q = (Math.floor(y * image.h / tileH) * image.w + Math.floor(x * image.w / tileW)) * 3;
      board.data.set(image.rgb.subarray(q, q + 3), p);
    }
  }
  return PNG.encode(w, h, board.data, 4);
}

async function train(file, directory, kit) {
  const dataset = Views.manifest(file), config = Fit.settings(dataset.settings), root = path.dirname(file);
  const load = row => Views.loadView(row, root, CameraLens, config.alphaCutoff);
  const training = dataset.train.map(load);
  Views.checkCameras(training);
  const fitted = Fit.fit(training, dataset.bounds, config);
  const { values, initial, cell, budget, losses, bestIteration, initialization } = fitted;
  const trainingSamples = budget.used;
  if (values.some((n, i) => i % Fit.stride < 3 && Math.abs(n - Math.fround(n)) > cell / 4))
    throw new RangeError('Training coordinates exceed Gaussian asset precision at this grid spacing. Recenter the capture.');
  const bytes = encode(values, cell);
  const { decodeGaussianPly } = await import('../src/gaussian-splats.mjs');
  const cloud = decodeGaussianPly(bytes, { maxPoints: config.maxPoints }), exported = decodedValues(cloud, cell);

  // Holdout images are first opened after optimization and asset encoding.
  const holdouts = dataset.holdout.map(load);
  Views.checkCameras([...training, ...holdouts]);
  const artifacts = [{ file: 'cloud.ply', bytes }], rows = [];
  const heldOut = holdouts.map(view => {
    const baseline = Fit.rasterize(initial, view, cell, budget).rendered;
    const render = Fit.rasterize(exported, view, cell, budget).rendered;
    const before = measure(view, baseline, config.alphaCutoff), fit = measure(view, render, config.alphaCutoff);
    const { artifacts: images, columns } = diagnostics(view, baseline, render);
    artifacts.push(...images);
    rows.push({ view: view.id, columns, fit });
    return { ...view.evidence, before, fit, images: images.map(image => image.file) };
  });
  artifacts.push({ file: 'held-out.png', bytes: contactSheet(rows, kit) });
  const report = { format: 'ink-studio/gaussian-training-report', version: 1, datasetSha256: dataset.sha256,
    asset: { file: 'cloud.ply', sha256: Views.hash(bytes), format: 'gaussian-ply', points: cloud.count, degree: cloud.degree },
    bounds: dataset.bounds, settings: config, initialization, fit: { bestIteration, losses, objective: 'premultiplied-display-rgba-mse',
      samples: trainingSamples, diagnosticSamples: budget.used - trainingSamples, totalSampleLimit: budget.max },
    training: training.map(view => view.evidence), heldOut, contactSheet: 'held-out.png',
    diagnostics: { background: displayBackground.map(n => Math.round(n * 255)), residualMultiplier: 3 } };
  const output = graphOutputs([file, ...[...training, ...holdouts].flatMap(view => view.files)]);
  output.write(directory, [...artifacts, { file: 'report.json', document: report }]);
  return report;
}

function capture(file, directory, build, pose, inputs) {
  const { bounds, settings, views } = Views.manifest(file, true);
  if (settings !== undefined) Fit.settings(settings);
  const captured = views.map(row => Views.capture(row, build, pose, CameraLens));
  const dataset = { format: Views.datasetFormat, version: 1, bounds, settings, views: captured.map(item => item.row) };
  Views.checkCameras(dataset.views);
  graphOutputs([file, ...inputs]).write(directory, [...captured.map(row => row.artifact), { file: 'dataset.json', document: dataset }]);
  return dataset;
}

async function command(pos, opt, kit, build, pose) {
  const [action, input, plan] = pos;
  if (Object.keys(opt).some(key => key !== 'out') || typeof opt.out !== 'string' || !opt.out ||
      !input || (action === 'capture' ? pos.length !== 3 : action !== 'train' || pos.length !== 2))
    throw new TypeError('Use gaussian-train capture <scene> <plan.json> --out directory or gaussian-train train <dataset.json> --out directory');
  const directory = path.resolve(opt.out), release = claim(directory, 'Gaussian training');
  try {
    if (action === 'capture') {
      const summary = capture(path.resolve(plan), directory, time => build(input, time), pose,
        fs.statSync(input, { throwIfNoEntry: false })?.isFile() ? [path.resolve(input)] : []);
      console.log('Captured ' + summary.views.length + ' registered views in ' + directory);
    } else {
      const report = await train(path.resolve(input), directory, kit);
      console.log('Wrote ' + report.asset.points + ' fitted Gaussians and ' + report.heldOut.length + ' held-out views in ' + directory);
    }
  } finally {
    release();
  }
}

module.exports = { command };
