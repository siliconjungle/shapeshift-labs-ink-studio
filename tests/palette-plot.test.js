const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('..');
const { KIT:K, makeBuilder } = load();
const close = (a,b) => assert(Math.abs(a-b)<1e-6, `${a} != ${b}`);

test('RGB cube follows RGB axes and OKLab plot keeps a common scale on all axes', () => {
  const palette = ['#000000','#ffffff','#ff0000','#00ff00','#0000ff'];
  const rgb = K.palette.plot({palette,size:2}), lab = K.palette.plot({palette,space:'oklab',size:2});
  assert.deepEqual(rgb.points.map(row=>row.position),[[-1,-1,-1],[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]]);
  assert.deepEqual(rgb.axes.map(a=>a.label),['R','G','B']);
  assert.deepEqual(lab.axes.map(a=>a.label),['a','L','b']);
  const red = lab.points[2], blue = lab.points[4];
  red.coordinates.forEach((value,i)=>close(value,[.62795536,.22486306,.12584630][i]));
  close(Math.hypot(...red.coordinates.map((n,i)=>n-blue.coordinates[i]))*2,
    Math.hypot(...red.position.map((n,i)=>n-blue.position[i])));
  assert.throws(()=>K.palette.plot({palette:[new Array(3)]}),/finite RGB/);
  assert.throws(()=>K.palette.plot({palette,space:'hsl'}),/rgb or oklab/);
});

test('plot geometry emits true swatches at a translated and scaled position with optional frame metadata', () => {
  const builder = makeBuilder(1,[0x000000]);
  const plot = K.palette.plot({palette:['#ff0000','#123789'],size:2,frame:'off'});
  assert.deepEqual(plot.emit(builder,{origin:[3,3,3],scale:2,id:'instrument'}),[]);
  const world = builder.finish();
  assert.equal(world.count,2);
  assert.deepEqual(Array.from(world.data.slice(0,3)),[5,1,1]);
  assert.equal(world.data[7],0x0000ff);
  assert(world.renderMetadata.objects.includes('instrument'));
  const withFrame = K.palette.plot({palette:['#ff0000']});
  const B = makeBuilder(1,[0x000000]);
  const labels = withFrame.emit(B,{origin:[1,0,0]});
  assert.deepEqual(labels.map(row=>row.label),['R','G','B']);
  assert(B.count()>1);
});
