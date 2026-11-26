const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT:K } = require('../..').load();
const { compile } = require('../../cli/character-rig-assembly.js');
const PNG = require('../../cli/png.js');
const WAV = require('../../cli/wav.js');
const files = require('../../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'out/breakwater-relay');
const file = (...name)=>path.join(out,...name);
const save = (name,data)=>files.json(file(name),data);
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
function run(...args) {
  const output=execFileSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:32*1024**2});
  return output.trim()?JSON.parse(output):undefined;
}
const ratio = (numerator,denominator=1)=>({numerator,denominator});
const fps = ratio(24000,1001), count = 96;
const audioRate = 24000, sampleOrigin = 4800, simRate = 12000;
const pulses = [[.45,.55,158],[1.56,.65,189],[2.82,.69,133]];
function signal(time) {
  return pulses.reduce((sum,[start,duration,pitch],i)=>{
    const t=time-start;
    if (t<0||t>=duration) return sum;
    const a=2*Math.PI*t*(pitch+[35,-25,39][i]*t);
    return sum+(Math.sin(a)+.25*Math.sin(a*2)+.09*Math.cos(a*3))*Math.sin(Math.PI*t/duration)**1.2;
  },0);
}
const samples = Array.from({length:audioRate*4},(_,i)=>.45*signal((i+sampleOrigin)/audioRate));
files.write(file('intake.wav'),WAV.encode({sampleRate:audioRate,channels:1,samples},
  {encoding:'pcm24',bwf:{description:'Breakwater intake',timeReference:sampleOrigin}}));

const wave = {format:K.world.waveNetworks.runFormat,version:1,samples:Math.ceil(simRate*4.08),
  network:{format:K.world.waveNetworks.format,version:1,id:'relay-pipe',
    nodes:{inlet:{},outlet:{}},tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:69,area:.0048}]}},
    observations:{intake:{tube:'bore',t:.06},relay:{tube:'bore',t:.93}}},
  settings:{method:'delay',sampleRate:simRate,loss:.002,sources:{drive:{kind:'flow',node:'inlet'}},
    terminations:{inlet:{kind:'reflect',coefficient:.48},outlet:{kind:'reflect',coefficient:-.43}}}};
wave.inputs={drive:Array.from({length:wave.samples},(_,i)=>.000037*signal(i/simRate))};
save('pressure-plan.json',wave);
run('sim','waves',file('pressure-plan.json'),'--out',file('pressure.json'));
assert.equal(read('pressure.json').info.sampleRate,simRate);

const skeleton = {format:'ink-studio/character-rig',version:1,id:'relay-boom',components:[],joints:[
  {id:'boom.pivot',parent:null,at:[0,0,0],limit:{type:'hinge',axis:[0,0,1],angle:[0,90]}},
  {id:'boom.tip',parent:'boom.pivot',at:[1,0,0],limit:{type:'fixed'}}
]};
save('rig.json',skeleton);
const key = (time,value)=>({time,value:[value],ease:'smooth'});
save('motion.json',{format:'ink-studio/character-motion',version:1,id:'relay-scan',rigHash:compile(skeleton,K).hash,
  clips:{
    sweep:{type:'curves',duration:4.1,joints:{'boom.pivot':[
      key(0,4),key(.35,12),key(1.24,69),key(1.83,26),key(2.43,63),key(3.26,48),key(4.1,4)]}},
    scan:{type:'mix',duration:4.1,layers:[{id:'sweep',at:0,clip:'sweep'}]}
  }});
