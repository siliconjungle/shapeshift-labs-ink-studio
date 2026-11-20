const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT:K, SkyEnvironment, SceneOptics, CloudField, makeBuilder, makeSculpt } = ink.load();
const close = (a,b) => assert(a.every((value,i)=>Math.abs(value-b[i])<1e-7), `${a} vs ${b}`);

const animation = (patch, protect) => ({
  interpolation:'linear', keys:[{time:0},{time:2,...patch}], ...(protect && { protect })
});

test('a spectrum sweeps through actual hue turns and closes its authored loop', () => {
  const definition = K.palette.ramp({
    type:'spectrum', hue:[0,1],
    animation:{ ...animation({hue:[1,2]}), playback:'loop' }
  });
  close(definition.frame(0).sample(0),[1,0,0]);
  close(definition.frame(2/3).sample(0),[0,1,0]);
  close(definition.frame(-2/3).sample(0),[0,0,1]);
  close(definition.frame(2).sample(0),[1,0,0]);
  assert.deepEqual(definition.raster(18,2,1),definition.frame(1).raster(18,2));
  assert.throws(() => K.palette.ramp({
    type:'spectrum', hue:[0,1], animation:{...animation({hue:[.5,1.5]}),playback:'loop'}
  }),/loop endpoints/);
  assert.throws(() => definition.frame(NaN),/finite/);
});

test('animated fields recolor stable slots and preserve selected named and numbered swatches', () => {
  const config = {
    palette:['#000000','#00ffff','spark','#222888'], saturation:.8,
    animation:animation({palette:['#180021','#9100ff','#ffffff','#00ff00']},['spark',0])
  };
  const swatch = name => name === 'spark' ? [1,.8,.3] :
    [1,3,5].map(start=>parseInt(name.slice(start,start+2),16)/255);
  const field = K.palette.hueBrightness(config,swatch);
  const first = field.raster(24,24,0), half = field.raster(24,24,1), last = field.raster(24,24,2);
  assert.deepEqual(first.indices,half.indices);
  assert.deepEqual(first.indices,last.indices);
  assert.notDeepEqual(first.rgb,last.rgb);
  close(half.palette[0],[0,0,0]);
  close(half.palette[2],[1,.8,.3]);
  close(half.palette[1],[145/510,.5,1]);
  assert.throws(() => K.palette.hueBrightness({...config,animation:animation({palette:['#000000']})},swatch),/slot count/);
  assert.throws(() => K.palette.hueBrightness({...config,animation:animation({},[9])},swatch),/Unknown protected/);
});

test('a key can hold a protected primary accent and clamp or ping pong in any sample order', () => {
  const base = {type:'primary',shadow:'#220000',accent:'#f9c761',highlight:'#ffcccc',steps:5};
  const track = K.palette.ramp({...base,animation:{
    ...animation({shadow:'#002244',accent:'#00ff00',highlight:'#5093d6'},['accent']),playback:'pingpong'
  }});
  close(track.frame(1).sample(.5),[249/255,199/255,97/255]);
  close(track.frame(2).sample(0),[0,34/255,68/255]);
  close(track.frame(4).sample(0),[34/255,0,0]);
  assert.deepEqual(track.frame(3).outputPalette,track.frame(1).outputPalette);
  const held = K.palette.ramp({...base,animation:{...animation({shadow:'#0000ff'}),interpolation:'step'}});
  close(held.frame(2-.001).sample(0),[34/255,0,0]);
  close(held.frame(2).sample(0),[0,0,1]);
  close(held.frame(99).sample(0),[0,0,1]);
});

