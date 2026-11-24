const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, makeBuilder, makeSculpt, SurfaceLook, ArtInk } = require('..').load();
const { render } = require('../cli/render');
const { pixelStamps: stamps } = K;

const rectangle = (slot, ...rect) => ({ slot, shape: { type:'rect', rect } });
const sample = (position, time) => ({ position, worldPosition:position, time, normal:[0,1,0],view:[0,1,0] });

test('hard indexed paint orders shapes, keeps slot zero and erases to transparent', () => {
  const slots=[0,0,0,null,null,null,null,null];
  const art={width:4,height:2,palette:['#563349','#a9bd94'],slots,strokes:[
    {slot:1,shape:{type:'polygon',points:[[0,0],[4,0],[4,2],[0,2]]}},
    {slot:0,shape:{type:'path',points:[[.5,.5],[3.5,.5]],width:1}},
    rectangle(null,1,0,1,1)
  ]};
  assert.deepEqual(stamps.paint(4,2,art),[0,null,0,0,1,1,1,1]);
  assert.deepEqual(art.slots,slots);
  assert.deepEqual(Array.from(stamps.image(art).rgba.slice(0,12)),[86,51,73,255,0,0,0,0,86,51,73,255]);
  assert.throws(()=>stamps.prepare({...art,frames:[{}]}),/either a single cel or a frame list/);
  assert.throws(()=>stamps.prepare({width:1,height:1,frames:[{duration:0}]}),/positive durations/);
});

test('literal rows preserve exact swatches, transparent gaps and even-width placement', () => {
  const art={width:4,height:3,rows:['.0..','1231','..0.'],palette:['#6291a9','#7ab4a8','#b9c9af','#f9e6bb']};
  assert.deepEqual(stamps.paint(4,3,art),[null,0,null,null,1,2,3,1,null,null,0,null]);
  assert.throws(()=>stamps.paint(4,3,{...art,rows:['.0..','123','..0.']}),/one palette character/);
  const expected=[[1,0,0],[0,1,1],[1,1,2],[2,1,3],[3,1,1],[2,2,0]];
  const palette=[0x121823,0x6291a9,0x7ab4a8,0xb9c9af,0xf9e6bb,0x374048];
  const at=[.39,.31,-.8];
  function world(stampAt, blocked) {
    const b=makeBuilder(21,palette);
    if (blocked) {
      const s=K.sculpt(makeSculpt(b));
      s.box([.39,.31,0],[.4,.4,.10],{r:[5]},{res:.053});
      s.bake();
    }
    return b.finish({cam:{target:[0,0,0],dist:7,pitch:0,yaw:0,sway:0},dither:0,
      pixelStamps:[{stamp:art,at:stampAt,nativePixels:true,pivot:{x:1.5,y:1}}]});
  }
  function occupied(frame) {
    const pixels=[];
    for (let y=0;y<frame.h;y++) for (let x=0;x<frame.w;x++) {
      const i=(y*frame.w+x)*3, rgb=frame.rgb;
      const swatch=palette.indexOf(rgb[i]*65536+rgb[i+1]*256+rgb[i+2]);
      if (swatch>0 && swatch<5) pixels.push([x,y,swatch-1]);
    }
    return pixels;
  }
  const scene=world(at), view={w:96,h:70,px:1};
  for (const camera of [{ortho:true,dist:4.4},{ortho:true,dist:11.8,yaw:.37,pitch:.26},{ortho:false,dist:6.71,yaw:.24,pitch:.32}]) {
    const on=occupied(render(scene,{...view,...camera}));
    const x0=Math.min(...on.map(([x])=>x)), y0=Math.min(...on.map(([,y])=>y));
    assert.deepEqual(on.map(([x,y,c])=>[x-x0,y-y0,c]),expected);
  }
  assert.equal(occupied(render(world(at,true),{...view,ortho:true})).length,0);
  assert.equal(occupied(render(world([at[0],at[1],1],true),{...view,ortho:true})).length,6);
  assert.throws(()=>stamps.place(art,{at,nativePixels:true,scale:.5}),/at scale 1/);
});

test('projected shape animation has exact holds, phase, color ownership and an independently sampled mask', () => {
  const effect={type:'projected',pattern:'indexed',ink:true,raster:{width:2,height:2,palette:['#ff0020',[0,1,0]],
    origin:'top-left',size:[2,2],phase:.1,frames:[{duration:.25,strokes:[rectangle(0,0,0,1,1)]},
      {duration:.5,strokes:[rectangle(1,1,0,1,1)]}]}};
  const prepared=SurfaceLook.prepare({layers:{effect}}), base=[.15,.2,.3];
  const read=(x,y,t)=>SurfaceLook.shade(prepared,sample([x,0,y],t),base).slice(0,3);
  assert.deepEqual(read(.5,1.5,.149),[1,0,32/255]);
  assert.deepEqual(read(.5,1.5,.15),base);
  assert.deepEqual(read(1.5,1.5,.15),[0,1,0]);
  assert.deepEqual(read(.5,1.5,.65),[1,0,32/255]);
  assert.deepEqual(read(1.5,1.5,.15),[0,1,0]);
  const mask=K.splatEffects.prepareMask({type:'indexed',raster:effect.raster,space:'world'});
  assert.equal(mask(sample([1.5,0,1.5],.2)),1);
  assert.equal(mask(sample([.5,0,1.5],.2)),0);
  assert.equal(mask(sample([1.5,0,.5],.2)),0);
});

