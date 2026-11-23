const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, makeBuilder, makeSculpt } = ink.load();
const paint = K.surface.shadowBandPaint;
const palette = [0x151921,0x503445,0xa26146,0xf3c97a];
const ramp = { stops:[[0,1],[.5,2],[.82,3]], interpolation:'step' };
const mark = (points, radius, bias, softness=0) => ({points,radius,bias,softness});

test('signed brush paths feather and erase in paint order without changing the source', () => {
  const dabs = [
    mark([[-1,0,0],[1,0,0]],.5,.6,.4),
    mark([[0,0,0]],.13,0),
    mark([[1,0,0]],.1,-.2)
  ];
  const read = paint.prepare(dabs);
  assert.equal(read([0,0,0]),0);
  assert.equal(read([1,0,0]),-.2);
  assert.equal(read([.7,.1,0]),.6);
  assert.ok(Math.abs(read([.7,.4,0])-.3)<1e-9);
  assert.equal(read([.7,0,.6]),0);
  dabs[0].points[0][0]=8;
  assert.equal(read([-.8,0,0]),.6);
  assert.throws(()=>paint.prepare([mark([[0,0,0]],.1,2)]),/bias in/);
});

test('paint moves the exact ramp transition in both directions and preserves full light occlusion', () => {
  const settings = { layers:{diffuse:{type:'diffuse',lightingRamp:ramp,shadowBand:{strokes:[
    mark([[-1,0,0]],.5,.23),mark([[1,0,0]],.5,-.31)
  ]}}} };
  const prepared=K.surface.prepare(settings,palette), bypass=K.surface.prepare(settings,palette,undefined,{}, {paintShadowBands:false});
  function rgb(x,z,visibility=1,look=prepared) {
    const lightDirection=[Math.sqrt(1-z*z),0,z];
    return K.surface.shade(look,{position:[x,0,0],worldPosition:[7,2,3],normal:[0,0,1],view:[0,0,1],
      visibility,lightDirection},[0,0,0]).slice(0,3).map(n=>Math.round(n*255));
  }
  assert.deepEqual(rgb(-1,.65),[80,52,69]);
  assert.deepEqual(rgb(0,.65),[162,97,70]);
  assert.deepEqual(rgb(1,.65),[243,201,122]);
  assert.deepEqual(rgb(1,.65,0),[80,52,69]);
  assert.deepEqual(rgb(1,.65,1,bypass),rgb(0,.65));
  assert.throws(()=>K.surface.prepare({layers:{gloss:{type:'specular',shadowBand:settings.layers.diffuse.shadowBand}}},palette),/diffuse/);
});

test('headless draws a brush boundary inside one material and can bypass the paint', () => {
  const B=makeBuilder(19,palette), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:[.8,0,.6],amb:.6,sky:0,sunK:.25,shLen:0});
  const slate=K.surface.material({r:[1,2,3]},{layers:{diffuse:{type:'diffuse',lightingRamp:ramp,shadow:false,
    shadowBand:{strokes:[mark([[-.6,-.42,.10],[-.6,.42,.10]],.32,.35)]}}}});
  S.box([0,0,0],[1,.67,.10],slate,{res:.13,rd:.012});
  S.bake();
  const world=B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:3,fov:.65,ortho:true},radius:4,
    fog:{start:1,max:0,c:0},look:{splatCoverage:'continuous'}});
  const opts={ w:96,h:64,px:1,raw:true }, on=ink.render(world,opts), off=ink.render(world,{...opts,shadowBandPaint:false});
  const pixel=(frame,x)=>Array.from(frame.rgb.subarray((32*96+x)*3,(32*96+x)*3+3));
  assert.deepEqual(pixel(on,29),[80,52,69]);
  assert.deepEqual(pixel(off,29),[162,97,70]);
  assert.deepEqual(pixel(on,62),pixel(off,62));
});

