const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT, makeBuilder } = ink.load();
const { prepare, extract } = KIT.directionDrawing;
const runWebGL = require('../cli/look-webgl.js');

const camera = { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -8, 1],
  tangent: 2, aspect: 1, ortho: true, clipNear: .4, clipFar: 40 };
const fold = { id: 'fold', mesh: {
  points: [[-2,0,0],[2,0,0],[-2,1,-1],[2,1,-1],[-2,-1,-.35],[2,-1,-.35]],
  faces: [[0,1,3,2],[4,5,1,0]]
} };
function panel(id, left, right, bottom, top, z, emit = false) {
  return { id, emit, mesh: { points: [[left,bottom,z],[right,bottom,z],[right,top,z],[left,top,z]],
    faces: [[0,1,2,3]] } };
}
const blocker = panel('foreground', -.48, .48, -.35, .35, 1);
const backing = panel('backdrop', .9, 3, -2, 2, -3);
const close = (a, b) => assert(Math.abs(a - b) < .001, a + ' versus ' + b);
const ridge = result => result.paths.find(path => path.id === 'fold/0-1');

test('geometry yields creases and view-specific silhouettes and occlusion boundaries', () => {
  const compiled = prepare([fold, blocker, backing]);
  const result = compiled.extract({ camera, width: 200, height: 200 });
  const path = ridge(result);
  assert.deepEqual(path.vertices, [0,1]);
  assert.deepEqual(path.spans.map(span => span.kind), ['crease','crease']);
  close(path.spans[0].range[1], .38);
  close(path.spans[1].range[0], .62);
  const left = result.paths.find(path => path.id === 'fold/0-2');
  const right = result.paths.find(path => path.id === 'fold/1-3');
  assert.deepEqual(left.spans.map(span => span.kind), ['silhouette']);
  assert.deepEqual(right.spans.map(span => span.kind), ['occlusion']);
  assert(!result.paths.some(path => path.objectId !== 'fold'));

  const shallow = compiled.extract({ camera, width: 200, height: 200, creaseAngle: 80 });
  assert.equal(ridge(shallow), undefined);
  const orbit = { ...camera, ortho: false, tangent: .45 };
  const perspective = compiled.extract({ camera: orbit, width: 200, height: 200 });
  assert.equal(ridge(perspective).id, path.id);
  assert(ridge(perspective).spans[0].range[1] < path.spans[0].range[1]);

  const backed = extract({ sources: [fold], camera, width: 200, height: 200 });
  assert.equal(backed.paths.find(item => item.id === right.id).spans[0].kind, 'silhouette');
});

test('edits keep their direction through an interrupted path, and hidden ink retains editable spans', () => {
  const result = extract({ sources: [fold, blocker], camera, width: 200, height: 200,
    styles: { silhouette: { visible: false } },
    edits: { 'fold/0-1': { width: 4, color: '#e6ad60', taper: [0, 1] } } });
  assert.equal(result.draw.length, 2);
  close(result.draw[0].weights[0], 0);
  close(result.draw[0].weights[1], .38);
  close(result.draw[1].weights[0], .62);
  close(result.draw[1].weights[1], 1);
  assert(result.draw.every(mark => mark.width === 4 && mark.color === '#e6ad60'));
  assert(result.paths.some(path => path.spans.some(span => !span.visible)));
  const { data } = KIT.procedural.drawing2d.render({ width: 200, height: 200, commands: result.draw, edges: 'hard' });
  assert.equal(data[(100 * 200 + 100) * 4 + 3], 0);
  assert.equal(data[(101 * 200 + 170) * 4 + 3], 255);
});

