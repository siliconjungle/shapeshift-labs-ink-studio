const assert = require('node:assert/strict');
const test = require('node:test');
const studio = require('../index.js');
const { ArtInk, ArtStability, makeBuilder } = studio.load();

test('ink distinguishes silhouettes, creases, boundaries and protected palettes', () => {
  const palette = [0, 0x445566, 0x8e9fa4];
  const settings = ArtInk.prepare({
    silhouette: { color: '#110000' }, crease: { color: '#001100' }, boundary: { color: '#000011' },
    materials: { vapor: { palette: 'fog' } },
    reserved: { emission: ['#ffff00'], fog: ['#44ddff'] }
  }, palette);
  const w = 7, h = 5, size = w * h;
  const depth = new Float32Array(size).fill(3);
  const normal = new Float32Array(size * 3);
  const emission = new Float32Array(size * 3);
  const objectId = new Uint32Array(size).fill(1), materialId = new Uint32Array(size).fill(1);
  const splatId = Uint32Array.from(depth, (_, i) => i + 1);
  for (let i = 0; i < size; i++) normal[i * 3 + 1] = 1;
  const crease = 2 * w + 1, boundary = 2 * w + 3, sameMaterial = 1 * w + 1;
  normal.fill(0, (crease + 1) * 3, (crease + 2) * 3);
  normal[(crease + 1) * 3] = 1;
  objectId[boundary + 1] = 2;
  materialId[boundary + 1] = 2;
  objectId[sameMaterial + 1] = 2;
  materialId[3 * w + 2] = 3;
  emission[(3 * w + 5) * 3] = .9;
  const frame = ArtInk.apply({ w, h, rgb: new Uint8Array(size * 3).fill(89) },
    { depth, normal, emission, objectId, materialId, splatId, materials: [null, 'stone', 'metal', 'vapor'] },
    settings, palette);
  assert.equal(frame.inkMask[0], 1);
  assert.equal(frame.inkMask[crease], 2);
  assert.equal(frame.inkMask[boundary], 3);
  assert.equal(frame.inkMask[sameMaterial], 0);
  assert.equal(frame.inkMask[3 * w + 2], 4);
  assert.equal(frame.inkMask[3 * w + 5], 4);
  assert(frame.palette.includes(0xffff00));
  assert.equal(frame.use.reduce((a, b) => a + b), size);
});

test('occlusion silhouettes can replace a boundary at the near side of a depth break', () => {
  const palette = [0, 0x505050], w = 5, h = 5, size = w*h, center = 12;
  const depth = new Float32Array(size).fill(9), objectId = new Uint32Array(size).fill(2);
  depth[center] = 5;
  objectId[center] = 1;
  const passes = { depth, objectId, materialId: objectId, materials: [null,'cloth','stone'],
    normal: new Float32Array(size*3), emission: new Float32Array(size*3), splatId: Uint32Array.from(depth, (_,i)=>i+1) };
  const render = occlusionSilhouettes => ArtInk.apply({ w,h,rgb:new Uint8Array(size*3).fill(80) },passes,
    ArtInk.prepare({ occlusionSilhouettes, silhouette:{color:'#d29292'}, boundary:{color:'#49586b'} },palette),palette);
  assert.equal(render(false).inkMask[center],3);
  assert.equal(render(true).inkMask[center],1);
  assert.equal(render(true).inkMask[center+1],0);
});

test('scoped ink fades in camera depth without changing the subject or coverage in either projection', () => {
  const palette = [0x172234, 0x7e9298], b = makeBuilder(1,palette);
  for (const [x,z,label] of [[-2,1,'courier'],[0,-1,'middle'],[2,-4,'far']]) {
    const first = b.count();
    b.disc(x,0,z,[0,0,1],.6,.025,b.P[1],2);
    b.describeSplats(first,b.count(),{ object:label, material:'slate', target:{tags:['shared']} });
  }
  const ink = { silhouette:{color:'#101010'}, boundary:false, crease:false, materials:{slate:{silhouette:{color:'#7890a4'}}},
    targets:[{select:{tag:'shared'},distance:{near:7,far:11}},
      {select:{object:'courier'},silhouette:{color:'#d76f89',distance:false}},
      {select:{object:'middle'},silhouette:{color:'#d76f89'}}] };
  const world = b.finish({ cam:{target:[0,0,0],yaw:0,pitch:0,dist:8}, radius:6, dither:0, look:{ink} });
  for (const ortho of [false,true]) for (const colored of [false,true]) {
    const options = { w:110,h:70,px:1,ortho,colored,passes:['splatId','coverage'] };
    const result = studio.render(world,options), plain = studio.render(world,{...options,ink:{silhouette:false,crease:false,boundary:false}});
    assert.deepEqual(result.passes.coverage,plain.passes.coverage);
    const edge = id => result.passes.splatId.findIndex((owner,p)=>owner===id && result.inkMask[p]===1);
    const courier = edge(1), middle = edge(2);
    assert(courier>=0 && middle>=0 && result.passes.splatId.includes(3));
    assert.deepEqual(Array.from(result.rgb.slice(courier*3,courier*3+3)),[215,111,137]);
    for (let lane=0; lane<3; lane++) {
      const at=middle*3+lane, source=plain.rgb[at], target=[215,111,137][lane];
      assert.equal(result.rgb[at],Math.round((source+target)/2));
    }
    assert.equal(edge(3),-1);
  }
  assert.throws(()=>ArtInk.prepare({distance:{near:8,far:7}},palette),/0 <= near <= far/);
  assert.throws(()=>ArtInk.prepare({targets:[{select:{name:'courier'}}]},palette),/Invalid target selector/);
});

