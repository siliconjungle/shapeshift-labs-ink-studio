const assert = require('node:assert/strict');
const {test} = require('node:test');
const {load} = require('..');
const {KIT:K, SkyEnvironment, SplatEffects} = load();
const near = (actual,expected) => {
  assert(actual.every((v,i)=>Math.abs(v-expected[i]) < 1e-7), actual+' vs '+expected);
};

test('spectrum strips sweep in either direction and cycle without a repeated band',()=>{
  const full = K.palette.ramp({type:'spectrum'});
  near(full.sample(0),[1,0,0]);
  near(full.sample(1/3),[0,1,0]);
  near(full.sample(2/3),[0,0,1]);
  near(full.sample(1),[1,0,0]);
  const reverse = K.palette.ramp({type:'spectrum',hue:[1/3,-1/3]});
  near(reverse.sample(.5),[1,0,0]);
  near(reverse.sample(1),[0,0,1]);
  const bands = K.palette.ramp({type:'spectrum',steps:6});
  assert.equal(new Set(bands.outputPalette.map(rgb=>rgb.join(','))).size,6);
  const {rgb} = bands.raster(6,3);
  assert.deepEqual(rgb.subarray(0,18),rgb.subarray(36,54));
  assert.throws(()=>K.palette.ramp({type:'spectrum',hue:[0,2]}),/one turn/);
});

test('primary ramps hit the endpoints and accent with or without even steps',()=>{
  const definition = {type:'primary',accent:'#28a796',accentAt:.7};
  const accent = [40/255,167/255,150/255];
  const smooth = K.palette.ramp(definition);
  near(smooth.sample(-1),[0,0,0]);
  near(smooth.sample(.7),accent);
  near(smooth.sample(2),[1,1,1]);
  const mid = smooth.sample(.35);
  assert(mid[0]<accent[0] && mid[1]<accent[1] && mid[2]<accent[2]);
  const bands = K.palette.ramp({...definition,steps:12});
  near(bands.sample(.7),accent);
  near(bands.sample(.99),[1,1,1]);
  const limited = K.palette.ramp({...definition,palette:['#000000','#28a796','#ffffff']});
  const colors = limited.outputPalette.map(rgb=>rgb.map(v=>Math.round(v*255)).join(','));
  const data = limited.raster(32,1).rgb;
  for (let i=0;i<data.length;i+=3) assert(colors.includes(data.subarray(i,i+3).join(',')));
  assert.throws(()=>K.palette.ramp({...definition,accentAt:0}),/accent position/);
});

test('projections select an axis and keep the rest of the surface unpainted',()=>{
  const resolve = value => value === undefined ? [1,1,1] : K.procedural.materials.perceptual.parse(value);
  const make = axis => SplatEffects.layer({
    pattern:'palette-ramp', projection:{along:[1,0,0],across:[0,1,0]},
    paletteRamp:{type:'primary',accent:'#ff0000',axis,size:[2,2]}
  },undefined,resolve);
  const read = (layer,x,y)=>Array.from(layer.sample({position:[x,y,0]}));
  near(read(make('along'),1,0).slice(0,3),[1,0,0]);
  near(read(make('across'),1,0).slice(0,3),[0,0,0]);
  near(read(make('across'),0,1).slice(0,3),[1,0,0]);
  assert.equal(read(make('along'),-1,1)[3],0);
  assert.throws(()=>make('depth'),/along or across/);
});

test('sky ramps follow world direction and can be faded by a profile track',()=>{
  const settings = {
    defaults:{zenith:'#000000',horizon:'#000000',ground:'#262626',sunStrength:0},
    profiles:{day:{pigment:1},night:{pigment:0}},
    sequences:{cycle:{duration:3,keys:[{at:0,profile:'day'},{at:2,profile:'night'}]}},
    tracks:[{id:'light',sequence:'cycle'}],
    sky:{paletteRamp:{ramp:{type:'spectrum'},gain:'pigment',domain:[0,Math.PI/2]}}
  };
  const env = K.skyEnvironment.compile(settings), ray = [0,.5,Math.sqrt(.75)];
  near(SkyEnvironment.shade(env.frame(0).sky,ray),[0,1,0]);
  near(SkyEnvironment.scattering(env.frame(1).sky,ray),[0,.5,0]);
  near(SkyEnvironment.shade(env.frame(2).sky,ray),[0,0,0]);
  near(SkyEnvironment.shade(env.frame(0).sky,[0,-1,0]),[38/255,38/255,38/255]);

  const azimuth = K.skyEnvironment.compile({...settings,sky:{paletteRamp:{
    ramp:{type:'primary',accent:'#ff0000'},axis:'azimuth',domain:[-Math.PI/2,Math.PI/2]
  }}});
  near(SkyEnvironment.shade(azimuth.frame(0).sky,[0,0,1]),[1,0,0]);
  near(SkyEnvironment.shade(azimuth.frame(0).sky,[-1,0,0]),[0,0,0]);
  assert.throws(()=>K.skyEnvironment.compile({...settings,sky:{paletteRamp:{
    ramp:{type:'spectrum'},domain:[0,2]
  }}}),/domain/);
});

test('directional ramp matches the CLI at WebGL art pixels',{skip:!process.env.INK_TEST_CHROME},()=>{
  const runWebGL = require('../cli/look-webgl.js');
  const settings = { ramp:{type:'spectrum',hue:[.08,-.28],steps:10},domain:[0,.65] };
  const view = {w:56,h:32,px:1,raw:true,ortho:true};
  function build({makeBuilder},paletteRamp) {
    return makeBuilder(1,[0x203040,0x89abcd]).finish({
      cam:{target:[0,0,0],dist:7,yaw:.15,pitch:.02},
      radius:7, dither:0, skyEnvironment:{ defaults:{sunStrength:0},sky:{paletteRamp} }
    });
  }
  const kit = load(), {render} = require('..');
  const cpu = render(build(kit,settings),view);
  const {image} = runWebGL({},build,(kit,fixture,backend,{view,settings})=>{
    const draw = backend(view.w,view.h,view);
    try {
      draw.draw(fixture(kit,settings));
      return {image:draw.image()};
    } finally {
      draw.close();
    }
  },{view,settings});
  const gpu = Buffer.from(image,'base64');
  assert.equal(cpu.rgb.length,gpu.length);
  const differences = cpu.rgb.reduce((sum,v,i)=>sum+Math.abs(gpu[i]-v),0);
  assert(differences/gpu.length <= .33, 'sky ramps match after byte conversion');
});
