const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT:K, ArtStability, PixelLook, makeBuilder, makeSculpt }=ink.load();
const { FOV }=require('../cli/render.js');
const camera={target:[0,0,0],dist:5,yaw:0,pitch:0};
const view={w:64,h:48,px:1,ortho:true};
const step=2*camera.dist*Math.tan(FOV/2)/view.h;
const black=0x0a0f18, mid=0x8090a0;
const candidates={palette:['#465666','#aebecd'],dither:{pattern:'bayer',strength:1}};
const on={dither:'world',spacing:step,origin:[.012,.019,0]};

function plate(look={}) {
  const B=makeBuilder(7,[black,mid]), S=K.sculpt(makeSculpt(B));
  S.amb=1; S.sunK=0; S.sky=0;
  S.box([0,0,-.07],[1.15,.8,.08],{r:[1],materialId:'plate'},{res:.072,objectId:'probe'});
  S.bake();
  return B.finish({cam:camera,dither:1,look});
}
function changes(a,b,dx=0,dy=0) {
  let different=0;
  for (let y=17;y<31;y++) for (let x=21;x<43;x++) {
    const one=(y*a.w+x)*3,two=((y+dy)*b.w+x+dx)*3;
    if (a.rgb[one]!==b.rgb[two] || a.rgb[one+1]!==b.rgb[two+1] || a.rgb[one+2]!==b.rgb[two+2]) different++;
  }
  return different;
}
function pan(world, settings) {
  return [
    ink.render(world,{...view,...settings}),
    ink.render(world,{...view,...settings,target:[step,0,0]})
  ];
}

test('the stage palette and coverage-aware material palette keep their phase on an orthographic pan', () => {
  const fixtures=[
    [plate({renderStages:[{stage:'palette',select:{object:'probe'},palette:candidates}]}),{}],
    [plate({paletteConstraints:{targets:[{object:'probe',...candidates}]}}),{coverageAware:true}],
    [plate({paletteConstraints:{targets:[{object:'probe',...candidates}]}}),{colored:true}]
  ];
  for (const [world,options] of fixtures) {
    const screen=pan(world,{...options,stable:false});
    const worldSpace=pan(world,{...options,stable:on});
    assert(changes(...screen,-1)>30,'the fixture exposes screen-space crawl');
    assert(changes(...worldSpace,-1)<4,'world-space dither stays on the translated surface samples');
  }
});

test('target rules select a space per object and respect configured origin and CLI-style overrides', () => {
  const authored={dither:'world',spacing:.13,origin:[.025,0,0],snap:true,threshold:.62,
    targets:[{material:'stone',dither:'screen'},{object:'parcel',dither:'object',spacing:.1}]};
  const settings=ArtStability.prepare(authored,{snap:false});
  assert.equal(settings.snap,false);
  assert.equal(settings.threshold,.62);
  assert.equal(ArtStability.matching(settings,'parcel','stone').dither,'object');
  assert.equal(ArtStability.matching(settings,'pier','stone').dither,'screen');
  assert.equal(ArtStability.matching(settings,'pier','concrete').spacing,.13);
  assert.deepEqual(ArtStability.matching(settings,'parcel','stone').origin,authored.origin);
  assert.equal(ArtStability.prepare(authored,false),null);
  assert.throws(()=>ArtStability.prepare({targets:[{dither:'object'}]}),/object or material/);
});

test('coincident cell boundaries stay stable, including visible atlas texels with no splat index', () => {
  const settings=ArtStability.prepare({dither:'object',spacing:.1});
  const a=ArtStability.coordinates(settings,[.1,-1e-8,.2],30,40);
  const b=ArtStability.coordinates(settings,[.1,1e-8,.2],30,40);
  assert.deepEqual(a,b);
  const passes={depth:new Float32Array([4,Infinity]),splatId:new Uint32Array(2),
    objectPosition:new Float32Array([0,0,0,0,0,0]),ditherRest:new Map([[0,[.1,-1e-8,.2]]])};
  assert.deepEqual(ArtStability.ditherCoordinates(settings,passes,0,30,40),a);
  assert.deepEqual(ArtStability.ditherCoordinates(settings,passes,1,30,40),[30,40]);
});

test('object anchors follow the local coordinates of a translating prop under a tracking camera', () => {
  const B=makeBuilder(1,[black,mid]), S=K.sculpt(makeSculpt(B)), rig=K.rig(B,S);
  S.amb=1; S.sunK=0; S.sky=0;
  S.box([0,0,-.07],[1.15,.80,.08],{r:[1],materialId:'parcel'},{tag:'parcel',res:.072});
  S.bake();
  const world=B.finish({cam:camera,dither:1,look:{stable:{...on,targets:[{object:'parcel',dither:'object'}]},
    paletteConstraints:{targets:[{object:'parcel',...candidates}]}}});
  const stage=K.stage(world);
  rig.bind(stage);
  stage.add({update(_dt,t) {
    rig.set('parcel',K.M.id(),[0,0,0],[t*step,0,0]);
    rig.apply();
  }});
  function pair(stable) {
    return [0,1].map(t=>{
      stage.update(0,t);
      return ink.render(world,{...view,stable,t,target:[t*step,0,0]});
    });
  }
  assert(changes(...pair({targets:[]}))>30);
  assert(changes(...pair(undefined))<4);
});