test('the scene editor retains and undoes a shadow brush stroke on the chosen diffuse layer', () => {
  const source={id:'band-test',solids:[
    {id:'tile',kind:'box',at:[0,0,0],half:[1,1,.2],mat:{role:'stone',
      surface:{layers:{diffuse:{type:'diffuse',lightingRamp:{stops:[[0,'#503445'],[.5,'#a26146']]}}}}}},
    {id:'unlit',kind:'ball',at:[2,0,0],r:.4,mat:'stone'}
  ]};
  const editor=ink.createSceneEditor(source), stroke=mark([[0,0,.1]],.3,.25);
  const layer=()=>editor.snapshot().solids[0].mat.surface.layers.diffuse;
  editor.select(['solid:tile']);
  assert.equal(editor.paintShadowBand(stroke),true);
  assert.deepEqual(layer().shadowBand.strokes,[stroke]);
  assert.deepEqual(JSON.parse(editor.serialize()).solids[0].mat.surface.layers.diffuse.shadowBand.strokes,[stroke]);
  assert.throws(()=>editor.paintShadowBand(stroke,{keys:['solid:tile','solid:unlit']}),/diffuse lighting ramp/);
  assert.equal(layer().shadowBand.strokes.length,1);
  editor.undo();
  assert.equal(layer().shadowBand,undefined);
  editor.redo();
  assert.equal(layer().shadowBand.strokes.length,1);
});

test('shade normal paint blends local vectors, respects occlusion and erases in stroke order', () => {
  const normal=[0,0,1], mark={points:[[0,0,0]],radius:1,normal:[-1,0,0],softness:.4};
  const read=paint.normals.prepare([mark,{...mark,radius:.16,normal:null}]);
  assert.deepEqual(read([.4,0,0],normal),[-1,0,0]);
  assert.deepEqual(read([0,0,0],normal),normal);
  assert.deepEqual(read([1.4,0,0],normal),normal);
  const feather=read([.8,0,0],normal);
  assert.ok(Math.abs(feather[0]+Math.SQRT1_2)<1e-8 && Math.abs(feather[2]-Math.SQRT1_2)<1e-8);
  assert.throws(()=>paint.normals.prepare([{...mark,normal:[0,0,0]}]),/nonzero finite XYZ/);
  const settings={layers:{diffuse:{type:'diffuse',lightingRamp:ramp,shadeNormals:{strokes:[mark]}}}};
  const prepared=K.surface.prepare(settings,palette), off=K.surface.prepare(settings,palette,undefined,{}, {shadeNormals:false});
  const swatch=(material,lightDirection,visibility=1)=>K.surface.shade(material,{
    position:[.4,0,0],normal,view:normal,visibility,lightDirection
  },[0,0,0]).slice(0,3).map(n=>Math.round(n*255));
  assert.deepEqual(swatch(prepared,[1,0,0]),[80,52,69]);
  assert.deepEqual(swatch(prepared,[-1,0,0]),[243,201,122]);
  assert.deepEqual(swatch(prepared,[-1,0,0],0),[80,52,69]);
  assert.deepEqual(swatch(off,[-1,0,0]),[80,52,69]);
  assert.throws(()=>K.surface.prepare({layers:{spec:{...settings.layers.diffuse,type:'specular'}}},palette),/diffuse lighting ramp/);
});

test('pose transforms carry the painted shade and recover reconstruction normals for the bypass', () => {
  const data=new Float32Array(16), restNormal=[0,0,1], at=[-.4,0,0];
  data.set(at);
  const turn=K.M.rot([0,1,0],Math.PI/2), transpose=K.M.tr(turn);
  const world={data,reconstructionPose:{base:data,poses:new Map([[0,{rotation:turn,transpose}]])}};
  const pose=K.splatFrames.create(world,0,K.M)(0);
  const layer={type:'diffuse',lightingRamp:ramp,
    shadeNormals:{strokes:[{points:[at],radius:.2,normal:[-1,0,0]}]}};
  const settings={layers:{diffuse:layer}};
  const shade=(light,enabled)=>K.surface.shade(K.surface.prepare(settings,palette,light,{}, {shadeNormals:enabled}),{
    position:[3,0,0],shadeNormalPosition:at,shadeNormalFrame:pose,
    normal:K.M.app(turn,restNormal),view:[0,0,1],visibility:1
  },[0,0,0]).slice(0,3).map(n=>Math.round(n*255));
  assert.deepEqual(shade(K.M.app(turn,[-1,0,0]),true),[243,201,122]);
  assert.deepEqual(shade(K.M.app(turn,[-1,0,0]),false),[80,52,69]);
  assert.deepEqual(shade(K.M.app(turn,restNormal),false),[243,201,122]);
});