const map = (input,output,unit='1')=>({input,output,unit});
const resample = (input,method)=>({op:'resample',input,method});
const lowpass = (input,seconds)=>({op:'filter',input,mode:'lowpass',seconds});
const normalize = (input,range)=>({op:'filter',input,mode:'map',map:map(range,[0,1])});
const plan = {format:'ink-studio/channel-plan',version:1,id:'breakwater-relay',clock:{rate:fps,frames:count},
  sources:{
    intake:{kind:'audio',file:'intake.wav'},
    pipe:{kind:'simulation',file:'pressure.json',options:{measure:'pressure'}},
    boom:{kind:'animation',rig:'rig.json',file:'motion.json',clip:'scan'}
  },stages:{
    audioRms:resample('intake/ch1','rms'),
    relayRms:resample('pipe/relay','rms'),
    inletRms:resample('pipe/intake','rms'),
    audioSmooth:lowpass('audioRms',.075),
    relaySmooth:lowpass('relayRms',.095),
    audioLevel:normalize('audioSmooth',[0,.31]),
    pressureLevel:normalize('relaySmooth',[0,1.22]),
    boomLevel:normalize('boom/boom.pivot.angle',[0,72]),
    energy:{op:'blend',missing:'zero',inputs:[{input:'audioLevel',weight:.42},{input:'pressureLevel',weight:.41},
      {input:'boomLevel',weight:.17}]}
  },traces:{
    audioRms:'audioRms',audioSmooth:'audioSmooth',relayRms:'relayRms',relaySmooth:'relaySmooth',inletRms:'inletRms',
    boomDegrees:'boom/boom.pivot.angle',
    audio:'audioLevel',pressure:'pressureLevel',boom:'boomLevel',energy:'energy'
  },routes:{
    intakeMeter:{input:'audioLevel',map:map([0,1],[2,53],'px'),fallback:2},
    pistonTravel:{input:'pressureLevel',map:map([0,1],[118,78],'px')},
    scannerX:{input:'boomLevel',map:map([0,1],[136,281],'px')},
    relayGlow:{input:'energy',map:map([0,1],[2,86],'px')}
  }};
save('channels.json',plan);
for (const [verb,arg,name] of [['discover',null,'catalog'],['resample','audioRms','audio-rms'],
  ['filter','audioSmooth','audio-filtered'],['blend','energy','energy'],['run',null,'comparison'],['route',null,'controls']])
  run('channels',verb,file('channels.json'),...(arg?[arg]:[]),'--out',file(name+'.json'));
const traces = read('comparison.json'), {values:audio} = traces.traces.audioRms;
const firstAudio = audio.findIndex(Number.isFinite);
const arrival = key=>traces.traces[key].values.findIndex(value=>value>.13);
assert.equal(firstAudio,5);
assert(arrival('relayRms')>arrival('inletRms')+1);
assert(traces.traces.energy.max>.38);
assert.equal(traces.sources.intake.timeReference,'4800');

