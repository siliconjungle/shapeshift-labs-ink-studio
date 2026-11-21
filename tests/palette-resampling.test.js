const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const sampling = require('../src/palette-resampling.js');
const kit = ink.load();

function fixture({ makeBuilder, SpriteSurface }) {
  const builder = SpriteSurface.make(256);
  const low = 0x243447, high = 0xe1c6a0, neutral = 0x837d74, accent = 0xec4f28;
  const checker = builder.reserve(128, 64, (x, y) => x === 64 ? accent : (x + y) % 2 ? low : high);
  const spare = builder.reserve(128, 64, () => 0x3cd0d1);
  builder.faceRegion([-2.5,-1.5,0], [5,0,-1.5], [0,3,-1.3], checker, {
    id:'panel', sampling:{ palette:[neutral,low,high,accent,0x3cd0d1], protect:[accent], protectCoverage:.24 }
  });
  const atlas = builder.finish();
  const world = makeBuilder(3,[0x162133]).finish({
    cam:{ target:[0,0,0], dist:9, fov:.8, yaw:0, pitch:0, ortho:false }, spriteSurfaces:atlas
  });
  const points = { left:[42,45], mid:[63,45], near:[81,43], low:[64,52], high:[53,32], outside:[14,15] };
  return { world, atlas, checker, spare, points, accent };
}

const w = 128, h = 90, view = { w,h,px:1,raw:true };
const unpack = rgb => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
const byte = packed => [packed >>> 16, (packed >>> 8) & 255, packed & 255];

test('area weights cover whole and partial texels while keeping magnified art exact', () => {
  const pixels = Uint8Array.of(255,0,0,255,0,0,0,255,255,255,255,255,0,0,0,0);
  const atlas = { width:4, height:1, pixels }, rect = { x:0,y:0,width:4,height:1 };
  const rule = sampling.settings({ palette:['#777777','#ff0000','#000000','#ffffff'], protect:['#ff0000'], protectCoverage:.19 });
  const pick = sampling.sampler(sampling.compile(atlas, rect, rule));
  assert.equal(pick(.5,.5,.9,0,0,.8), undefined);
  assert.equal(pick(1.7,.5,2.4,0,0,1), 0xff0000);
  assert.equal(pick(2,.5,1.2,0,0,1), 0x777777);
  assert.equal(pick(3.4,.5,1.4,0,0,1), null);
});

test('an oblique textured panel keeps its protected guide and reduces pan shimmer', () => {
  const { world, accent } = fixture(kit);
  const motion = Array.from({ length: 8 }, (_, i) => [-.09 + i * .024,0,0]);
  const shot = paletteSampling => motion.map(target => ink.render(world, { ...view,target,paletteSampling }).rgb);
  const precise = shot(true), nearest = shot(false);
  function changes(sequence) {
    let total = 0;
    for (let i = 1; i < sequence.length; i++) for (let y = 33; y < 54; y++) for (let x = 43; x < 86; x++) {
      const p = (y*w+x)*3;
      if (unpack(sequence[i].subarray(p,p+3)) !== unpack(sequence[i-1].subarray(p,p+3))) total++;
    }
    return total;
  }
  assert(changes(precise) < changes(nearest) / 4, JSON.stringify([changes(precise),changes(nearest)]));
  for (const picture of precise) {
    let hits = 0;
    for (let p = 0; p < picture.length; p += 3) if (unpack(picture.subarray(p,p+3)) === accent) hits++;
    assert(hits > 8);
  }
  const allowed = new Set([0x162133,0x837d74,0x243447,0xe1c6a0,accent]);
  for (let p = 0; p < precise[4].length; p += 3) assert(allowed.has(unpack(precise[4].subarray(p,p+3))));
});

test('palette footprints respect atlas cells, slips, updates and transparent cutouts', () => {
  const { world, atlas, spare, points } = fixture(kit);
  const get = ([x,y]) => Array.from(ink.render(world,view).rgb.subarray((y*w+x)*3,(y*w+x)*3+3));
  const before = get(points.left);
  assert.deepEqual(before, byte(0x837d74));
  kit.SpriteSurface.uvSlip(atlas, [{ face:'panel', to:spare, flipU:true }]);
  assert.deepEqual(get(points.left), byte(0x3cd0d1));
  const rgba = new Uint8Array(spare.width * spare.height * 4);
  kit.SpriteSurface.update(atlas, spare, { w:spare.width, h:spare.height, rgba });
  assert.deepEqual(get(points.left), byte(0x162133));
  kit.SpriteSurface.uvSlip(atlas, []);
  assert.deepEqual(get(points.left), before);
});

test('procedural surface nodes retain the authored sampling rule', () => {
  const { rasterWarp } = kit.KIT.procedural;
  const source = { width:2,height:1,channels:4,data:Uint8Array.of(18,35,52,255,255,234,175,255) };
  const mesh = { points:[[-1,-1,0],[1,-1,0],[1,1,0]], uvs:[[0,1],[1,1],[1,0]], faces:[[0,1,2]] };
  const atlas = rasterWarp.surface(source, mesh, { sampling:{ palette:['#122334','#ffeaaf'], protect:['#ffeaaf'] } });
  const [range] = kit.SpriteSurface.samplingPlan(atlas);
  assert.deepEqual(range.filter.colors, [0x122334,0xffeaaf]);
  assert.deepEqual(range.filter.rule.protect, [0xffeaaf]);
});

test('native WebGL matches software for angled palette footprints and a live atlas update', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, fixture, (toolkit, build, backend, [w,h]) => {
    const { world, atlas, spare, points } = build({ ...toolkit, SpriteSurface });
    const draw = backend(w,h,{ raw:true,offscreen:true });
    try {
      const values = [];
      for (const target of [[0,0,0],[-.07,0,0],[.075,0,0]]) {
        draw.draw(world,{camera:{target}});
        values.push(draw.sample(points));
      }
      SpriteSurface.uvSlip(atlas,[{face:'panel',to:spare,flipU:true}]);
      draw.draw(world);
      values.push(draw.sample(points));
      SpriteSurface.update(atlas,spare,{w:spare.width,h:spare.height,rgba:new Uint8Array(spare.width*spare.height*4)});
      draw.draw(world);
      values.push(draw.sample(points));
      return { values };
    } finally { draw.close(); }
  }, [w,h]);
  const { world, atlas, spare, points } = fixture(kit);
  function sample(target) {
    const { rgb } = ink.render(world,{...view,target});
    return Object.fromEntries(Object.entries(points).map(([name,[x,y]]) => [name,[...rgb.subarray((y*w+x)*3,(y*w+x)*3+3)]]));
  }
  const expected = [[0,0,0],[-.07,0,0],[.075,0,0]].map(sample);
  kit.SpriteSurface.uvSlip(atlas,[{face:'panel',to:spare,flipU:true}]);
  expected.push(sample());
  kit.SpriteSurface.update(atlas,spare,{w:spare.width,h:spare.height,rgba:new Uint8Array(spare.width*spare.height*4)});
  expected.push(sample());
  assert.deepEqual(result.values,expected);
});
