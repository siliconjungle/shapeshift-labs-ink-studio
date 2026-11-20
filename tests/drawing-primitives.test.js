const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const Drawing = require('../src/drawing-primitives.js');
const Composite = require('../src/frame-composite.js');
const PNG = require('../cli/png.js');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load();

function field({ makeBuilder }) {
  const world = makeBuilder(1, [0x0c1020]).finish({ radius: 3, cam: { target: [0,0,0], dist: 4, yaw: 0, pitch: 0 } });
  world.look = { composite: { world: { resolution: [30,25] }, layers: [{ draw: [
    { type: 'path', space: 'world', points: [[-1,0,0],[1,0,0]], width: .2, widthUnits: 'world', color: '#ff2020' },
    { type: 'scaleBar', origin: [6.5,60.5], length: 1, lengthUnits: 'world', reference: [0,0,0], width: 1,
      label: '', divisions: 2, color: '#20ff20' },
    { type: 'scaleBar', origin: [65.5,60.5], length: 20, label: '', width: 1, divisions: 2, color: '#20aaff' },
    { type: 'polygon', points: [[67,5],[86,5],[86,18],[67,18]], stroke: '#ffff00', fill: '#9120e0' },
    { type: 'arrow', from: [64,26], to: [87,26], headLength: 8, headWidth: 6, width: 2, color: '#f18221' }
  ] }] }, renderGraph: { passes: [{ id: 'grid', type: 'composite', layer: { draw: [
    { type: 'path', space: 'world', points: [[0,-.7,0],[0,-.34,0]], width: 3, color: '#10eaff' }
  ] } }] } };
  return world;
}

function pixel({ w, rgb }, x, y) {
  return Array.from(rgb.subarray((y*w+x)*3,(y*w+x)*3+3));
}

test('screen polygons preserve holes and arrows, grids and axes rasterize exact screen geometry', () => {
  const world = field(kit);
  const frame = studio.render(world, { w: 80, h: 54, raw: true, transparent: true, renderGraph: false, composite: {
    layers: [{ draw: [
      { type: 'polygon', rings: [[[3,3],[33,3],[33,31],[3,31]], [[11,11],[26,11],[26,24],[11,24]]],
        fill: '#8822cc', stroke: '#22ffee' },
      { type: 'arrow', from: [43.5,13.5], to: [74.5,13.5], width: 1, headLength: 12, headWidth: 12, color: '#ff9922' },
      { type: 'grid', origin: [42.5,25.5], counts: [3,2], step: [10,8], color: '#556677', majorColor: '#aabbcc', majorEvery: 2 },
      { type: 'axes', origin: [6.5,48.5], tickLength: 6, axes: [{ direction: [1,0], length: 21, tickEvery: 5,
        label: 'X', color: '#eeee22' }] }
    ] }]
  } });
  assert.deepEqual(pixel(frame,7,7),[136,34,204]);
  assert.equal(frame.alpha[20*80+18],0);
  assert.deepEqual(pixel(frame,65,15),[255,153,34]);
  assert.equal(frame.alpha[19*80+69],0);
  assert.deepEqual(pixel(frame,52,29),[85,102,119]);
  assert.deepEqual(pixel(frame,62,29),[170,187,204]);
  assert.deepEqual(pixel(frame,11,46),[238,238,34]);
  assert.equal(frame.alpha[45*80+8],0);
});

test('world projection follows the native camera while fixed screen measurements keep their pixel lengths', () => {
  const world = field(kit), options = { w: 96, h: 72, raw: true };
  const near = studio.render(world, { ...options, dist: 4 });
  const far = studio.render(world, { ...options, dist: 8 });
  const span = (frame, color) => Array.from({ length: frame.w }, (_, x) => pixel(frame,x,60))
    .filter(rgb => rgb.every((value,i) => value === color[i])).length;
  assert.deepEqual(near.worldSize,[30,25]);
  assert.deepEqual(far.worldSize,[30,25]);
  assert.equal(span(near,[32,170,255]),span(far,[32,170,255]));
  assert(span(near,[32,255,32]) >= 1.8*span(far,[32,255,32]));
  assert.deepEqual(pixel(near,48,37),[255,32,32]);
  assert.notDeepEqual(pixel(far,48,37),[255,32,32]);
  assert.deepEqual(pixel(near,48,48),[16,234,255]);
  assert.notDeepEqual(pixel(far,48,48),[16,234,255]);
});