const navy='#0c1e29', panel='#142f3b', dark='#0b171f', copper='#d18c61', teal='#6cd3c4', sky='#add8d6',
  light='#ffe0a0', blue='#75a4ed', stone='#456773', trim='#244958';
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const poly=(points,fill,stroke)=>({type:'path',points,closed:true,fill,...(stroke&&{stroke})});
const ellipse=(x,y,w,h,fill,stroke)=>({type:'ellipse',rect:[x,y,w,h],fill,...(stroke&&{stroke})});
const text=(text,x,y,color=sky,scale=1)=>({type:'text',text,at:[x,y],scale,color});
const commands=[
  rect(0,0,320,164,navy),rect(0,116,320,48,'#102732'),
  poly([[0,126],[48,121],[105,131],[172,122],[230,133],[320,120],[320,164],[0,164]],'#153640'),
  rect(0,44,32,94,'#102a36'),rect(21,34,19,99,trim),rect(30,26,3,18,stone),
  rect(11,122,298,27,dark),poly([[11,122],[24,114],[307,114],[318,122]],stone),
  rect(12,124,306,4,'#234756'),rect(20,142,286,2,trim),
  poly([[29,67],[51,52],[300,52],[308,66],[308,119],[29,119]],'#1b3b49',stone),
  rect(34,76,274,35,'#112832'),rect(34,110,274,7,'#10232c'),
  rect(43,54,250,2,'#50727b'),rect(44,96,245,3,'#a36e55'),
  rect(48,101,243,3,'#774f42'),rect(46,91,244,4,'#c58158'),
  rect(43,88,22,20,'#263e46'),rect(263,87,28,21,'#263e46'),
  ellipse(37,82,26,32,'#242d32',copper),ellipse(42,88,16,20,dark,'#9b644b'),
  ellipse(285,82,21,31,'#303843',copper),ellipse(289,86,13,23,dark,'#9c7360'),
  rect(127,65,166,8,dark),rect(130,66,161,3,'#485e69'),
  rect(125,61,8,16,trim),rect(289,61,8,16,trim),
  rect(68,62,52,60,'#23414d'),rect(74,63,42,58,'#0c1e28'),
  rect(75,68,11,47,'#183541'),rect(105,68,10,47,'#1c3743'),
  rect(129,130,102,8,'#12232c'),rect(130,130,98,2,'#3a5962'),
  rect(238,130,57,8,'#12232c'),rect(243,132,21,2,'#365461'),rect(244,135,16,2,'#365461'),
  text('BREAKWATER RELAY',43,15,light,2),text('INTAKE',39,77,teal),text('SCAN RAIL',151,56,blue),
  text('PRESSURE',72,124,copper),text('RELAY LOAD',132,146,light)
];
for (let x=18;x<316;x+=24) commands.push(rect(x,156,8,2,'#315862'));
for (let x=138;x<285;x+=13) commands.push(rect(x,69,1,4,'#294652'));
for (let y=69;y<115;y+=7) commands.push(rect(77,y,4,1,'#486775'),rect(109,y,4,1,'#486775'));
const targets=[];
function dynamic(control,command,field) {
  targets.push({control,path:'/commands/'+commands.length+'/'+field});
  commands.push(command);
}
dynamic('intakeMeter',rect(47,118,2,3,teal),'rect/2');
dynamic('pistonTravel',rect(89,118,13,6,copper),'rect/1');
dynamic('pistonTravel',rect(91,118,9,2,light),'rect/1');
dynamic('scannerX',rect(136,64,9,8,blue),'rect/0');
dynamic('scannerX',rect(136,64,6,2,'#e1e9ff'),'rect/0');
dynamic('relayGlow',rect(133,133,2,3,light),'rect/2');
const graph = {format:'ink-studio/graph-project',version:1,inputs:{controls:{type:'record'}},nodes:{
  bind:{op:'scene.bindControls',inputs:{controls:{input:'controls'},template:{commands},targets}},
  commands:{op:'data.get',inputs:{record:{node:'bind'},key:'commands'}},
  render:{op:'draw.render',inputs:{width:320,height:164,edges:'hard',commands:{node:'commands'}}}
},outputs:{picture:{node:'render'}}};
save('relay.graph.json',graph);
const rendered=run('graph','clip',file('relay.graph.json'),'--output','picture','--from','0','--to',String(count),
  '--fps','24000/1001','--format','both','--controls',file('controls.json'),'--out',file('playback'));
assert(rendered.passed && rendered.frames.length===count &&
  new Set(rendered.frames.map(frame=>frame.sha256)).size>60);
assert.equal(rendered.controlRoute.clock.rate.denominator,1001);

