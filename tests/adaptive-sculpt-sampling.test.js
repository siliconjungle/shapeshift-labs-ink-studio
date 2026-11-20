const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const sampling = require('../src/sculpt-sampling.js');
const kit = ink.load();
const lantern = require('../examples/adaptive-lantern.js')(kit);

function allocation(world) {
  const { objectIds, objects, normals } = world.renderMetadata;
  const counts = { frame:0, handle:0, flat:0, glass:0 };
  for (let i = 0; i < world.count; i++) {
    const part = objects[objectIds[i]], row = i * 16;
    if (part === 'frame' || part === 'handle' || part === 'glass') counts[part]++;
    if (part === 'plinth' && normals[i * 3 + 1] > .98 &&
        Math.abs(world.data[row]) < 1.9 && Math.abs(world.data[row + 2]) < .95) counts.flat++;
  }
  return counts;
}

test('adaptive baking reallocates splats from a flat face to the lantern frame and handle', () => {
  const build = adaptiveSampling => lantern.build(lantern.seed, { controls:{plinth:true, adaptiveSampling} });
  const uniform = build(false), adaptive = build();
  const a = allocation(uniform), b = allocation(adaptive);
  assert(b.flat < a.flat * .4);
  assert(b.frame > a.frame * 1.3);
  assert(b.handle > a.handle * 1.25);
  assert.equal(a.glass,b.glass);
  assert(Math.abs(adaptive.count / uniform.count - 1) < .03);
  assert.deepEqual(build().data,adaptive.data);
});

test('the lantern keeps an open handle and visible uprights at 32 art pixels tall', () => {
  const world = lantern.build(lantern.seed);
  const { alpha, passes } = ink.render(world, { w:48, h:48, px:1, raw:true, transparent:true, passes:['objectId'] });
  const coveredRows = Array.from({length:48}, (_, y) => alpha.subarray(y*48,(y+1)*48).some(v => v>.5));
  assert.equal(coveredRows.filter(Boolean).length,32);
  assert(alpha[13*48+23]<.12 && alpha[13*48+24]<.12);
  const handle = passes.objects.indexOf('handle'), frame = passes.objects.indexOf('frame');
  assert(handle>0 && frame>0);
  assert.equal(passes.objectId[13*48+22],handle);
  assert.equal(passes.objectId[13*48+25],handle);
  for (let y = 24; y <= 28; y++) {
    const row = passes.objectId.subarray(y*48,(y+1)*48);
    assert(row.slice(14,22).includes(frame) && row.slice(26,35).includes(frame));
  }
});

test('curvature controls refinement and view hints favor curved silhouettes', () => {
  const settings = sampling.prepare({ curvature:.22, views:[[0,0,4]] });
  const measure = (field, definition = settings) => sampling.detail(definition, field, .22, 0, 1,0,0,1,0,0);
  assert.equal(measure(x => x - 1),0);
  const curved = (x,y,z) => Math.hypot(x,y,z) - 1;
  assert(measure(curved) > measure(curved,sampling.prepare({curvature:.22})));
  assert.throws(() => sampling.prepare({ views:[[0,0,0]] }),/nonzero length/);
});

test('JSON scene bakes accept adaptive sampling and retain the uniform default', () => {
  const spec = { id:'sampling-test', finish:{res:.12}, solids:[
    {kind:'box',at:[0,0,0],half:[2.4,.12,1.9],mat:'stone'}
  ] };
  const orig = kit.KIT.diorama.build(spec);
  assert.deepEqual(kit.KIT.diorama.build({...spec,finish:{...spec.finish,adaptiveSampling:false}}).data,orig.data);
  const adapted = kit.KIT.diorama.build({...spec,finish:{...spec.finish,adaptiveSampling:true}});
  assert.notEqual(adapted.count,orig.count);
  const bad = {...spec,finish:{...spec.finish,adaptiveSampling:{fine:0}}};
  assert.throws(() => kit.KIT.diorama.build(bad),/finish\.adaptiveSampling.*fine/s);
});
