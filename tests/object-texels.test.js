const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SpriteSurface } = require('../index.js').load();

const cube = {
  points:[-1,-1,-1, -1,-1,1, 1,-1,1, 1,-1,-1, -1,1,-1, -1,1,1, 1,1,1, 1,1,-1],
  triangles:[0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7,
    0,2,1,0,3,2, 4,5,6,4,6,7]
};

test('object texels tile a rigid prop and take their color from fixed cubemap rays', async () => {
  const { bakeObjectTexels } = await import('../webgl.mjs');
  const seen = new Map();
  const resolution = 5;
  const bake = bakeObjectTexels(cube, { resolution, paint({ face, x, y, point }) {
    const key = face * resolution ** 2 + y * resolution + x;
    seen.set(key, point);
    return 0x104000 + key;
  } });
  assert.equal(seen.size, 150);
  assert.equal(bake.missing, 0);
  assert.deepEqual(seen.get(12), [1,0,0]);
  assert.deepEqual(seen.get(112), [0,0,1]);
  assert(bake.points.every(Number.isFinite));
  const atlas = SpriteSurface.make(bake.width);
  const rect = atlas.reserve(bake.width,bake.height);
  atlas.meshRegion(bake,rect);
  const done = atlas.finish();
  SpriteSurface.update(done,rect,{w:bake.width,h:bake.height,rgba:bake.rgba});
  const texels = new Set();
  let area = 0;
  for (let i=0;i<done.vertices.length;i+=15) {
    const a=done.vertices.subarray(i,i+3), b=done.vertices.subarray(i+5,i+8), c=done.vertices.subarray(i+10,i+13);
    const [x,y,z]=b.map((v,k)=>v-a[k]), [u,v,w]=c.map((n,k)=>n-a[k]);
    area+=Math.hypot(y*w-z*v,z*u-x*w,x*v-y*u)/2;
    const tx=Math.floor(done.vertices[i+3]), ty=Math.floor(done.vertices[i+4]);
    texels.add(ty*done.width+tx);
    assert.equal(done.vertices[i+3],done.vertices[i+8]);
    assert.equal(done.vertices[i+3],done.vertices[i+13]);
    assert.equal(done.pixels[(ty*done.width+tx)*4+3],255);
  }
  assert(Math.abs(area-24)<1e-5);
  assert.equal(texels.size,150);
});

test('surfaces hidden from the probe keep their mesh and receive the fallback color', async () => {
  const { bakeObjectTexels } = await import('../webgl.mjs');
  const surface = {
    points:[-.7,-.7,1,.7,-.7,1,0,.7,1,-.7,-.7,2,.7,-.7,2,0,.7,2],
    triangles:[0,1,2,3,4,5]
  };
  const baked=bakeObjectTexels(surface,{resolution:8,paint:()=>0xaa1122,fallback:0x1133aa});
  assert(baked.missing>0);
  const offsets = baked.points.flatMap((z,i)=>i%3===2&&z===2?[i/3|0]:[]);
  assert(offsets.length>0);
  for (const index of offsets) {
    const x=Math.round(baked.uvs[index*2]*(baked.width-1));
    const y=Math.round(baked.uvs[index*2+1]*(baked.height-1));
    const p=(y*baked.width+x)*4;
    assert.deepEqual([...baked.rgba.slice(p,p+4)],[17,51,170,255]);
  }
});