const W=844,H=468, heading='#efdaa9', muted='#7ca0a7', grid='#2d5058', capture=[9,39,77];
const sheet=[
  rect(0,0,W,H,'#0b1923'),text('BREAKWATER RELAY',24,18,heading,3),text('HEADLESS CHANNEL ROUTING',660,27,muted),
  rect(24,55,796,1,grid),text('THREE INPUT CLOCKS / ONE PICTURE CLOCK',24,66,sky),
  text('24,000 HZ PCM   /   12,000 HZ PRESSURE   /   ANIMATION IN SECONDS',24,83,muted),
  rect(24,102,796,1,grid),text('ROUTED PLAYBACK',24,118,heading),text('STACKED TRACES / 24000/1001 FPS',408,118,heading),
  rect(408,135,412,265,'#102630'),rect(24,435,796,1,grid),
  text('WAV ORIGIN  +0.200 S',24,450,muted),
  text('FILTERED INPUTS BLEND INTO RELAY LOAD',302,450,muted),
  text('96 MATCHED FRAMES',708,450,muted)
];
const onsets={intake:arrival('inletRms'),relay:arrival('relayRms')};
const lanes=[
  {name:'audioSmooth',label:'AUDIO ENVELOPE  0-0.36 FS',color:teal,max:.36},
  {name:'relaySmooth',label:'PIPE PRESSURE  0-2.2 PA',color:copper,max:2.2},
  {name:'boomDegrees',label:'BOOM SWEEP  0-90 DEG',color:blue,max:90},
  {name:'energy',label:'BLENDED RELAY LOAD  0-1',color:light,max:1}
];
const X=i=>423+378*i/(count-1);
for(const [i,{name,label,color,max}] of lanes.entries()){
  const y=148+i*58;
  sheet.push(text(label,423,y,color),rect(423,y+42,378,1,grid));
  let points=[];
  function flush(){if(points.length>1)sheet.push({type:'path',points,color,width:2});points=[];}
  for(const [j,value] of traces.traces[name].values.entries()){
    if(value===null)flush();
    else points.push([X(j),y+41-26*value/max]);
  }
  flush();
}
for(const [number,index] of capture.entries()){
  const x=Math.round(X(index));
  sheet.push(rect(x,146,1,229,'#385e66'),text(String(number+1),x-2,379,muted));
}
sheet.push(text('0 S',423,389,muted),text('4 S',788,389,muted),
  text('PRESSURE ARRIVES '+(onsets.relay-onsets.intake)+' FRAMES AFTER INTAKE',408,414,muted));
const final = K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:sheet});
function copy(name,x,y) {
  const image=PNG.raster(file('playback',name));
  for(let row=0;row<image.h;row++){
    const first=row*image.w*4, at=((y+row)*W+x)*4;
    final.data.set(image.data.subarray(first,first+image.w*4),at);
  }
}
copy(rendered.frames[capture[2]].file,24,135);
const previews = capture.map(index=>PNG.raster(file('playback',rendered.frames[index].file)));
for (const [i,image] of previews.entries()) {
  const x=24+i*116,y=329;
  for(let yy=0;yy<51;yy++) for(let xx=0;xx<108;xx++) {
    const from=(Math.floor(yy*image.h/51)*image.w+Math.floor(xx*image.w/108))*4;
    final.data.set(image.data.subarray(from,from+4),((y+yy)*W+x+xx)*4);
  }
}
const foot = K.procedural.drawing2d.render({width:350,height:19,edges:'hard',commands:[
  rect(0,0,350,19,'#0b1923'),...capture.map((frame,i)=>text((i+1)+' / '+(frame*1001/24000).toFixed(2)+' S',116*i,4,muted))
]});
for(let i=0;i<foot.height;i++) final.data.set(foot.data.subarray(i*350*4,(i+1)*350*4),((384+i)*W+24)*4);
files.write(file('breakwater-relay.png'),PNG.encode(W,H,final.data,4));
save('demo-report.json',{image:'breakwater-relay.png',loop:'playback/clip.png',trace:'comparison.json',routes:'controls.json',
  fps,frames:count,onsets,firstAudioFrame:firstAudio,origin:traces.sources.intake.clock.origin,
  selectedFrames:capture,distinctFrames:new Set(rendered.frames.map(frame=>frame.sha256)).size,stats:rendered.controlRoute});
console.log(file('breakwater-relay.png'));
