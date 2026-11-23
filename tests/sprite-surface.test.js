const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('../src/sprite-surface.js');
const { rasterize } = require('../cli/sprite-surfaces.js');

test('surface texels stay aligned to the authored world-space face', () => {
  const atlas = make(4, 6);
  atlas.face([2,3,4], [2,0,0], [0,1,0], 3, 2, (x,y) => x === 0 && y === 0 ? 0x12abef : x === 2 ? null : 0x091524);
  atlas.face([6,7,8], [0,0,2], [0,1,0], 2, 1, () => 0xff4939);
  const sprite = atlas.finish();
  assert.equal(sprite.width, 4);
  assert.equal(sprite.height, 3);
  assert.deepEqual(Array.from(sprite.pixels.slice(0, 4)), [0x12,0xab,0xef,255]);
  assert.equal(sprite.pixels[2 * 4 + 3], 0);
  assert.deepEqual(Array.from(sprite.pixels.slice(32, 36)), [255,73,57,255]);
  assert.deepEqual(Array.from(sprite.vertices.slice(0, 15)),
    [2,4,4,.5,.5, 4,4,4,2.5,.5, 2,3,4,.5,1.5]);
  assert.equal(sprite.vertices.length, 60);
});

test('atlas capacity errors leave a valid batch', () => {
  const atlas = make(4, 3), draw = () => 0;
  atlas.face([0,0,0],[4,0,0],[0,3,0],4,3,draw);
  assert.throws(() => atlas.face([0,0,0],[1,0,0],[0,1,0],1,1,draw), /full/);
});

test('normal maps pack with color and reserve failures leave the shelf intact', () => {
  const pack = make(4, 4);
  assert.throws(() => pack.reserve(2, 2, undefined, { normal: () => [0, 0, 0] }), /nonzero XYZ/);
  assert.throws(() => pack.reserve(2, 2, undefined, { normal: new Uint8Array(4) }), /matching/);
  const brick = pack.reserve(2, 2, () => 0x12587b, { normal: x => x ? null : [8, 0, 0] });
  const encoded = new Uint8ClampedArray(16).fill(42);
  pack.reserve(2, 2, undefined, { normal: encoded });
  encoded.fill(0);
  pack.reserve(4, 1);
  const atlas = pack.finish();
  assert.deepEqual([brick.x, brick.y], [0,0]);
  assert.deepEqual([...atlas.normalPixels.subarray(0,16)], [255,128,128,255,0,0,0,0,42,42,42,42,42,42,42,42]);
  assert.ok(atlas.normalPixels.subarray(32).every(n => n===0));
  assert.equal(make(4).finish().normalPixels, undefined);
});

test('tile normals turn with the UV frame and preserve depth and cutouts', () => {
  const pack = make(8);
  const region = pack.reserve(4,4,(x,y) => x===0&&y===0 ? undefined : 0x315964,
    { normal: (_x,y) => y<2 ? [1,0,1] : [0,1,1] });
  pack.faceRegion([-3,-1,0],[2,0,0],[0,2,0],region);
  pack.faceRegion([1,-1,0],[-2,0,0],[0,2,0],region);
  pack.faceRegion([3,-1,0],[0,2,0],[-2,0,0],region);
  const atlas = pack.finish(), W = 48;
  const frame = { W,H:32,V:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-8,1],focal:8,ortho:true,near:.4 };
  const flat = rasterize(atlas,{...frame,surfaceNormals:false});
  const mapped = rasterize(atlas,frame);
  const shape = fragments => fragments.map(({p,z,color}) => [p,z,color]);
  assert.deepEqual(shape(mapped),shape(flat));
  const samples = new Map(mapped.map(({p,normal}) => [p,normal]));
  const expect = (x,y,n) => {
    const actual = samples.get(y*W+x);
    assert.ok(actual && n.every((v,k) => Math.abs(actual[k]-v)<1e-6), JSON.stringify(actual));
  };
  const d = Math.SQRT1_2;
  expect(7,19,[d,0,d]);
  expect(7,12,[0,d,d]);
  expect(23,19,[-d,0,d]);
  expect(36,16,[0,d,d]);
  expect(43,16,[-d,0,d]);
  assert.ok(flat.every(({normal}) => normal[0]===0 && normal[1]===0 && normal[2]===1));
});

function tileWithMovingLight({ SpriteSurface, makeBuilder }) {
  const pack = SpriteSurface.make(8);
  const region = pack.reserve(8,8,() => 0x555555,{ normal: () => [1,0,1] });
  pack.faceRegion([-3,-2,0],[6,0,0],[0,4,0],region);
  const world = makeBuilder(8,[0x101010]).finish({
    spriteSurfaces: pack.finish(),
    cam: { target:[0,0,0], dist:8, yaw:0, pitch:0, ortho:true, fov:2*Math.atan(.25) }
  });
  const lights = x => [{
    id:'moving lamp', shape:'disk', at:[x,0,1], normal:[0,0,-1], size:[.1,.1],
    color:'#ffffff', intensity:8, radius:8, sampleGrid:1, visible:false, shadows:false
  }];
  return { world, region, lights };
}

test('software lighting responds to the tile normal and moving emitter', () => {
  const ink = require('../index.js'), { world, lights } = tileWithMovingLight(ink.load());
  const red = (x, surfaceNormals) => ink.render(world, {
    w:48,h:32,px:1,raw:true,surfaceNormals,areaLights:lights(x)
  }).rgb[(16*48+24)*3];
  assert.ok(red(-2,true)+12 < red(-2,false));
  assert.ok(red(2,true) > red(2,false)+12);
});

test('WebGL lighting reads the normal map and uploads changed texels', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = require('../cli/look-webgl.js')({},tileWithMovingLight,(kit,fixture,backend) => {
    const {world,region,lights} = fixture(kit);
    const view = backend(48,32,{raw:true}), atlas = world.spriteSurfaces;
    try {
      const red = (x,surfaceNormals) => {
        view.draw(world,{areaLights:lights(x),surfaceNormals});
        return view.sample({center:[24,16]}).center[0];
      };
      const mappedLeft = red(-2,true), flatLeft = red(-2,false);
      const mappedRight = red(2,true), flatRight = red(2,false);
      for (let i=0;i<atlas.normalPixels.length;i+=4) atlas.normalPixels[i] = 256-atlas.normalPixels[i];
      kit.SpriteSurface.markDirty(atlas,region);
      return { mappedLeft, flatLeft, mappedRight, flatRight, flippedLeft:red(-2,true) };
    } finally {
      view.close();
    }
  });
  assert.ok(result.mappedLeft+12 < result.flatLeft, JSON.stringify(result));
  assert.ok(result.mappedRight > result.flatRight+12, JSON.stringify(result));
  assert.ok(result.flippedLeft > result.flatLeft+12, JSON.stringify(result));
});
