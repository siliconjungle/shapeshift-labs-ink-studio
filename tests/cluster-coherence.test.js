const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const { KIT } = ink.load();
const api = KIT.colorClusters;
const h = 9, w = 14, size = w * h;
const base = 0x526377, light = 0xffc581, shadow = 0x283449;
const settings = options => ({ targets:[{ select:{ material:'enamel' }, minPixels:1,
  protect:{ boundaries:false }, coherence:[{ swatches:['#ffc581'], ...options },
    { swatches:['#283449'], holdFrames:0, splitFrames:1, mergeFrames:1 }] }] });

function cells(x0, x1, y0, y1) {
  const result = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) result.push(y*w+x);
  return result;
}

const left = cells(2,4,3,5), right = cells(7,9,3,5), bridge = cells(5,6,4,4);
const joined = [...left,...bridge,...right], divided = [...left,...right];
const plate = { count:2, data:new Float32Array(32), renderMetadata: {
  objects:[null,'panel','occluder'], materials:[null,'enamel','copper'],
  objectIds:Uint32Array.of(1,2), materialIds:Uint32Array.of(1,2)
} };

const at = (rgb, p) => rgb[p*3] << 16 | rgb[p*3+1] << 8 | rgb[p*3+2];
function fixture(options) {
  const history = api.history(), plan = api.prepare(settings(options));
  let time = 0;
  return (lit, forFrame = {}) => {
    const rgb = new Uint8Array(size*3), splatId = new Uint32Array(size).fill(1);
    const litPixels = new Set(lit), dark = new Set(forFrame.shadow ?? []), locks = new Uint8Array(size);
    for (let p = 0; p < size; p++) {
      const color = litPixels.has(p) ? light : dark.has(p) ? shadow : base;
      rgb.set([color>>16,color>>8&255,color&255],p*3);
    }
    for (const p of forFrame.owners ?? []) splatId[p] = 2;
    for (const p of forFrame.protected ?? []) locks[p] = 1;
    return api.apply({ w,h,rgb }, { splatId, protected:locks, ...(forFrame.passes ?? {}) }, plan, plate,
      { history,time:time++,captureLabels:true,...forFrame });
  };
}

test('a split and a join wait for confirmation and keep the strongest overlapping ID', () => {
  const draw = fixture({ splitFrames:2,mergeFrames:2,holdFrames:0 });
  const original = draw(joined).tracking.clusters[0].id;
  const pending = draw(divided);
  assert.equal(pending.tracking.deferredSplits,1);
  assert.equal(pending.tracking.editedPixels,2);
  assert.equal(pending.tracking.labels[bridge[0]],original);
  assert.equal(at(pending.rgb,bridge[0]),light);
  const split = draw(divided).tracking;
  assert.equal(split.clusters.length,2);
  const child = split.clusters[1].id;
  assert.deepEqual(split.events,[{type:'split',from:[original],to:[original,child]}]);
  const paused = draw(joined);
  assert.equal(paused.tracking.deferredMerges,1);
  assert.equal(paused.tracking.labels[bridge[0]],0);
  assert.equal(at(paused.rgb,bridge[0]),base);
  const merged = draw(joined).tracking;
  assert.deepEqual(merged.events,[{type:'merge',from:[original,child],to:[original]}]);
  assert.equal(merged.clusters[0].area, joined.length);
});

test('short losses and births use distinct clocks for each tracked swatch', () => {
  const draw = fixture({ holdFrames:2,birthFrames:2 });
  const original = draw(left).tracking.clusters[0].id;
  const hold = draw([], {shadow:right}).tracking;
  assert.equal(hold.heldPixels,left.length);
  assert(hold.clusters.find(part=>part.id===original).held);
  const recovered = draw(left).tracking;
  assert.equal(recovered.clusters[0].id,original);
  assert(!recovered.clusters[0].held);
  assert.equal(draw([], {shadow:right}).tracking.clusters.filter(part=>part.swatch==='#283449').length,1);
  assert.equal(draw([]).tracking.clusters.length,1);
  const missing = draw([]).tracking;
  assert.deepEqual(missing.events,[{type:'disappear',from:[original],to:[]}]);
  const born = draw(left);
  assert.equal(born.tracking.deferredBirths,1);
  assert.equal(at(born.rgb,left[0]),base);
  const approved = draw(left).tracking;
  assert.equal(approved.events[0].type,'appear');
  assert(approved.clusters[0].id>original);
});

test('holds stop at protected pixels, different owners and changed palette ownership', () => {
  const draw = fixture({ holdFrames:4 });
  const paletteOwner = new Uint32Array(size).fill(1);
  const paletteOwners = [null,{name:'plate',colors:[base,light]},{name:'alternate',colors:[base,shadow]}];
  const first = draw(left,{passes:{paletteOwner,paletteOwners}}).tracking;
  assert.equal(first.clusters.length,1);
  const locked = left[0], other = left[1], different = left[2];
  const next = paletteOwner.slice();
  next[different] = 2;
  const kept = draw([], {owners:[other], protected:[locked], passes:{paletteOwner:next,paletteOwners}});
  for (const p of [locked,other,different]) {
    assert.equal(kept.tracking.labels[p],0);
    assert.equal(at(kept.rgb,p),base);
  }
  assert.equal(kept.tracking.heldPixels,left.length-3);
});