test('orthographic snap is optional and anchored positions follow analytic motion', () => {
  const b = makeBuilder(1, [0, 0x445566, 0x8e9fa4]);
  b.disc(0, 0, 0, [0, 0, 1], .18, .04, b.P[1], 3, { k: 6, rg: .45, sp: 1 });
  b.describeSplats(0, 1, { object: 'eye', material: 'detail' });
  const world = b.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 5 } });
  const options = { w: 64, h: 64, px: 1, ortho: true };
  const snap = { ...options, stable: { snap: true } };
  const atOrigin = studio.render(world, snap).rgb;
  assert.deepEqual(studio.render(world, { ...snap, target: [.015, .01, 0] }).rgb, atOrigin);
  assert.notDeepEqual(studio.render(world, { ...snap, target: [.1, .07, 0] }).rgb, atOrigin);

  const passes = ['splatId', 'position', 'objectPosition'];
  const frame = studio.render(world, { ...options, t: Math.PI / 2, passes });
  const hit = frame.passes.splatId.indexOf(1), p = hit * 3;
  assert(hit >= 0);
  assert(Math.abs(frame.passes.position[p + 1] - frame.passes.objectPosition[p + 1] - .45) < 1e-6);
  const anchored = ArtStability.prepare({ dither: 'object', spacing: .1 });
  assert.notDeepEqual(ArtStability.ditherCoordinates(anchored, frame.passes, hit, 10, 9), [10, 9]);

  const clusters = studio.render(world, { ...options, stable: { resolve: 'clusters', protect: ['eye'] } });
  assert(clusters.detail.some(Boolean));
  assert(clusters.rgb.some(Boolean));
  assert.equal(clusters.rgb.length, 64 * 64 * 3);
});

test('glow and haze use emissive sources and protect nearer surfaces', () => {
  const { ArtEffects } = studio.load();
  const w = 11, h = 7, size = w * h, palette = [0x001122, 0x112233, 0x405060];
  const rgb = Uint8Array.from({ length: size * 3 }, (_, j) => 16 + 6 * (Math.floor(j / 3) % w));
  const depth = new Float32Array(size).fill(6);
  const emission = new Float32Array(size * 3);
  const emissionDepth = new Float32Array(size).fill(Infinity);
  const source = w * 4 + 5;
  emission[source * 3] = .9;
  emissionDepth[source] = 4;
  depth[source - 1] = 2;
  const passes = { w, h, depth, emission, emissionDepth, materialId: new Uint32Array(size), materials: [null] };
  const setup = ArtEffects.prepare({ heat: { radius: 4, up: 2, pixels: 2 },
    glow: { colors: ['#993322', '#ee8844'], radius: 2 }, emitter: { colors: ['#ffff00'] } }, palette);
  const frame = ArtEffects.apply({ w, h, rgb: rgb.slice() }, passes, setup, .31, { palette });
  assert.deepEqual(frame.rgb.slice((source - 1) * 3, source * 3), rgb.slice((source - 1) * 3, source * 3));
  assert.equal(frame.effectsMask[source - 1], 0);
  assert.equal(frame.effectsMask[source], 4);
  assert(frame.effectsMask.includes(1));
  assert(frame.effectsMask.includes(2));
  assert(!frame.effectsMask[0]);
});

test('motion, trails and stepped smears consume an explicit render history', () => {
  const { ArtEffects } = studio.load();
  const palette = [0, 0xcc6655, 0xffdd99];
  const b = makeBuilder(1, palette);
  b.disc(0, 0, 0, [0, 0, 1], .11, .03, b.P[2], 1.5, { em: true, k: 6, rg: .80, sp: 5 });
  const world = b.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 5 }, look: {
    effects: { trail: { duration: .6 }, smear: { duration: .6, reach: 36 } }
  } });
  const artHistory = ArtEffects.history();
  const opts = { w: 56, h: 56, px: 1, ortho: true, captureMotion: true,
    passes: ['motion', 'emissionMotion'], artHistory };
  const first = studio.render(world, { ...opts, t: 0 });
  assert(!first.effectsMask.some(Boolean));
  const second = studio.render(world, { ...opts, t: .3, motionFrom: first.motionReference });
  assert(second.passes.motion.some(value => value < -5));
  assert(second.passes.emissionMotion.some(value => value < -5));
  assert(second.effectsMask.includes(3));
  const withoutHistory = studio.render(world, { ...opts, t: .3, artHistory: null });
  assert(!withoutHistory.effectsMask.some(Boolean));
  assert.notDeepEqual(second.rgb, withoutHistory.rgb);
});
