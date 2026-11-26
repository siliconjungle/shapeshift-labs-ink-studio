'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('../..'), { KIT: kit } = studio.load();
const PNG = require('../../cli/png.js'), Files = require('../../cli/asset-files.js');
const { fixture } = require('./vane.cjs');
const out = path.resolve(process.argv[2] ?? 'studio/tide-vane');
const file = name => path.join(out, name);
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
const read = name => JSON.parse(fs.readFileSync(file(name)));

async function demo() {
  const { source, donor, definition, views } = fixture(kit);
  Files.write(file('source.inksplats'), JSON.stringify(source) + '\n');
  for (const [name, contents] of [['plan', definition], ['cage-weights', donor], ['views', views]]) Files.json(file(name + '.json'), contents);
  run('splat-attributes', 'plan', file('source.inksplats'), file('plan.json'), '--out', file('fit'));
  run('splat-attributes', 'export', file('source.inksplats'), file('fit'), '--out', file('tide-vane.inksplats'));
  run('splat-attributes', 'verify', file('source.inksplats'), file('fit'), file('tide-vane.inksplats'),
    '--views', file('views.json'), '--out', file('verification'));
  const checks = read('verification/report.json'), plan = read('fit/report.json');
  assert(checks.passed && checks.exactPayload);
  assert.equal(checks.harmonicDegree, 4);
  assert.deepEqual(plan.removed.slice().sort(), ['stray-0','stray-1','stray-2','stray-3']);
  assert(plan.outliers[0].protected.some(row => row.id === 'finial'));
  assert(plan.transfers[0].rows.some(row => row.weight > .15 && row.weight < .75 && row.donors.length > 1));
  assert(checks.views.every(row => row.directionalChannels > 100 && row.changed.coverage.count > 100 &&
    row.changed.depth.count > 100 && row.changed.inkShadow.count > 25 && row.changed.geometricNormal.count > 100));
  const { w, h, camera, liveSun } = views[0];
  run('render', file('tide-vane.inksplats'), '--w', String(w), '--h', String(h), '--px', '1', '--raw',
    '--scan-appearance', '1', '--ortho', '--yaw', String(camera.yaw), '--pitch', String(camera.pitch),
    '--live-sun', 'on', '--sun-direction', liveSun.direction.join(','), '--sun-ambient', String(liveSun.ambient),
    '--sun-intensity', String(liveSun.intensity), '--shadow-map-size', String(liveSun.mapSize),
    '--shadow-bias', String(liveSun.bias), '--out', file('reopened.png'));
  const native = PNG.read(file('reopened.png')), audited = PNG.read(file('verification/views/front-export.png'));
  assert.deepEqual(native.rgb, audited.rgb);

  const gap = 8, top = 39, rowPitch = h + 29, width = gap + 3 * (w + gap), height = top + 2 * rowPitch + 11;
  const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x,y], color, scale });
  const commands = [{ type: 'rect', rect: [0,0,width,height], fill: '#162330' },
    label('TIDE VANE  /  SHARED SPLAT ATTRIBUTES', gap, 7, '#f0cd96', 2)];
  ['SOURCE', 'LIVE FIT', 'REOPENED EXPORT'].forEach((name,i) => commands.push(label(name, gap+i*(w+gap), 28, '#9fbdc4')));
  views.forEach(({ id }, i) => commands.push(label(id.toUpperCase(), gap, top + i * rowPitch + h + 6, '#94b3b9')));
  commands.push(label(plan.removed.length + ' OUTLIERS REMOVED   /   ' + plan.deformation.changedRows +
    ' SPLATS DEFORMED', gap + w + gap, top+h+6, '#b5d6ce'));
  commands.push(label('RGB, DEPTH, NORMALS AND SHADOWS MATCH', gap + w + gap, top+rowPitch+h+6, '#b5d6ce'));
  const board = kit.procedural.drawing2d.render({ width, height, commands, edges:'hard' });
  for (const [y, { id }] of views.entries()) for (const [x, stage] of ['source', 'live', 'export'].entries()) {
    const frame = PNG.read(file('verification/views/' + id + '-' + stage + '.png'));
    const ox = gap + x * (w + gap), oy = top + y * rowPitch;
    for (let i = 0; i < w * h; i++)
      board.data.set(frame.rgb.subarray(i * 3, i * 3 + 3), ((oy + Math.floor(i / w)) * width + ox + i % w) * 4);
  }
  Files.write(file('tide-vane.png'), PNG.encode(width, height, board.data, 4));
}
demo().catch(error => { console.error(error); process.exitCode = 1; });
