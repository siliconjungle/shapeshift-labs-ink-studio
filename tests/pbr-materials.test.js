const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ KIT, makeBuilder, SpriteSurface, bakeObjectTexels, editObjectTexels }) {
  const B = makeBuilder(3, [0x111923, 0xc98044, 0x84949b, 0xf5d28a, 0x296565]);
  const quad = x => ({
    points:[x-.48,-.48,0,x+.48,-.48,0,x+.48,.48,0,x-.48,.48,0],
    triangles:[0,1,2,0,2,3]
  });
  const plate = quad(-2.15);
  const mesh = KIT.sceneMeshes.create({
    id:'plate', positions:plate.points, indices:plate.triangles, uvs:[0,1,1,1,1,0,0,0],
    materials:[{ id:'alloy', color:0xc98044 }]
  });
  const texels = bakeObjectTexels(quad(-1.05), {
    resolution:8, origin:[-1.05,0,-.3],
    material:()=>({pigment:0xc98044,roughness:.46,metalness:1}),
    fallback:()=>({pigment:0xc98044,roughness:.46,metalness:1})
  });
  const baked = KIT.sceneMeshes.fromObjectTexels(texels, { id:'texels', materialId:'texel' });
  const sign = SpriteSurface.make(4);
  sign.face([-.48,-.48,0],[.96,0,0],[0,.96,0],4,4,()=>0xc98044,
    { id:'sign', materialId:'alloy', projection:{mapping:'affine'} });
  let first = B.count();
  B.disc(1.05,0,0,[0,0,1],.39,.02,B.P[2],1);
  B.describeAlbedo(first,B.count(),'#c98044');
  B.describeSplats(first,B.count(),{ material:'alloy' });
  first = B.count();
  KIT.curveSplats.draw(B,[[1.74,0,0],[2.64,0,0]],{
    color:'#c98044', width:.62, edge:'hard', caps:'rounded'
  });
  B.describeSplats(first,B.count(),{ material:'alloy' });
  const definition = {
    materials:{ alloy:{roughness:.46,metalness:1}, texel:{} },
    bindings:[{ select:{material:'alloy'}, material:'alloy' },{ select:{material:'texel'}, material:'texel' }],
    lights:[{ direction:[0,0,1], intensity:2.3 }],
    environment:{ intensity:.28 },
    projections:[{ material:'alloy', origin:[-2.7,.11,.18],u:[5.6,0,0],v:[0,.35,0],
      reach:.5,feather:0,channels:{baseColor:'#30acac',metalness:0,roughness:.8} }]
  };
  const world = B.finish({
    meshes:[mesh,baked],spriteSurfaces:sign.finish(),radius:4,
    look:{pbrMaterials:definition},cam:{target:[0,0,0],dist:5,fov:.72,yaw:0,pitch:0,ortho:true},
    fog:{start:1,max:0},dither:0
  });
  const edit = () => KIT.sceneMeshes.updateObjectTexels(baked, editObjectTexels(texels,
    texels.cells.filter(Boolean).map(({id}) => ({ id, metalness:0 }))));
  return { world, definition, edit };
}
const view = { w:144,h:80,px:1,raw:true,outline:false,edges:false };
const samples = { mesh:[26,40], texel:[50,40], decal:[72,40], gaussian:[94,40], strand:[119,40],
  projected:[72,34], background:[2,2] };
const light = [{ direction:[1,.5,.15], color:'#a8ceff', intensity:2.3 }];
const inputs = { view, samples, light };

function read(frame) {
  return Object.fromEntries(Object.entries(samples).map(([name, [x,y]]) => {
    const at = (y * frame.w + x) * 3;
    return [name, Array.from(frame.rgb.subarray(at,at + 3))];
  }));
}

async function headless() {
  const { bakeObjectTexels, editObjectTexels } = await import('../webgl.mjs');
  const { world, edit } = fixture({ ...ink.load(), bakeObjectTexels, editObjectTexels });
  const render = options => read(ink.render(world, { ...view, ...options }));
  const lit = render(), sidelit = render({ pbrLights:light }), off = render({ pbrMaterials:false });
  edit();
  return { lit,sidelit,off,edited:render() };
}

test('shared materials relight five carriers and preserve named projections on the art grid',async () => {
  const { lit,sidelit,off,edited } = await headless();
  for (const name of ['mesh','texel','decal','gaussian','strand']) {
    assert.notDeepEqual(lit[name],lit.background,name);
    assert(lit[name][0] >= sidelit[name][0] + 24,JSON.stringify({name,lit,sidelit}));
    assert.notDeepEqual(sidelit[name],off[name],name);
  }
  assert.deepEqual(lit.background,off.background);
  assert(lit.gaussian[0] > lit.gaussian[2] + 25);
  assert(off.gaussian[0] < off.gaussian[2]);
  assert(lit.projected[1] > lit.projected[0] + 30, JSON.stringify(lit));
  assert.notDeepEqual(edited.texel,lit.texel);
  assert.deepEqual(edited.mesh,lit.mesh);
});

test('native WebGL matches headless material, projection and live texel edits', {skip:!process.env.INK_TEST_CHROME}, async () => {
  const expected = await headless();
  const actual = runWebGL({},fixture,(kit,build,backend,{view,samples,light}) => {
    const {world,edit}=build(kit), painter = backend(view.w,view.h,view);
    try {
      const sample = options => {
        painter.draw(world,options);
        return painter.sample(samples);
      };
      const lit = sample(), sidelit = sample({pbrLights:light}), off = sample({pbrMaterials:false});
      edit();
      return {lit,sidelit,off,edited:sample()};
    } finally { painter.close(); }
  },inputs);
  for (const [mode, colors] of Object.entries(expected)) {
    for (const [name, rgb] of Object.entries(colors)) {
      assert(rgb.every((n,k) => Math.abs(actual[mode][name][k]-n) <= 4),
        JSON.stringify({mode,name,expected:rgb,actual:actual[mode][name]}));
    }
  }
});

test('portable bindings validate and a swatch is driven by the highlight response', () => {
  const K = ink.load().KIT, pbr = K.pbr;
  const definition = {
    materials:{ cobalt:{baseColor:'#263247',roughness:.35,
      highlight:{color:'#60d7ce',threshold:.1}} },
    default:'cobalt', environment:{intensity:0},
    lights:[{direction:[0,0,1],intensity:2}]
  };
  const plan = pbr.prepare(definition);
  const sample = { color:[1,1,1], normal:[0,0,1], view:[0,0,1], position:[0,0,0] };
  const lit = pbr.shade(plan,plan.resolve(),sample);
  assert.deepEqual(lit.map(n=>Math.round(n*255)),[96,215,206]);
  const sideways = pbr.prepare(definition,[{direction:[1,0,0]}]);
  assert.deepEqual(pbr.shade(sideways,sideways.resolve(),sample),[0,0,0]);
  assert.throws(()=>pbr.prepare({...definition,default:'unknown'}),/Unknown PBR material/);
  const scene = { id:'portable-material',solids:[],finish:{look:{ pbrMaterials:definition }} };
  assert.deepEqual(K.diorama.build(scene).look.pbrMaterials,definition);
  scene.finish.look.pbrMaterials = {...definition,default:'unknown'};
  assert(K.diorama.check(scene).some(issue=>issue.path==='finish.look.pbrMaterials' && issue.level==='error'));
});
