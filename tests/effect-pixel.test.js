const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const scene = require('../examples/material-response/scene.cjs');

const w = 336, h = 192, time = 3.18;
const points = { ripple: [150,98], cart: [189,104], weak: [151,98], sky: [0,0] };
const water = report => report.passes.find(pass => pass.material === 'water');
const hex = rgb => '#' + rgb.map(value => value.toString(16).padStart(2,'0')).join('');

test('field traces keep the exact stored value and the strongest stamp on a stable snapshot', () => {
  const field = ink.load().KIT.splatEffects.field({ width: 8, height: 8, cell: 1, channels: { mark: {} } });
  const stamp = (source, amount) => ({ at: [2.5, 3.5], radius: 1, values: { mark: amount }, source });
  field.stampMany([stamp('weak',.2), stamp('first',.7), stamp('equal',.7)]);
  const frame = field.frame(0);
  assert.deepEqual(frame.traceCell('mark',2,3), {
    value: frame.data('mark')[3 * 8 + 2], uv: [2.5,3.5], contributors: 3, source: 'first'
  });
  field.stamp(stamp('new',.9));
  assert.equal(field.frame(0).traceCell('mark',2,3).source, 'new');
  field.clear();
  assert.equal(frame.traceCell('mark',2,3).source, 'first');
  assert.equal(field.frame(0).traceCell('mark',2,3).value, 0);
});

test('headless traces a swatch to the receiver, field texel and exact contact', () => {
  const world = ink.load().KIT.diorama.build(scene());
  const read = (at,t = time) => {
    world.anim.update(0,t);
    return ink.inspectEffectPixel(world, { at,t,w,h,px:1 });
  };
  const report = read(points.ripple);
  assert.equal(report.outputSwatch,'#a8dfcf');
  assert.equal(report.receiver.material,'water');
  assert.equal(report.winner.event.id,'wheel-2');
  assert.equal(report.winner.event.interaction,'roll');
  assert.equal(report.winner.matchesOutput,true);
  assert(water(report).cell.every(Number.isInteger));
  assert(water(report).channels[0].sample.value >= water(report).channels[0].threshold);
  const rejected = read(points.cart);
  assert.equal(rejected.receiver.object,'cart');
  assert.equal(rejected.winner,null);
  assert.equal(water(rejected).reason,'receiver-mismatch');
  assert.deepEqual(water(rejected).select,{ material:'water' });
  const weak = water(read(points.weak));
  assert.equal(weak.reason,'below-threshold');
  assert(weak.channels[0].sample.value > 0 && weak.channels[0].sample.value < weak.channels[0].threshold);
  assert.equal(water(read(points.sky)).reason,'no-visible-receiver');
  assert.equal(water(read(points.ripple,0)).reason,'no-active-stamp');
  assert.deepEqual(read(points.ripple),report);
});

test('WebGL reports the actual drawn swatch and rejects the cart without changing the frame', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, ({ KIT }, data) => KIT.diorama.build(data),
    (kit, make, backend, { data, points, w, h, time }) => {
      const world = make(kit,data), draw = backend(w,h,{ offscreen:true });
      try {
        world.anim.update(0,time);
        draw.draw(world,{ time });
        const original = draw.sample(points);
        const ripple = draw.draw(world,{ time,effectPixel:points.ripple }).effectPixel;
        const cart = draw.draw(world,{ time,effectPixel:points.cart }).effectPixel;
        const after = draw.sample(points);
        world.anim.update(0,0);
        const early = draw.draw(world,{ time:0,effectPixel:points.ripple }).effectPixel;
        world.anim.update(0,time);
        const again = draw.draw(world,{ time,effectPixel:points.ripple }).effectPixel;
        return { original,after,ripple,cart,early,again };
      } finally { draw.close(); }
    }, { data:scene(),points,w,h,time });
  assert.deepEqual(result.original,result.after);
  assert.equal(result.ripple.backend,'webgl');
  assert.equal(result.ripple.outputSwatch,hex(result.after.ripple));
  assert.equal(result.ripple.winner.event.id,'wheel-2');
  assert.equal(result.ripple.receiver.material,'water');
  assert.match(water(result.ripple).reason,/^applied$/);
  assert.equal(result.cart.outputSwatch,hex(result.after.cart));
  assert.equal(result.cart.receiver.object,'cart');
  assert.equal(water(result.cart).reason,'receiver-mismatch');
  assert.equal(result.early.winner,null);
  assert.deepEqual(result.ripple,result.again);
});

test('the CLI returns agent-readable inspection JSON for the requested pixel', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'ink-effect-inspection-'));
  try {
    const source = path.join(dir,'silt-lock.json');
    writeFileSync(source,JSON.stringify(scene()));
    const output = execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),
      'effect','inspect',source,'--w',String(w),'--h',String(h),'--px','1','--t',String(time),'--at',points.ripple.join(',')],
    { encoding:'utf8',stdio:['ignore','pipe','pipe'] });
    const report = JSON.parse(output);
    assert.equal(report.format,'ink-studio/effect-pixel');
    assert.deepEqual(report.pixel,points.ripple);
    assert.equal(report.winner.event.id,'wheel-2');
  } finally { rmSync(dir,{ recursive:true,force:true }); }
});