test('stamp alpha survives playback, atlas sampling, and projected paint and masks', () => {
  const ink = { width:2,height:1,palette:['#ff0000'],origin:'top-left',
    frames:[{ slots:[0,0],alpha:[128,0] },{ slots:[0,0],alpha:[0,255] }],fps:2 };
  assert.deepEqual([...stamps.image(ink).rgba],[255,0,0,128,0,0,0,0]);
  assert.deepEqual([...stamps.image(ink,{ time:.5 }).rgba],[0,0,0,0,255,0,0,255]);
  const asset = stamps.atlas(ink);
  const texel = { color:[],normal:[],emission:[] };
  assert(asset.sample(asset.select(),0,0,{},texel));
  assert.equal(texel.alpha,128/255);
  const mask = K.splatEffects.prepareMask({ type:'indexed',raster:ink,interpolation:'linear' });
  assert.equal(mask(sample([.25,0,.5],0)),128/255);
  assert.equal(mask(sample([.75,0,.5],.5)),1);
  const effect = { type:'projected',pattern:'indexed',ink:true,raster:ink };
  const look = SurfaceLook.prepare({ layers:{ effect } });
  assert.deepEqual(SurfaceLook.shade(look,sample([.25,0,.5],0),[0,0,0]).slice(0,3),[128/255,0,0]);
  assert.deepEqual(SurfaceLook.shade(look,sample([.75,0,.5],0),[0,0,0]).slice(0,3),[0,0,0]);
  assert.throws(()=>stamps.prepare({ ...ink,frames:[{ slots:[0,0],alpha:[256,0] }] }),/one byte per texel/);
});

test('authored contours choose contrast from the backdrop and obey paint in rest space', () => {
  const width=6, rgb=Uint8Array.from([16,96,16,232,96,232].flatMap(v=>[v,v,v]));
  const passes={depth:Float32Array.from([Infinity,1,Infinity,Infinity,1,Infinity]),
    normal:new Float32Array(18),emission:new Float32Array(18),objectPosition:new Float32Array(18),
    splatId:new Uint32Array(6),objectId:new Uint32Array(6),materialId:new Uint32Array(6),materials:[null]};
  passes.objectPosition.set([.25,0,.5],3);
  passes.objectPosition.set([.75,0,.5],12);
  const definition={silhouette:{contrast:{ dark:'#111111',light:'#eeeeee',minGain:.1 }}};
  let settings=ArtInk.prepare(definition,[0]);
  let frame=ArtInk.apply({w:width,h:1,rgb:rgb.slice()},passes,settings,[0]);
  assert.equal(frame.rgb[3],238);
  assert.equal(frame.rgb[12],17);
  settings=ArtInk.prepare({silhouette:{...definition.silhouette,mask:{type:'indexed',raster:{width:2,height:1,slots:[0,null]}}}},[0]);
  frame=ArtInk.apply({w:width,h:1,rgb:rgb.slice()},passes,settings,[0]);
  assert.equal(frame.rgb[3],238);
  assert.equal(frame.rgb[12],96);
});

test('diorama stamp frames render protected swatches, transparent holes and behind foreground geometry', () => {
  const color=[0x171c24,0xd64a50,0x58b6a0,0x596673];
  const stamp={width:3,height:1,palette:['flare'],frames:[{duration:.25,slots:[0,0,null]},{duration:.5,slots:[null,null,0]}]};
  const spec={id:'stamp-fixture',palette:[...color,...Array(26).fill(color[0])],roles:{flare:[1]},
    camera:{target:[0,0,0],dist:5,yaw:0,pitch:0,projection:'orthographic',sway:0},
    solids:[{kind:'box',at:[0,0,.6],half:[.22,.44,.15],res:.05,mat:{ramp:[3]}}],
    finish:{pixelStamps:[{stamp,at:[0,0,0],unitsPerPixel:.62,emissionSlots:[0]}],dither:0}
  };
  assert.deepEqual(K.diorama.check(spec).filter(problem=>problem.level==='error'),[]);
  const world=K.diorama.build(spec), view={w:82,h:52,px:1};
  const read=t=>render(world,{...view,t,passes:['depth','emission']});
  const first=read(0), later=read(.26), loop=read(.75);
  const pixel=(frame,x,y)=>[...frame.rgb.subarray((y*82+x)*3,(y*82+x+1)*3)];
  assert.deepEqual(first.rgb,loop.rgb);
  assert.notDeepEqual(first.rgb,later.rgb);
  assert.deepEqual(pixel(first,41,26),pixel(later,41,26));
  assert.notDeepEqual(pixel(first,32,26),pixel(later,32,26));
  assert.notDeepEqual(pixel(first,50,26),pixel(later,50,26));
});