test('a matching orbit and rigid turn keep the visible paint pattern in object space', () => {
  const B=makeBuilder(1,[black,mid]), S=K.sculpt(makeSculpt(B)), rig=K.rig(B,S);
  S.amb=1; S.sunK=0; S.sky=0;
  S.box([0,0,-.07],[1.15,.80,.08],{r:[1],materialId:'panel'},{tag:'rotor',res:.072});
  S.bake();
  const world=B.finish({cam:camera,look:{paletteConstraints:{targets:[{object:'rotor',...candidates}]}}});
  const stage=K.stage(world);
  rig.bind(stage);
  const turn=.48;
  stage.add({update(_dt,t) {
    rig.set('rotor',K.M.rot([0,1,0],t*turn),[0,0,0],[0,0,0]);
    rig.apply();
  }});
  const series=dither=>[0,1].map(t=>{
    stage.update(0,t);
    return ink.render(world,{...view,stable:{...on,dither},t,yaw:t*turn});
  });
  assert(changes(...series('world'))>30);
  assert(changes(...series('object'))<4);
});

test('fog ramp dithering uses the same world coordinates on a visible surface', () => {
  const world=plate({
    effectPalettes:{fog:{colors:['#426179','#abc3ca'],geometry:true,threshold:.25,range:[0.17,.86],dither:1}}
  });
  world.atmosphere=[K.atmosphere.fog({color:'#8298a8',density:.46,near:1,far:7})];
  const opts={captureEffectPalettes:true};
  const screen=pan(world,{...opts,stable:false});
  const anchored=pan(world,{...opts,stable:on});
  assert(anchored[0].effectPaletteMask.some(n=>n===1));
  assert(changes(...screen,-1)>30);
  assert(changes(...anchored,-1)<4);
});

const anchorPolicy = space => ({
  ...candidates,
  dither: { ...candidates.dither, space, spacing: step, origin: on.origin,
    pairs: [{ colors: candidates.palette }] }
});

test('a palette anchor overrides global placement in native, contour, coverage and cluster resolves', () => {
  const stable = { ...on, targets: [{ object: 'probe', dither: 'world' }] };
  for (const options of [{}, { colored: true }, { coverageAware: true },
    { stable: { ...stable, resolve: 'coverage' } }, { stable: { ...stable, resolve: 'clusters' } }]) {
    const target = space => plate({ stable, paletteConstraints: {
      targets: [{ object: 'probe', ...anchorPolicy(space) }]
    } });
    const world = pan(target('world'), options), screen = pan(target('screen'), options);
    assert(changes(...world, -1) < 4, JSON.stringify(options));
    assert(changes(...screen, -1) > 30, JSON.stringify(options));
  }
});

test('a spatial palette works with a final-stage mask and a surface palette mask', () => {
  const mask = { type: 'axis', axis: 'x', range: [-3, -2], space: 'world' };
  const staged = space => plate({ renderStages: [{ stage: 'palette', select: { object: 'probe' },
    palette: anchorPolicy(space), mask }] });
  const surface = space => {
    const B = makeBuilder(7, [black, mid]), S = K.sculpt(makeSculpt(B));
    S.amb = 1; S.sunK = 0; S.sky = 0;
    const paint = K.surface.material({ r: [1], materialId: 'plate' },
      { paletteConstraint: { ...anchorPolicy(space), mask } });
    S.box([0, 0, -.07], [1.15, .8, .08], paint, { res: .072, objectId: 'probe' });
    S.bake();
    return B.finish({ cam: camera, dither: 1 });
  };
  for (const build of [staged, surface]) {
    for (const options of [{ stable: false }, { stable: false, coverageAware: true }]) {
      assert(changes(...pan(build('screen'), options), -1) > 30);
      assert(changes(...pan(build('world'), options), -1) < 4);
    }
  }
});

test('the palette object anchor sticks in rig rest space even with scene stability off', () => {
  const B = makeBuilder(1, [black, mid]), S = K.sculpt(makeSculpt(B)), rig = K.rig(B, S);
  S.amb = 1; S.sunK = 0; S.sky = 0;
  S.box([0, 0, -.07], [1.15, .8, .08], { r: [1], materialId: 'cloth' }, { tag: 'cloth', res: .072 });
  S.bake();
  const world = B.finish({ cam: camera });
  const stage = K.stage(world);
  rig.bind(stage);
  const turn = .48;
  stage.add({ update(_dt, t) {
    rig.set('cloth', K.M.rot([0, 1, 0], t * turn), [0, 0, 0], [0, 0, 0]);
    rig.apply();
  } });
  const series = (space, coverageAware) => [0, 1].map(t => {
    stage.update(0, t);
    return ink.render(world, { ...view, stable: false, t, yaw: t * turn, coverageAware,
      paletteConstraints: { targets: [{ material: 'cloth', ...anchorPolicy(space) }] } });
  });
  for (const coverageAware of [false, true]) {
    assert(changes(...series('world', coverageAware)) > 30);
    assert(changes(...series('object', coverageAware)) < 4);
  }
});

test('palette anchor validation and compatibility use the same policy in native look data', () => {
  const pack = { format: 'ink-studio/asset-pack', id: 'dither', title: 'Dither', version: 1, revision: 1,
    looks: [{ id: 'dither/weave', label: 'Weave', palette: anchorPolicy('object') }] };
  const catalog = K.authoring.assetPacks.create({ packs: [pack] });
  const { palette } = K.authoring.looks.bind('dither/weave', catalog);
  assert.deepEqual(PixelLook.preparePalette(palette).anchor, { ...on, dither: 'object' });
  assert.deepEqual(K.world.lookReport.standalone({ palette }, undefined, 'headless').issues, []);
  assert.match(K.world.lookReport.standalone({ palette }, undefined, 'webgl').issues[0].message, /screen space/);
  for (const dither of [{ space: 'camera' }, { space: 'world', spacing: 0 }, { space: 'object', origin: [0, 0] }])
    assert.throws(() => PixelLook.preparePalette({ ...candidates, dither }), /Invalid dither space/);
  assert.throws(() => PixelLook.preparePalette({ ...candidates, dither: { spacing: .2 } }), /Set a dither space/);
});