test('projection clips at both depth planes and scales arrow heads and stroke widths with depth', () => {
  const camera = { view: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], tangent: .5,
    aspect: 1, ortho: false, clipNear: 1, clipFar: 5 };
  const make = draw => Drawing.geometry(Drawing.command({ space: 'world', ...draw }),camera,100,100);
  const [line] = make({ type: 'path', points: [[-.4,0,-.5],[1,0,-6]], width: .2, widthUnits: 'world' })[0].lines;
  assert.equal(line[2],20);
  assert.equal(line[3],4);
  const vertical = Drawing.command({ type: 'path', space: 'world', points: [[0,-.5,-2],[0,.5,-2]],
    width: .2, widthUnits: 'world' });
  assert.equal(Drawing.geometry(vertical,{ ...camera, aspect: .5 },100,100)[0].lines[0][2],20);
  assert(line[0][0] < 50 && line[1][0] > 50);
  const arrow = make({ type: 'arrow', from: [-1,0,-2], to: [1,0,-2], headUnits: 'world', headLength: .2, headWidth: .12 });
  assert.equal(arrow[0].fills[0][0][0][0],100);
  assert.equal(arrow[0].lines[0][1][0],90);
  assert.deepEqual(make({ type: 'arrow', from: [-1,0,-2], to: [1,0,.5] })[0].fills,[]);
  const poly = make({ type: 'polygon', points: [[-.5,-.5,-.1],[.5,-.5,-2],[.5,.5,-2],[-.5,.5,-.1]] });
  assert.equal(poly[0].fills[0][0].length,4);
  assert(poly[0].fills[0][0].flat().every(Number.isFinite));
  assert.deepEqual(make({ type: 'polygon', points: [[0,0,.5],[1,0,1],[0,1,2]] })[0].fills,[[]]);
});

test('invalid drawing coordinates, budgets and calibration are rejected', () => {
  const check = draw => Composite.settings({ layers: [{ draw: [draw] }] });
  assert.throws(() => check({ type: 'grid', origin: [0,0], counts: [500,2] }), /cells/);
  assert.throws(() => check({ type: 'grid', origin: [0,0], counts: [2,2], v: [1,1] }), /perpendicular/);
  assert.throws(() => check({ type: 'polygon', space: 'world', points: [[0,0],[1,0],[1,1]] }), /finite XYZ/);
  assert.throws(() => check({ type: 'scaleBar', origin: [0,0], length: 4, lengthUnits: 'world' }), /world reference/);
  assert.throws(() => check({ type: 'arrow', from: [0,0], to: [1,2], widthUnits: 'world' }), /world primitive/);
  assert.throws(() => check({ type: 'axes', origin: [0,0], axes: [{ direction: [1,0], length: 9, tickEvery: .001 }] }), /ticks/);
});

test('CLI render and sim render use the same serialized drawing layer and record it for replay', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-drawing-primitives-'));
  t.after(() => fs.rmSync(dir,{ recursive: true, force: true }));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const source = field(kit), overlay = path.join(dir,'overlay.json');
  fs.writeFileSync(overlay,JSON.stringify(source.look.composite));
  fs.writeFileSync(path.join(dir,'scene.json'),JSON.stringify({ id: 'drawing-cli', camera: source.cam, solids: [] }));
  fs.writeFileSync(path.join(dir,'world.json'),JSON.stringify(kit.KIT.world.manifest({ id: 'drawing-sim', visual: { camera: source.cam } })));
  const call = (...args) => execFileSync(process.execPath,[cli,...args],{ cwd: dir, stdio: 'pipe' });
  call('render','scene.json','--composite','overlay.json','--w','96','--h','72','--out','scene.png','--recipe','shot.json');
  call('sim','render','world.json','--composite','overlay.json','--w','96','--h','72','--out','world.png');
  assert(JSON.parse(fs.readFileSync(path.join(dir,'shot.json'))).inputs.some(source => source.file === 'overlay.json'));
  for (const file of ['scene.png','world.png']) assert.deepEqual(pixel(PNG.read(path.join(dir,file)),70,10),[145,32,224]);
});

test('WebGL and CPU agree in mixed-resolution and graph passes with camera-scaled primitives', { skip: !process.env.INK_TEST_CHROME }, () => {
  const points = { fill: [70,10], head: [82,26], world: [48,37], graph: [48,48], worldBar: [23,60], fixedBar: [80,60] };
  const result = runWebGL({}, field, (kit, fixture, backend, points) => {
    const world = fixture(kit), draw = backend(96,72,{ raw: true, offscreen: true });
    try {
      draw.draw(world,{ camera: { dist: 4 } });
      const near = draw.sample(points);
      draw.draw(world,{ camera: { dist: 8 } });
      return { near, far: draw.sample(points) };
    } finally {
      draw.close();
    }
  }, points);
  for (const [id,dist] of [['near',4],['far',8]]) {
    const frame = studio.render(field(kit),{ w: 96, h: 72, raw: true, dist });
    for (const [key,at] of Object.entries(points))
      assert(result[id][key].every((value,i) => Math.abs(value-pixel(frame,...at)[i]) <= 1), id + ' ' + key);
  }
  assert.notDeepEqual(result.near.world,result.far.world);
  assert.deepEqual(result.near.fixedBar,result.far.fixedBar);
});
