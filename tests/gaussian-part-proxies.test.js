const { test } = require('node:test');
const assert = require('node:assert/strict');

test('proxy plans only accept explicit, disjoint rows and geometry', async () => {
  const { compileGaussianPartProxies } = await import('../webgl.mjs');
  const world = { count: 4, data: new Float32Array(64), gaussianHarmonics: { count: 4 } };
  const mask = { count: 4, indices: [1, 3] };
  const shape = { type: 'stroke', points: [[0, 0, 0], [0, 1, 0]], radii: [.1, .02] };
  const part = { mask, shape };
  assert.deepEqual(compileGaussianPartProxies(world, [part]), { count: 4, parts: 1 });
  assert.throws(() => compileGaussianPartProxies(world, [part, part]), /non-overlapping/);
  assert.throws(() => compileGaussianPartProxies(world, [{ ...part, shape: { ...shape, samples: [0, 3] } }]), /color sample/);
  assert.throws(() => compileGaussianPartProxies(world, [{ ...part, shape: { ...shape, radii: [.1, 0] } }]), /positive radii/);
});

test('WebGL proxy strokes replace only painted rows and depth-test against the remaining Gaussian cloud',
  { skip: !process.env.INK_TEST_CHROME }, () => {
    const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend) => {
      const data = new Float32Array(3 * 16);
      for (let i = 0; i < 3; i++) {
        const o = i * 16;
        data[o + 3] = .95;
        for (const j of [4,8,10]) data[o + j] = i ? .035 : .008;
      }
      data[0] = -.6;
      data[16 + 2] = -.4;
      data[32] = .6;
      data[32 + 2] = .4;
      const c = 1.4;
      const world = { data, count:3, radius:2, pal:[0x000000,0xff0000,0x0000ff,0x00ff00], dither:0,
        cam:{ dist:4, target:[0,0,0], yaw:0,pitch:0,ortho:true },
        moving:new Int32Array(), back:new Int32Array(),
        gaussianHarmonics:{ count:3,degree:0,dc:Float32Array.of(c,-c,-c,-c,c,-c,-c,-c,c),
          sh:new Float32Array(),up:'y',colorMode:'rgb' } };
      const renderer = backend(65,65,{offscreen:true});
      const frame = { width:65,height:65,colored:false,dither:0 };
      const mask = { count:3,indices:[0] };
      const points = [[-.83,0,0],[.83,0,0]];
      const plan = kit.compileGaussianPartProxies(world,[{ mask,shape:{type:'stroke',points,radii:[.06,.012]} }]);
      const row = Object.fromEntries(Array.from({length: 25}, (_, i) => [i,[20+i,32]]));
      renderer.draw(world,frame);
      const baseline = renderer.sample(row);
      renderer.draw(world,{ ...frame,gaussianPartProxies:plan });
      const hybrid = renderer.sample(row);
      const atlas = renderer.captureTurntable(world,{ angles:[0],width:65,frame:{gaussianPartProxies:plan} });
      const hi = atlas.indices[32*65+32];
      const mesh = {type:'mesh',points:[[-.65,-.25,0],[.2,-.25,0],[-.3,.25,0]],
        triangles:[0,1,2],normals:[[0,0,1],[0,0,1],[0,0,1]]};
      const outputs={};
      for (const mode of ['replace','silhouette','depth','normals']) {
        const effect=kit.compileGaussianPartProxies(world,[{mask,shape:mesh,mode,
          ...(mode==='normals' && {light:{direction:[0,0,-1],strength:1}})}]);
        renderer.draw(world,{ ...frame,gaussianPartProxies:effect });
        outputs[mode]=renderer.sample(row);
      }
      const facet = (z) => ({type:'mesh',points:[[-.9,-.4,z],[.9,-.4,z],[0,.4,z]],triangles:[0,1,2]});
      const screen = {mask:{count:3,indices:[2]},shape:facet(-.2),color:0x0000ff};
      const behind = kit.compileGaussianPartProxies(world,[screen]);
      const inFront = kit.compileGaussianPartProxies(world,[screen,
        {mask:{count:3,indices:[1]},shape:facet(.2),mode:'depth'}]);
      renderer.draw(world,{ ...frame,gaussianPartProxies:behind });
      const blocked = renderer.sample({ center:[32,32] }).center;
      renderer.draw(world,{ ...frame,gaussianPartProxies:inFront });
      const visible = renderer.sample({ center:[32,32] }).center;
      renderer.close();
      return { baseline,hybrid,hi,outputs,blocked,visible };
    }, {});
    assert.equal(result.hi,1);
    assert(result.hybrid[12][0] > result.hybrid[12][2]);
    assert(result.baseline[12][1] > result.baseline[12][0]);
    assert(result.hybrid[23][2] > result.hybrid[23][0]);
    assert.notDeepEqual(result.outputs.replace,result.baseline);
    assert.notDeepEqual(result.outputs.silhouette,result.baseline);
    assert.notDeepEqual(result.outputs.normals,result.baseline);
    assert.deepEqual(result.blocked,[0,0,255]);
    assert(result.visible[1] > result.visible[2]);
  });