test('library presets expose editable indexed clips and named swatches', () => {
  const { clips, presets } = stamps.catalog();
  assert.deepEqual(presets.map(entry=>entry.id),['star','glint','bubble','ember','burst','glyph']);
  assert(clips.some(entry=>entry.id==='bubble-pop-small'));
  for (const {id} of clips) stamps.prepare(stamps.clip(id));
  for (const {id,variants} of presets) for (const variant of variants)
    assert(stamps.placements([{preset:id,variant,at:[0,0,0]}]).length);
  const original=stamps.clip('ember-chip');
  const recolor=stamps.clip('ember-chip',{swatches:{hot:'#fafaba'}});
  assert.deepEqual(original.frames,recolor.frames);
  assert.equal(recolor.palette[recolor.swatchRoles.indexOf('hot')],'#fafaba');
  recolor.frames[0].rows[0]='00000';
  assert.deepEqual(stamps.clip('ember-chip'),original);
  assert.throws(()=>stamps.clip('ember-chip',{swatches:{unknown:'#eeeeee'}}),/need roles/);
  assert.throws(()=>stamps.preset('bubble',{at:[0,0,0],period:1}),/whole effect/);
});

test('signal glyph cels open exact holes and the stream loops independently of the specimen', () => {
  const outline = stamps.clip('glyph-outline-cross');
  const { rgba } = stamps.image(outline, { time: .15 });
  assert.equal(rgba[(3 * 7 + 3) * 4 + 3], 0);
  assert.equal(rgba[(3 * 7) * 4 + 3], 255);

  const example = require('../examples/signal-fall')({ KIT: K, makeBuilder });
  const world = example.build(example.seed);
  const frame = t => render(world, { w: 388, h: 240, px: 1, t }).rgb;
  const first = frame(0), later = frame(.32);
  assert.notDeepEqual(first, later);
  assert.deepEqual(frame(4), first);
  assert.deepEqual(frame(.32), later);
  for (let y = 0; y < 240; y++) {
    const start = (y * 388 + 204) * 3, end = (y + 1) * 388 * 3;
    assert.deepEqual(first.subarray(start, end), later.subarray(start, end));
  }
});

test('native stamp cues hide outside their window and move whole pixels through out-of-order seeks', () => {
  const b=makeBuilder(17,[0x151923,0x2d444e]);
  const spec={width:2,height:1,rows:['01'],palette:['#ecc887','#df6860']};
  const world=b.finish({cam:{target:[0,0,0],dist:5,pitch:0,yaw:0,sway:0,projection:'orthographic'},dither:0,
    pixelStamps:[{stamp:{...spec,fps:2},at:[0,0,0],nativePixels:true,keepSwatches:true,
      cue:{start:.5,period:1},offsets:[[0,0,0],[.25,4,-2]]}]});
  function points(t) {
    const frame=render(world,{w:61,h:41,px:1,t}), result=[];
    for (let i=0;i<frame.rgb.length;i+=3) {
      const value=(frame.rgb[i]<<16)|(frame.rgb[i+1]<<8)|frame.rgb[i+2];
      if (value===0xecc887 || value===0xdf6860) result.push([i/3%frame.w,Math.floor(i/3/frame.w),value]);
    }
    return result;
  }
  const origin=points(.5);
  assert.equal(origin.length,2);
  assert.deepEqual(points(.75),origin.map(([x,y,color])=>[x+4,y-2,color]));
  assert.deepEqual(points(.49),[]);
  assert.deepEqual(points(1),[]);
  assert.deepEqual(points(1.5),origin);
});

test('JSON presets use their own swatches and start a bubble pop at the rise endpoint', () => {
  const background=0x11141f, base=0x476771, hot=0xf57db1;
  const spec={id:'bubble-preset-fixture',palette:[background,base,...Array(28).fill(background)],
    solids:[],camera:{target:[0,0,0],dist:5,yaw:0,pitch:0,projection:'orthographic',sway:0},
    finish:{dither:0,pixelStamps:[{preset:'bubble',at:[0,-.9,0],start:.25,swatches:{catchlight:'#f57db1'}}]}};
  assert.deepEqual(K.diorama.check(spec).filter(problem=>problem.level==='error'),[]);
  const world=K.diorama.build(JSON.parse(JSON.stringify(spec)));
  const read=t=>render(world,{w:88,h:104,px:1,t});
  const empty=read(0), rise=read(.3), pop=read(1.64);
  assert.notDeepEqual(rise.rgb,empty.rgb);
  assert.notDeepEqual(pop.rgb,empty.rgb);
  assert([...pop.palette].includes(hot));
  assert.deepEqual(read(3).rgb,empty.rgb);
});
