'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const {inflateSync}=require('node:zlib');
const {KIT:K}=require('..').load();
const PNG=require('../cli/png.js');
const api=K.procedural.paintEffects;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');

const site={kind:'surface',slot:'face',snap:{mode:'surface',direction:[0,0,1],maxDistance:.24}};
const line=(id,x,extra)=>({id,mat:'ember',brush:{kind:'sphere',radius:.075},step:.028,res:.045,attachment:site,
  poses:[{point:[x,-.52,.21]},{point:[x,.54,.21]}],...extra});
const flow={...K.flowMap.create({width:4,height:4,bounds:[-.9,-.7,.9,.7]}).asset(),
  vectors:Array.from({length:16},()=>[.24,0]).flat()};
const source={id:'effects-test',seed:3,camera:{target:[0,0,0],dist:3.9,yaw:0,pitch:0,sway:0,projection:'orthographic'},
  timeline:{duration:1,markers:[{id:'open',time:.125},{id:'burst',time:.375},{id:'finish',time:.875}]},
  solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.9,.7,.12],mat:'stone',res:.058}],
  paintings3d:[{id:'lines',bindings:{face:'plate'},painting:{id:'ink',format:K.authoring.paintings3d.format,version:1,
    flowMaps:{current:flow},marks:[line('thread',-.48,{relief:{mode:'flat'}}),
      line('raised',.06,{relief:{mode:'volume',height:.1}}),
      line('under-glow',.54,{relief:{mode:'flat'}}),
      line('glow',.54,{finish:{emission:{color:'#27bddc',strength:.8}}})]}}]};
const clip=(id,kind,mark,effect,extra)=>({id,kind,painting:'lines',marks:[mark],range:['open','finish'],effect,...extra});
const track={id:'study',format:api.format,version:1,clips:[
  clip('flow','flow','thread',{field:'current'},{fade:[.125,0]}),
  clip('wave','wave','thread',{root:{at:[-.48,-.52,.21],axis:[0,1,0],length:1.06,lock:.09},
    amplitude:.12,frequency:1,base:{direction:[1,0,0]}}),
  clip('boil','boil','thread',{amplitude:.04,seed:4,cadence:{fps:8,holds:[2]}}),
  clip('throb','throb','raised',{drivers:{cue:{type:'cue',cues:{peak:.25},duration:.75,keys:[
    {at:0,value:0},{cue:'peak',value:1},{at:.75,value:0}]}},channels:{height:{driver:'cue',range:[1,2.2]}}},
    {mask:{points:[[.06,.45,.13]],radius:.37,feather:.4}}),
  clip('release','evaporate','glow',{region:{points:[[.54,.39,.12]],radius:.25},start:0,end:.22,
    life:.45,spacing:.07,velocity:[.30,.54,.17]}, {range:['burst','finish'],after:'hold'})
]};

test('shared cue fades and brush erasers mix field motion and height only where authored',()=>{
  const edits=track.clips.filter(row=>row.kind!=='evaporate');
  const eraser={id:'root',points:[[-.48,-.52,.2]],radius:.22,feather:.3};
  const scene={...source,paintEffects:{...track,clips:edits.map(row=>row.id==='flow'?{...row,erasers:[eraser]}:row)}};
  const {reports,spec}=api.scene(scene,.1875);
  assert.equal(reports[0].weight,.5);
  const moved=spec.paintings3d[0].painting.marks[0].poses;
  assert.equal(moved[0].point[0],-.48);
  assert(moved.at(-1).point[0]>-.475);
  const f=K.diorama.brushField(scene,{parameterInputs:{time:.375}});
  assert(f.sdf(.06,.42,.29)<0);
  assert(f.sdf(.06,-.37,.29)>0);
  const glow=clip('glow','throb','glow',{drivers:{beat:{type:'oscillator',frequency:2}},
    channels:{emission:{driver:'beat',range:[.5,2]}}});
  const pulsing={...scene,paintEffects:{...scene.paintEffects,clips:[...scene.paintEffects.clips,glow]}};
  const lum=K.diorama.brushField(pulsing,{parameterInputs:{time:.375}}), spot=[.54,.1,.12];
  const read=S=>S.materialAt(S.surfaceAt(...spot).material,spot,[0,0,1]).paintFinishSample[12];
  assert(read(lum)>read(f));
  const after=api.scene(scene,.875);
  assert(after.reports.every(row=>row.weight===0));
  assert.deepEqual(after.spec.paintings3d,source.paintings3d);
});

test('headless track plays and bakes all five effects, with local erasing and a matching frozen pose',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-effects-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=name=>path.join(dir,name);
  const put=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value));
  const call=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,stdio:'pipe',encoding:'utf8'});
  const go=(...args)=>JSON.parse(call('paint-effects',...args));
  put('source.json',source);
  put('track.json',track);
  const added=go('apply','source.json','track.json','--out','track-scene.json');
  assert.equal(added.clips.length,5);
  assert(added.duration>1);
  const saved=JSON.parse(fs.readFileSync(at('track-scene.json')));
  const layer=saved.paintEffects.clips[4].effect;
  assert(layer.particles.some(row=>row.emission[2]>.4));
  put('erase.json',{id:'shield',points:[[.54,.39,.12]],radius:.085,feather:.2});
  go('erase','track-scene.json','release','erase.json','--out','erased.json');
  const receipt=go('inspect','erased.json','--at','.625','--point','.54,.39,.12');
  assert.equal(receipt.clips.find(row=>row.id==='release').influence,0);
  go('sample','erased.json','--at','.625','--out','held.json');
  const view=['--w','96','--h','82','--raw','--ortho'];
  const film=go('bake','erased.json','--out','film','--from','0','--fps','8','--frames','8',...view,'--flipbook');
  assert.equal(film.frames[5].time,.625);
  assert.equal(film.flipbook,'flipbook.png');
  call('render','held.json','--t','.625','--px','1',...view,'--out','held.png');
  call('render','erased.json','--t','.625','--px','1',...view,'--out','sought.png');
  const frame=PNG.raster(at('film/frame-006.png')).data;
  assert.deepEqual(frame,PNG.raster(at('held.png')).data);
  assert.deepEqual(frame,PNG.raster(at('sought.png')).data);
  call('clip','erased.json','--from','0','--to','1','--fps','8','--px','1',...view,'--out','live.png');
  const settings={w:96,h:82,count:8,fps:8};
  const readFrames=name=>PNG.readFullFrameAnimation(at(name),settings).map(row=>inflateSync(row.compressed));
  assert.deepEqual(readFrames('film/flipbook.png'),readFrames('live.png'));
  assert.notDeepEqual(frame,PNG.raster(at('film/frame-001.png')).data);
  assert.deepEqual(JSON.parse(fs.readFileSync(at('source.json'))),source);
});