function panel(interpolation) {
  const b = makeBuilder(42,[0x0c101b,0xff0000,0x00ff00]), s = K.sculpt(makeSculpt(b));
  const primary = {type:'primary',shadow:'base',accent:'spark',highlight:'base',steps:5,
    animation:{ ...animation({shadow:'change',highlight:'change',accent:'change'},['accent']),interpolation }};
  const m = K.surface.material({r:[0],em:true,materialId:'panel'},{
    paletteRoles:{base:'paint',spark:'accent',change:'#00ff00'},
    layers:{ face:{type:'projected',pattern:'palette-ramp',paletteRamp:{...primary,size:[2.4,1]},
      projection:{origin:[-1.2,-.5,.13],along:[1,0,0],across:[0,1,0]}} }
  });
  s.box([0,0,0],[1.2,.5,.12],m,{res:.045,rd:.035});
  s.bake();
  return b.finish({ paletteRoles:{paint:[1],accent:[1]},look:{splatCoverage:'continuous'},dither:0,
    cam:{ target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0 } });
}

test('native material exports resolve against the palette sampled for that frame', () => {
  const world = panel('linear'), opts = {w:84,h:52,px:1,ortho:true};
  function count({rgb}, color) {
    let n = 0;
    for (let i=0;i<rgb.length;i+=3)
      n += Number((rgb[i]<<16 | rgb[i+1]<<8 | rgb[i+2]) === color);
    return n;
  }
  const first = ink.render(world,{...opts,t:0});
  const half = ink.render(world,{...opts,t:1});
  const end = ink.render(world,{...opts,t:2});
  assert.equal(count(first,0x808000),0);
  assert(count(half,0x808000)>5);
  assert(count(end,0x00ff00)>5);
  assert(count(end,0xff0000)>5);
  assert.deepEqual(ink.render(world,{...opts,t:1}).rgb,half.rgb);
});

test('visible transition review suppresses gradual slot replacement and flags an authored jump', () => {
  const plan = { fps:12, paletteMode:'visible', events:[{id:'key',at:2}], thresholds:{pixelDelta:.1,popFraction:.02,paletteDelta:.04} };
  const view = {ortho:true};
  const smooth = ink.transitionReview(panel('linear'),{plan,view,width:64,height:40}).report;
  assert.equal(smooth.flagCount,0);
  assert(smooth.events[0].steps[0].screen.metrics.paletteReplacement>.04);
  const cut = ink.transitionReview(panel('step'),{plan,view,width:64,height:40}).report;
  assert(cut.events[0].steps[1].screen.flags.some(flag=>flag.kind==='palette-change'));
});

test('time samples atmospheric bands, shared sky lighting and fog colors without changing density', () => {
  const pigment = {type:'bands',stops:[{at:0,color:'#ff0000'},{at:.7,color:'#ffe38c'}],
    animation:animation({palette:['#0000ff','#00ff00']},[1])};
  const settings = {sunStrength:0};
  const sky = SkyEnvironment.compile({ defaults:settings,sky:{ paletteField:{source:'elevation',domain:[0,1],field:pigment} } });
  close(SkyEnvironment.shade(sky.frame(1).sky,[0,0,1]),[.5,0,.5]);
  close(SkyEnvironment.shade(SkyEnvironment.forReflection(sky.frame(2).sky),[0,0,1]),[0,0,1]);
  const patch = { domain:[0,2],field:pigment };
  const fog = SceneOptics.fog({density:.2,paletteField:patch});
  const trace = time => SceneOptics.trace(SceneOptics.prepareVolumes([fog],[],undefined,undefined,time),[0,0,0],[0,0,1],1);
  const warm = trace(0), cool = trace(2);
  assert(warm[0]>.1 && cool[2]>.1);
  close([warm[3]],[cool[3]]);
  const card = CloudField.compile({bounds:{min:[-2,-2],max:[2,2]},resolution:[4,4],coverage:Array(16).fill(.8),
    height:1,thickness:1,paletteField:{source:'altitude',...patch}});
  const colorAt = time => card.frame(time).paint([0,1,-4],[0,0,1],[0,0,0]);
  assert(colorAt(0)[0] > colorAt(0)[2]);
  assert(colorAt(2)[2] > colorAt(2)[0]);
});
