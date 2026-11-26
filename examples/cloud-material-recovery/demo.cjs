'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const toolkit = require('../..').load(), PNG = require('../../cli/png.js');
const Files = require('../../cli/asset-files.js'), Beacon = require('./beacon.cjs');
const base = path.resolve(process.argv[2] ?? 'studio/copper-beacon');
const file = name => path.join(base, name);
const command = (action, ...args) => execFileSync(process.execPath,
  [path.resolve(__dirname, '../../cli/ink-studio.js'), 'cloud-materials', action, ...args], { stdio: 'inherit' });
const read = name => JSON.parse(fs.readFileSync(file(name)));
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);

async function demo() {
  const { shBasis } = await import('../../src/gaussian-splats.mjs');
  const truth = Beacon.rows(), capture = Beacon.ply(truth, shBasis);
  Files.write(file('beacon.ply'), capture);
  const anchors = Array.from({ length: 48 }, (_, i) => {
    const row = 9 + 33 * i;
    return { row, pigment: truth[row].pigment };
  });
  Files.json(file('plan.json'), { anchors });
  command('recover', file('beacon.ply'), '--plan', file('plan.json'), '--out', file('recovered'));

  const asset = read('recovered/material.json'), report = read('recovered/report.json');
  assert(capture.equals(fs.readFileSync(file('recovered/capture.ply'))));
  Files.write(file('reference/capture.ply'), capture);
  Files.json(file('reference/material.json'), { ...asset,
    rows: asset.rows.map((row, i) => ({ ...row, normal: truth[i].normal, pigment: truth[i].pigment,
      roughness: truth[i].roughness, specular: truth[i].specular })) });

  const edits = truth.flatMap((row, i) => row.position[2] > .70 && Math.abs(row.position[0]) < .32 && Math.abs(row.position[1] - .07) < .09 ?
    [{ row: i, pigment: [.54, .12, .41], roughness: .73 }] : []);
  Files.json(file('override.json'), { format: 'ink-studio/cloud-materials-overrides', version: 1, sourceSha256: asset.source.sha256, edits });
  command('override', file('recovered/material.json'), file('override.json'), '--out', file('edited'));
  assert(capture.equals(fs.readFileSync(file('edited/capture.ply'))));

  const width = 224, height = 208, camera = { yaw: .35, pitch: .18, dist: 10.7, ortho: true };
  const newLight = { direction: [.62, .42, .66], ambient: .31, key: .69 };
  function view(name, settings, model = 'recovered') {
    Files.json(file(name + '.json'), { width, height, camera, ...settings });
    command('render', file(model + '/material.json'), file(name + '.json'), '--out', file(name + '.png'));
    return PNG.read(file(name + '.png'));
  }
  const rendered = [
    ['CAPTURE', view('captured', { mode: 'captured' })],
    ['RECOVERED PIGMENT', view('diffuse', { mode: 'pigment' })],
    ['ROUGHNESS UNCERTAINTY', view('roughness-uncertainty', { mode: 'roughness-uncertainty' })],
    ['RELIT ESTIMATE', view('relit', { light: newLight })],
    ['RELIT REFERENCE', view('relit-reference', { light: newLight }, 'reference')],
    ['ARTIST OVERRIDE', view('edited-relit', { light: newLight }, 'edited')]
  ];
  const captureEdited = view('edited-capture', { captured: 1, light: newLight }, 'edited');
  assert.deepEqual(captureEdited.rgb, rendered[0][1].rgb);

  const body = asset.rows.slice(0, 1600);
  const error = body.reduce((sum, row, i) => sum +
    row.pigment.reduce((e, n, c) => e + Math.abs(n - truth[i].pigment[c]), 0), 0) / (3 * body.length);
  const fitAngles = Math.acos(Math.min(1, dot(asset.illumination.direction, Beacon.captureLight.direction))) * 180 / Math.PI;
  const roughnessFits = body.flatMap((row, i) => row.evidence === 'directional-lobe' && row.uncertainty.roughness < .72 ?
    [Math.abs(row.roughness - truth[i].roughness)] : []);
  const rgbA = rendered[3][1].rgb, rgbB = rendered[4][1].rgb;
  const relightRmse = Math.sqrt(rgbA.reduce((sum, n, i) => sum + ((n - rgbB[i]) / 255) ** 2, 0) / rgbA.length);
  assert(fitAngles < 12 && error < .065 && roughnessFits.length > 150 && relightRmse < .055,
    JSON.stringify({ fitAngles, error, fitted: roughnessFits.length, relightRmse }));
  const roughnessMae = roughnessFits.reduce((sum, n) => sum + n, 0) / roughnessFits.length;

  const gap = 8, top = 34, pitch = height + 29, w = 3 * (width + gap) + gap, h = top + 2 * pitch + 24;
  const rect = { type: 'rect', rect: [0, 0, w, h], fill: '#151e28' };
  const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
  const commands = [rect, label('COPPER BEACON  /  MATERIAL RECOVERY', gap, 9, '#f3cf97', 2),
    label('TEAL = LOWER UNCERTAINTY   /   AMBER = HIGHER UNCERTAINTY', gap, h - 20, '#9abcc1')];
  for (const [i, [title]] of rendered.entries()) {
    commands.push(label(title, gap + (i % 3) * (width + gap), top + Math.floor(i / 3) * pitch + height + 6, '#d4e8e8'));
  }
  const board = toolkit.KIT.procedural.drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
  for (const [i, [, image]] of rendered.entries()) {
    const ox = gap + (i % 3) * (width + gap), oy = top + Math.floor(i / 3) * pitch;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const j = y * width + x;
      board.data.set(image.rgb.subarray(j * 3, j * 3 + 3), ((oy + y) * w + ox + x) * 4);
    }
  }
  Files.write(file('copper-beacon.png'), PNG.encode(w, h, board.data, 4));
  Files.json(file('demo-report.json'), { points: truth.length, anchors: anchors.length, angularErrorDegrees: fitAngles,
    diffuseLinearRgbMae: error, roughnessMae, roughnessRowsMeasured: roughnessFits.length, relightRmse,
    captureUnchanged: true, overriddenRows: edits.length, illumination: report.illumination, uncertainty: report.uncertainty });
}

demo().catch(error => { console.error(error); process.exitCode = 1; });