test('camera reprojection tracks translated patches without screen overlap and resets on seeking', () => {
  const draw = fixture({ holdFrames:1 });
  const camera = shift => ({ view:[1,0,0,0,0,1,0,0,0,0,1,0,shift,0,-8,1],
    tangent:h/2, ortho:true });
  const project = shift => api.projector(camera(shift), () => [0,0,0]);
  const initial = draw(left,{project:project(0)}).tracking;
  const moved = left.map(p=>p+5);
  const translated = draw(moved,{project:project(5)}).tracking;
  assert.equal(translated.clusters[0].id,initial.clusters[0].id);
  assert.deepEqual(translated.clusters[0].center,[initial.clusters[0].center[0]+5,initial.clusters[0].center[1]]);
  const held = draw([],{project:project(5)}).tracking;
  assert.equal(held.labels[moved[0]],initial.clusters[0].id);
  assert.equal(draw([],{project:project(5),time:-1}).tracking.clusters.length,0);
  assert.throws(() => api.prepare(settings({ splitFrames:0 })), /frame counts/);
});

function panel({ makeBuilder }) {
  const colors = [0x101624,0x526377,0xffc581];
  const B = makeBuilder(23, colors);
  const lit = [];
  const start = B.count();
  for (let y = -5; y <= 5; y++) for (let x = -8; x <= 8; x++) {
    const accent = Math.abs(x) <= 3 && Math.abs(y) <= 1;
    if (accent) lit.push(B.count());
    B.disc(x*.23,y*.23,0,[0,0,1],.14,.012,B.P[accent ? 2 : 1],3);
  }
  B.describeSplats(start,B.count(),{object:'panel',material:'enamel'});
  const world = B.finish({ cam:{ target:[0,0,0],dist:7,yaw:0,pitch:0,ortho:true }, radius:7, dither:0 });
  return { world, lit, fill:B.P[1][0] + 256*B.P[1][1] + 65536*B.P[1][2] };
}

const authored = settings({ holdFrames:1 }), native = { w:84,h:56,px:1,ortho:true,dither:0,outline:false };
test('headless render keeps authored highlights for one frame and preserves the owner pass', () => {
  const { world, lit, fill } = panel(ink.load());
  world.look = { colorClusters:authored };
  const options = { ...native, colorClusterHistory:api.history(), captureColorClusterLabels:true, passes:['splatId'] };
  const first = ink.render(world,{...options,t:0});
  assert(first.colorClusters.tracking.clusters.length);
  for (const i of lit) world.data[i*16+7] = fill;
  const stable = ink.render(world,{...options,t:1/24,target:[.06,0,0]});
  const later = ink.render(world,{...options,t:2/24,target:[.06,0,0]});
  const unstyled = ink.render(world,{...options,colorClusters:false,t:3/24,target:[.06,0,0]});
  assert(stable.colorClusters.tracking.heldPixels>20);
  assert.equal(later.colorClusters.tracking.heldPixels,0);
  assert.deepEqual(later.rgb,unstyled.rgb);
  assert.deepEqual(stable.passes.splatId,unstyled.passes.splatId);
  assert.equal(stable.colorClusters.tracking.clusters[0].id,first.colorClusters.tracking.clusters[0].id);
});

function browserFrames(toolkit, build, backend, [w,h,settings]) {
  const { world, lit, fill } = build(toolkit);
  const draw = backend(w,h,{ ortho:true,dither:0,outline:false,offscreen:true });
  let summary;
  function frame(t, reset = false) {
    draw.draw(world,{ t,changedRows:undefined,colorClusters:settings, resetColorClusters:reset,
      captureColorClusterLabels:true, colorClustersFrame:report=>{ summary = report.tracking; } });
    return { ids:summary.clusters.map(cluster=>cluster.id), held:summary.heldPixels,
      color:draw.sample({center:[w>>1,h>>1]}).center };
  }
  try {
    const first = frame(0);
    for (const i of lit) world.data[i*16+7] = fill;
    return { first, held:frame(1/24), expired:frame(2/24) };
  } finally { draw.close(); }
}

test('WebGL applies the same hold and publishes native labels', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, panel,browserFrames,[native.w,native.h,authored]);
  assert.deepEqual(result.held.color,result.first.color);
  assert.deepEqual(result.held.ids,result.first.ids);
  assert(result.held.held>20);
  assert.notDeepEqual(result.expired.color,result.held.color);
  assert.equal(result.expired.held,0);
});