test('perspective keeps the clip and taper in the original edge parameter', () => {
  const plane = { id: 'plane', mesh: { points: [[-1,0,0],[1,0,6],[0,1,3]], faces: [[0,1,2]] } };
  const result = extract({ sources: [plane], camera: { ...camera, ortho: false, tangent: .5, clipNear: 3 },
    width: 200, height: 200, edits: { 'plane/0-1': { taper: [0,1] } } });
  const path = result.paths.find(path => path.id === 'plane/0-1');
  close(path.spans[0].range[1], 5 / 6);
  const line = result.draw.find(line => line.weights[0] === 0);
  assert.equal(line, path.spans[0].stroke);
  close(line.weights.at(-1), 5 / 6);
  close(line.points.at(-1)[0], 100 + 200 * (2 / 3) / 3);
});

test('a depth crossing clips a crease inside the projected occluder', () => {
  const slope = panel('slope', -1, 1, -.5, .5, 0);
  slope.mesh.points.forEach(point => { point[2] = point[0]; });
  const result = extract({ sources:[fold,slope], camera, width:200, height:200 });
  const ranges = ridge(result).spans.map(span => span.range);
  close(ranges[0][1], .5);
  close(ranges[1][0], .75);
});

test('indexed texture seams can weld without creating spurious lines', () => {
  const square = { id: 'welded', weld: true, mesh: {
    pos: new Float32Array([-1,-1,0, 1,-1,0, 1,1,0,  -1,-1,0, 1,1,0, -1,1,0]),
    tri: new Uint32Array([0,1,2,3,4,5])
  } };
  const options = { camera, width: 100, height: 100 };
  const result = extract({ sources: [square], ...options });
  assert.equal(result.paths.length, 4);
  assert(!result.paths.some(path => path.id === 'welded/0-2'));
  assert.equal(extract({ sources: [{ ...square, weld: false }], ...options }).paths.length, 6);
});

const layer = {
  directionDrawing: {
    sources: [fold, blocker, backing],
    styles: { crease: { color: '#fd7309', width: 5 }, silhouette: { color: '#f6e8ce', width: 5 },
      occlusion: { color: '#5becbe', width: 5 } }
  }
};
const cam = { target:[0,0,0], dist:8, yaw:0, pitch:0, ortho:true, fov:2*Math.atan(.25) };
const w = 96, h = 80;
const graph = { passes: [{ id:'draw-lines', type:'composite', layer }] };

test('direction drawing layers render headlessly in a mixed-resolution composite and a render graph', () => {
  const world = makeBuilder(1, [0x232735]).finish({ cam, radius: 8 });
  const base = { w,h,px:1,ortho:true,raw:true };
  const ref = ink.render(world, base);
  const result = ink.render(world, { ...base, composite: { world:{ resolution:2 }, layers:[layer] } });
  const byGraph = ink.render(world, { ...base, renderGraph:graph });
  assert.notDeepEqual(result.rgb, ref.rgb);
  const pixel = (frame,x,y) => Array.from(frame.rgb.slice((y*w+x)*3,(y*w+x)*3+3));
  assert.deepEqual(pixel(result,32,39), [253,115,9]);
  assert.deepEqual(pixel(byGraph,32,39), [253,115,9]);
  assert.deepEqual(pixel(result,48,39), pixel(ref,48,39));
});

function renderLines(toolkit, build, backend, [w,h,cam,layer,graph]) {
  const world = build(toolkit, cam);
  const draw = backend(w,h,{ raw:true,ortho:true,offscreen:true });
  try {
    const points = { line:[32,39], center:[48,39], contour:[86,31] };
    draw.draw(world,{ composite:{ world:{ resolution:2 }, layers:[layer] } });
    const composite = draw.sample(points);
    draw.draw(world,{ renderGraph:graph });
    return { composite, graph:draw.sample(points) };
  } finally { draw.close(); }
}

function lineWorld({ makeBuilder }, cam) {
  return makeBuilder(1, [0x232735]).finish({ cam, radius:8 });
}

test('WebGL shares projected line colors and depth masking', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, lineWorld, renderLines, [w,h,cam,layer,graph]);
  assert.deepEqual(result.composite.line, [253,115,9]);
  assert.notDeepEqual(result.composite.center, result.composite.line);
  assert.deepEqual(result.graph, result.composite);
});
