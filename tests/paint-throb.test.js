'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {inflateSync}=require('node:zlib');
const {test}=require('node:test');
const {KIT:K}=require('..').load();
const PaintFinish=require('../src/paint-finish.js');
const PNG=require('../cli/png.js');
const WAV=require('../cli/wav.js');
const P=K.procedural.paintThrob;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const attach={kind:'surface',slot:'face',snap:{mode:'surface',direction:[0,0,1],maxDistance:.24}};
const stroke=(id,x,extra)=>({id,mat:'ember',brush:{kind:'sphere',radius:.08},step:.026,res:.052,
  poses:[{point:[x,-.42,.21]},{point:[x,.42,.21]}],attachment:attach,...extra});
const source={id:'throb-test',camera:{target:[0,0,0],dist:3.7,pitch:0,yaw:0,sway:0,projection:'orthographic'},
  timeline:{duration:1,markers:[{id:'beat',time:.25}]},
  solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.7,.65,.12],mat:'stone',res:.055}],
  paintings3d:[{id:'signals',bindings:{face:'plate'},painting:{id:'lines',format:K.authoring.paintings3d.format,version:1,
    marks:[stroke('ridge',-.3,{relief:{mode:'volume',height:.125,seat:.06}}),
      stroke('pigment',.06,{relief:{mode:'flat'}}),
      stroke('lamp',.39,{finish:{tint:{color:'#68e6d9'},emission:{color:'#1b72ee',strength:.8}}})]}}]};
const throb=(id,mark,drivers,channels)=>({format:P.format,version:1,id,painting:'signals',marks:[mark],drivers,channels});
const osc=(phase=0)=>({type:'oscillator',frequency:2,phase});
const lane=(driver,low,high)=>({driver,range:[low,high]});
const cue={type:'cue',timeline:true,keys:[
  {at:0,value:0,ease:'linear'},{cue:'beat',value:1},{cue:'beat',offset:.25,value:0},{at:1,value:0}
]};
const ridge=throb('ridge','ridge',{width:osc(),height:{...cue,keys:[
  {at:0,value:0},{cue:'beat',value:0},{at:.5,value:1},{at:1,value:1}
]}},{width:lane('width',.65,1.8),height:lane('height',.55,1.6)});
const pigment=throb('pigment','pigment',{cue},{coverage:lane('cue',0,1)});
const audio=throb('lamp','lamp',{feed:{type:'audio',file:'signal.wav',measure:'peak',rate:8,offset:.25}},
  {emission:lane('feed',0,1.5)});
const pcm={sampleRate:8000,channels:1,samples:Float64Array.from({length:4000},(_,i)=>i<2000?0:.8*Math.sin(2*Math.PI*i/20))};
const expectNear=(actual,wanted,tol=1e-6)=>assert(Math.abs(actual-wanted)<tol,JSON.stringify({actual,wanted}));
const field=(scene,time)=>K.diorama.brushField(scene,{parameterInputs:{time}});
const material=(S,p)=>S.materialAt(S.surfaceAt(...p).material,p,[0,0,1]);

test('width modulates the tangent footprint independently of the signed relief height',()=>{
  const scene={...source,paintThrobs:[ridge]};
  const thin=field(scene,0), wide=field(scene,.25), tall=field(scene,.5);
  assert(thin.sdf(-.3,0,.176)<0 && wide.sdf(-.3,0,.176)<0 && tall.sdf(-.3,0,.176)<0);
  assert(thin.sdf(-.3,0,.235)>0 && wide.sdf(-.3,0,.235)>0 && tall.sdf(-.3,0,.235)<0);
  assert(thin.sdf(-.198,0,.148)>0 && wide.sdf(-.198,0,.148)<0 && tall.sdf(-.198,0,.148)>0);
  const report=P.scene(scene,.25).reports[0];
  expectNear(report.channels.width,1.8);
  expectNear(report.channels.height,.55);
  assert.throws(()=>P.scene({...source,paintThrobs:[ridge,{...ridge,id:'copy'}]},0),/once/);
});

test('cue coverage leaves geometry fixed and embedded sound controls emission independently of tint',()=>{
  const embedded=P.bake(audio,()=>pcm);
  const scene={...source,paintThrobs:[pigment,embedded]};
  const dark=field(scene,0), cueOn=field(scene,.25), loud=field(scene,.625);
  const on=[.06,0,.12], lamp=[.39,0,.12];
  assert.equal(dark.sdf(...on),cueOn.sdf(...on));
  assert.notDeepEqual(material(dark,on).model?.color,material(cueOn,on).model?.color);
  const tint=material(cueOn,lamp).paintFinishSample;
  const lit=material(loud,lamp).paintFinishSample;
  assert.deepEqual(tint.slice(1,5),lit.slice(1,5));
  assert.equal(PaintFinish.emission(tint),undefined);
  assert(PaintFinish.emission(lit)[2]>.8);
  expectNear(P.scene(scene,.75).reports[1].channels.emission,0);
  const shifted={...scene,timeline:{duration:1,markers:[{id:'beat',time:.4}]}};
  expectNear(P.scene(shifted,.4).reports[0].channels.coverage,1);
});

test('the CLI embeds native WAV levels and headless seek matches the exported clip frame',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-throb-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=name=>path.join(dir,name);
  const put=(name,row)=>fs.writeFileSync(at(name),JSON.stringify(row));
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,stdio:'pipe',encoding:'utf8'});
  put('source.json',source);
  put('pulse.json',{...audio,drivers:{feed:{...audio.drivers.feed,measure:'rms',gain:2}}});
  fs.writeFileSync(at('signal.wav'),WAV.encode(pcm));
  const applied=JSON.parse(run('paint-throb','apply','source.json','pulse.json','--out','pulsed.json'));
  assert.deepEqual(applied.embeddedAudio,[{id:'feed',seconds:.5,frames:4}]);
  fs.renameSync(at('signal.wav'),at('archived.wav'));
  const report=(time)=>JSON.parse(run('paint-throb','inspect','pulsed.json','--at',String(time),'--pulse','lamp'));
  assert.equal(report(.25).pulses[0].channels.emission,0);
  expectNear(report(.625).pulses[0].channels.emission,1.5);
  const w=90,h=78,fps=8,opts=['--w',String(w),'--h',String(h),'--px','1','--ortho','--raw'];
  run('render','pulsed.json','--t','.625',...opts,'--out','seek.png');
  run('clip','pulsed.json','--from','0','--to','1','--fps',String(fps),...opts,'--out','clip.png');
  const frames=PNG.readFullFrameAnimation(at('clip.png'),{w,h,fps,count:8}), pose=PNG.raster(at('seek.png'));
  const rgb=Buffer.alloc(w*h*3);
  for(let i=0;i<w*h;i++) for(let c=0;c<3;c++) rgb[3*i+c]=pose.data[4*i+c];
  assert.deepEqual(inflateSync(frames[5].compressed),inflateSync(PNG.packFrame({w,h,rgb}).compressed));
  assert.notDeepEqual(frames[0].compressed,frames[5].compressed);
  assert.deepEqual(JSON.parse(fs.readFileSync(at('source.json'))),source);
});
