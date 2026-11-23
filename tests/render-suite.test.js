const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cameraPlan, percentiles } = require('../cli/render-suite.js');
const { measure } = require('../cli/render-suite-metrics.js');
const PNG = require('../cli/png.js');

test('the standard camera plan moves one control at a time and cuts with no recorded transition across it', () => {
  const base = { yaw: .2, pitch: .1, dist: 8, target: [0,1,0] };
  const plan = cameraPlan(base, 6, 12);
  assert.equal(plan.length, 24);
  assert.deepEqual(plan.filter(frame => frame.reset).map(frame => frame.index), [0,6,12,18,21]);
  assert.notDeepEqual(plan[0].camera.target, plan[5].camera.target);
  assert.equal(plan[0].camera.yaw, plan[5].camera.yaw);
  assert.notEqual(plan[6].camera.yaw, plan[11].camera.yaw);
  assert.deepEqual(plan[6].camera.target, plan[11].camera.target);
  assert.notEqual(plan[12].camera.dist, plan[17].camera.dist);
  assert.deepEqual(plan[20].camera, base);
  assert.notDeepEqual(plan[20].camera, plan[21].camera);
  assert.deepEqual(plan[21].camera, plan[23].camera);
  assert.equal(plan[21].cut, true);
  assert.equal(plan[21].time, 21/12);
  assert.deepEqual(percentiles([10,2,3,4,8]), { p50:4, p95:10, p99:10, max:10 });
});

function image(owners, colors) {
  return {
    w: 4, h: 1,
    passes: { objectId: Uint32Array.from(owners), objects: [null, 'gatehouse', 'sluice-screen'] },
    rgb: Uint8Array.from(colors.flatMap(value => [value,value,value]))
  };
}

test('native masks count a filled opening and paint separately from temporal RGB changes', () => {
  const fixture = { silhouette: 'gatehouse', paint: true };
  const reference = image([1,0,1,2], [40,20,40,100]);
  const candidate = image([1,1,0,2], [40,30,38,103]);
  const first = measure(reference, candidate, fixture);
  assert.deepEqual(first.metrics.silhouette, {
    referencePixels:2, candidatePixels:2, lostPixels:1, addedPixels:1, errorFraction:2/3
  });
  assert.deepEqual(first.metrics.paint, { matchedPixels:1, rgbRmse8Bit:3 });
  assert.equal(first.metrics.flicker.residualDeltaRmse8Bit, null);
  assert.deepEqual(Array.from(first.evidence.rgb.slice(3,9)), [88,225,240,251,156,70]);
  const matching = measure(reference, reference, fixture, first.state, true);
  assert.equal(matching.metrics.rgbRmse8Bit, 0);
  assert.equal(matching.metrics.flicker.holdRmse8Bit, Math.sqrt((100+4+9)/4));
});

test('the CLI applies a comparison profile and writes matched native captures and performance records', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-render-suite-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const profile = path.join(directory, 'profile.json');
  fs.writeFileSync(profile, JSON.stringify({ 'signal-coil': { candidate: { render: { curveSubdivision: false } } } }));
  const cwd = path.resolve(__dirname, '..');
  execFileSync(process.execPath, ['cli/ink-studio.js', 'render-suite', '--scene', 'signal-coil', '--profile', profile,
    '--w', '64', '--h', '40', '--frames-per-move', '4', '--out', directory], { cwd });
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
  assert.equal(report.format, 'ink-studio/render-suite');
  assert.deepEqual(report.artGrid, { width:64, height:40 });
  assert.deepEqual(report.moves, ['pan','orbit','zoom','cut']);
  assert.equal(report.scenes.length, 1);
  const scene = report.scenes[0];
  assert.equal(scene.id, 'signal-coil');
  assert.equal(scene.profiles.candidate.render.curveSubdivision, false);
  assert.equal(scene.frames.length, 16);
  assert.equal(scene.quality.maxRgbRmse8Bit, 0);
  assert.equal(scene.quality.strandBreaks, 0);
  assert.equal(scene.quality.maxHoldFlickerRmse8Bit, 0);
  assert.equal(scene.frames.find(frame => frame.cut).flicker.residualDeltaRmse8Bit, null);
  assert(scene.frames.some(frame => frame.strands.trackedPixels > 0));
  assert(scene.performance.reference.frameMs.p99 >= scene.performance.reference.frameMs.p50);
  assert(scene.performance.reference.memory.processPeakRssBytes > 0);
  assert(scene.performance.candidate.overdraw.p95 > 0);
  assert.deepEqual(scene.quality.diagnosticMismatches, { reference:0, candidate:0 });
  const picture = PNG.read(path.join(directory, report.comparison));
  assert.deepEqual([picture.w,picture.h], [192,40]);
  assert(fs.readFileSync(path.join(directory, report.animation)).includes(Buffer.from('acTL')));
});
