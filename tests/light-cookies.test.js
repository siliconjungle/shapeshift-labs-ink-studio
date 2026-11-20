const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT: K, VolumeLight, makeBuilder, makeSculpt } = ink.load();

const projector = {
  at:[0,0,2], direction:[0,0,-1], innerAngle:40, outerAngle:40, radius:8,
  color:'#ff0000', intensity:3, surfaceIntensity:12,
  cookie:{width:2,height:1,mask:[255,0],angle:33,roll:t=>t*180}
};
const lightAt = (spot, time=0) => K.atmosphere.lighting({ spots:[spot] }, [], { time });
const towardLight = (point, at = projector.at) => K.V.norm(at.map((value,i)=>value-point[i]));

test('a light cookie projects a byte mask by angle and evaluates its roll once per frame', () => {
  let updates = 0;
  const source = { ...projector, cookie:{ ...projector.cookie, roll(t) { updates++; return t*180; } } };
  const first = lightAt(source), turned = lightAt(source,1);
  assert.equal(updates,2);
  assert(first.animatedLocals);
  const weight = (media, point) => VolumeLight.spotWeight(media.locals[0],towardLight(point));
  assert.equal(weight(first,[-.5,0,1]),1);
  assert.equal(weight(first,[-1,0,0]),1);
  assert.equal(weight(first,[.5,0,1]),0);
  assert.equal(weight(turned,[-.5,0,1]),0);
  assert.equal(weight(turned,[.5,0,1]),1);
  assert.equal(weight(first,[0,0,3]),0);
  const blended = lightAt({ ...projector, cookie:{ ...projector.cookie, filter:'linear' } });
  assert.equal(weight(blended,[0,0,0]),.5);
  const narrow = lightAt({ ...projector, cookie:{ ...projector.cookie, angle:10 } });
  assert.equal(weight(narrow,[-.2,.25,1]),0);
  assert.throws(()=>lightAt({ ...projector, cookie:{ ...projector.cookie, mask:[256,0] } }),/mask needs bytes/);
  assert.throws(()=>lightAt({ ...projector, cookie:{ ...projector.cookie, mask:[0] } }),/byte mask/);
  assert.throws(()=>lightAt({ ...projector, cookie:{ ...projector.cookie, up:[0,0,-1] } }),/nonzero/);
});

function room() {
  const B = makeBuilder(4,[0x10141c,0x666666]), S = K.sculpt(makeSculpt(B));
  S.box([0,0,-1],[2,1.3,.15],{ r:[1], materialId:'wall' },{ res:.105 });
  S.bake();
  const field = K.procedural.density.bounded({ bounds:{min:[-1.8,-1,-.79],max:[1.8,1,.70]}, sample:()=>1 });
  return B.finish({
    cam:{target:[0,0,-.4],dist:5.7,yaw:0,pitch:0,sway:0,ortho:true},
    dither:0,radius:6,look:{splatCoverage:'continuous'},
    atmosphere:[K.atmosphere.field({field,density:.38,step:.12,color:'#ffffff',anisotropy:0})],
    volumeLighting:{ ambient:.13, spots:[projector] }
  });
}

test('the CPU renderer projects the same rotating pattern on a wall and through fog with independent gains', () => {
  const world = room(), view = {w:79,h:61,px:1,raw:true,captureFog:true,passes:['depth','position','materialId']};
  const draw = (patch={}, options={}) => ink.render(world,{...view,...options,
    volumeLighting:{...world.volumeLighting,spots:[{...projector,...patch}]}});
  const off = draw({intensity:0,surfaceIntensity:0});
  const surface = draw({}, {volumeLocalLights:false});
  const fog = draw({surfaceIntensity:0});
  const turned = draw({}, {t:1});
  const full = draw();
  const signs = {left:[],right:[]};
  for (let p=0; p<off.w*off.h; p++) {
    if (off.passes.materials[off.passes.materialId[p]] !== 'wall') continue;
    const [x,y] = off.passes.position.subarray(p*3,p*3+2);
    if (Math.abs(y)>.38 || Math.abs(x)<.35 || Math.abs(x)>1.1) continue;
    signs[x<0?'left':'right'].push(p*3);
  }
  assert(signs.left.length>30 && signs.right.length>30);
  const gain = (after,before,side) =>
    signs[side].reduce((sum,q)=>sum+after.rgb[q]-before.rgb[q],0)/signs[side].length;
  assert(gain(surface,off,'left')>12);
  assert(gain(fog,off,'left')>12);
  assert.equal(gain(surface,off,'right'),0);
  assert.equal(gain(fog,off,'right'),0);
  assert.equal(gain(turned,off,'left'),0);
  assert(gain(turned,off,'right')>25);
  assert(gain(full,surface,'left')>12);
  assert.deepEqual(full.fog,off.fog);
  assert.deepEqual(full.passes.depth,off.passes.depth);
});

test('the same occluder blocks a spot in air and on the wall', () => {
  const world = room(), options = {w:79,h:61,px:1,raw:true};
  // This plate spans the cone between the emitter and the bounds of the fog.
  const shadow = K.atmosphere.occluder((x,y,z)=>Math.abs(z-1.24)-.10);
  const draw = (patch, opt={}) => ink.render(world,{...options,...opt,
    volumeLighting:{ambient:.13,shadow,spots:[{...projector,...patch}]}});
  const off = draw({intensity:0,surfaceIntensity:0});
  const blocked = draw({});
  const fogOnly = draw({}, {volumeLocalShadows:false});
  const unblocked = draw({castsShadow:false});
  assert.deepEqual(blocked.rgb,off.rgb);
  assert.notDeepEqual(fogOnly.rgb,blocked.rgb);
  assert.notDeepEqual(unblocked.rgb,fogOnly.rgb);
});

test('JSON dioramas validate the light cookie and retain sculpt shadow casters for surface spots', () => {
  const spot = {...projector,cookie:{width:2,height:1,mask:[0,255]}};
  const spec = {id:'paper-lantern',finish:{volumeLighting:{spots:[spot]}},
    solids:[{id:'wall',kind:'box',at:[0,0,-1],half:[2,1,.15],mat:'stone'}]};
  const world = K.diorama.build(spec);
  assert.deepEqual(world.volumeLighting.spots[0].cookie,spot.cookie);
  assert(world.renderSdfs.length);
  assert.throws(()=>K.diorama.build({...spec,finish:{volumeLighting:{spots:[{...spot,cookie:[]}]}}}),
    /finish\.volumeLighting.*Spot cookie/s);
});