function shadeNormalScene({ KIT: K, makeBuilder, makeSculpt }) {
  const B=makeBuilder(31,[0x11202c,0x432b47,0xd29e7d]), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{pixel:true,amb:.6,sky:0,shLen:0});
  const surface=K.surface.material({r:[1,2]},{layers:{diffuse:{type:'diffuse',shadow:false,
    lightingRamp:{stops:[[0,1],[.5,2]],interpolation:'step'},
    shadeNormals:{strokes:[{points:[[-.46,-.6,.10],[-.46,.6,.10]],radius:.34,normal:[-1,0,.22]}]}
  }}});
  S.box([0,0,0],[.98,.7,.10],surface,{res:.045,rd:.012});
  S.bake();
  return B.finish({
    radius:4, dither:0, look:{pixel:true,splatCoverage:'continuous'}, fog:{start:1,max:0,c:0},
    cam:{target:[0,0,0],yaw:0,pitch:0,dist:3,fov:.65,ortho:true},
    surfaceLight:[[0,.73,0,.68],[1,-.73,0,.68]]
  });
}

test('headless shade normal edits serialize and relight in the renderer', () => {
  const editor=ink.createSceneEditor({id:'shade-test',solids:[{id:'tile',kind:'box',at:[0,0,0],half:[1,1,.2],
    mat:{role:'stone',surface:{layers:{diffuse:{type:'diffuse',lightingRamp:{stops:[[0,'#432b47'],[.5,'#d29e7d']]}}}}}
  }]});
  editor.select(['solid:tile']);
  const mark={points:[[0,0,.2]],radius:.3,normal:[-1,0,0],strength:1,softness:.16};
  assert.equal(editor.paintShadeNormal(mark),true);
  assert.deepEqual(JSON.parse(editor.serialize()).solids[0].mat.surface.layers.diffuse.shadeNormals.strokes,[mark]);
  editor.undo();
  assert.equal(editor.snapshot().solids[0].mat.surface.layers.diffuse.shadeNormals,undefined);
  editor.redo();
  assert.deepEqual(editor.snapshot().solids[0].mat.surface.layers.diffuse.shadeNormals.strokes,[mark]);
  const world=shadeNormalScene(ink.load());
  const pixel=(time,shadeNormals,x)=>ink.render(world,{w:96,h:64,px:1,raw:true,time,shadeNormals}).rgb[(32*96+x)*3];
  assert.ok(pixel(0,true,33)+80<pixel(0,false,33));
  assert.ok(pixel(1,true,33)>pixel(0,true,33)+80);
  assert.equal(pixel(0,true,60),pixel(0,false,60));
});

test('WebGL shade normals relight and bypass the baked ramp on painted carriers', {skip:!process.env.INK_TEST_CHROME}, () => {
  const result=require('../cli/look-webgl.js')({},shadeNormalScene,(kit,fixture,backend)=>{
    const world=fixture(kit), b=backend(96,64,{dither:0,changedRows:[],damp:false});
    try {
      const sample=(time,shadeNormals)=>{
        b.draw(world,{time,shadeNormals});
        return b.sample({left:[33,32],right:[60,32]});
      };
      const first=sample(0,true), off=sample(0,false), second=sample(1,true);
      b.draw(world,{time:0,surface:false});
      const unshaded=b.image();
      sample(0,true);
      b.draw(world,{time:0,surface:false});
      return {first,off,second,restore:b.image()===unshaded};
    } finally { b.close(); }
  });
  assert.ok(result.first.left[0]+80<result.off.left[0],JSON.stringify(result));
  assert.ok(result.second.left[0]>result.first.left[0]+80,JSON.stringify(result));
  assert.deepEqual(result.first.right,result.off.right);
  assert.ok(result.restore);
});
