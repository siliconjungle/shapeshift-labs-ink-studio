/* An audiovisual score study. World events, picture, and stereo stems use one score. */
const fs = require('node:fs');
const path = require('node:path');
const { KIT: K } = require('..').load();
const PNG = require('../cli/png.js');
const WAV = require('../cli/wav.js');
const { drawing2d, materials, raster } = K.procedural;
const { compile, harmony } = K.music.score;

const score = {
  tempoMap: { tempo: 120, beatsPerBar: 4, barsPerPhrase: 2, swing: .57 },
  key: { root:'C4',mode:'major' }, tuning:'just', duration:{ bar:8 }, endFade:.55,
  voices: [
    { id:'anchor',waveform:'sine', gain:.155,pan:-.34,attack:.51,release:.24,glide:.24,
      motion:{cyclesPerBar:2},partials:[[2,.16],[3,.08],[4,.035]] },
    { id:'glass',waveform:'triangle',phase:.31,gain:.117,pan:.36,attack:.62,release:.31,glide:.24,
      motion:{cyclesPerBar:2},partials:[[2,.10],[5,.03]] },
    { id:'prism',waveform:'sine',phase:.2,gain:.108,pan:.05,attack:.26,release:.25,glide:.27,
      motion:{cyclesPerBar:2},partials:[[2,.23],[3,.08],[6,.025]] },
    { id:'bass',waveform:'sine',phase:.16,gain:.218,attack:.075,release:.23,glide:.125,
      partials:[[2,.36],[3,.10],[4,.065]],motion:{cyclesPerBar:.5,follow:'fixed'},
      rhythm:{length:4,hits:[{beat:0,duration:1.4},{beat:2,duration:1.16,level:.8},{beat:3.5,duration:.48,level:.66}]} },
    { id:'spark',waveform:'triangle',phase:.08,gain:.103,attack:.012,release:.14,glide:.045,pan:-.2,
      motion:{cyclesPerBar:2,follow:'fixed'},partials:[[3,.18],[5,.085],[8,.045]],
      rhythm:{length:4,hits:[{beat:.5,duration:.38},{beat:1.25,duration:.39,level:.65},
        {beat:2.5,duration:.5,level:.95},{beat:3.25,duration:.59,level:.58}]} },
    { id:'tick',waveform:'pulse',phase:.25,duty:.27,gain:.037,attack:.006,release:.03,glide:.04,pan:.42,
      motion:{cyclesPerBar:4,follow:'fixed'},partials:[[5,.09],[9,.035]],
      rhythm:{length:4,hits:[{beat:.75,duration:.15,level:.42},{beat:1.5,duration:.19,level:.75},
        {beat:2.75,duration:.15,level:.5},{beat:3.5,duration:.21,level:.84}]} },
    { id:'stress',waveform:'sine',phase:.24,gain:.105,attack:.48,release:.38,glide:.2,pan:.19,
      partials:[[2,.05]],motion:{cyclesPerBar:3,follow:'fixed'} }
  ],
  harmonies: {
    home:{degree:1,notes:['C4','E4','G4','C3','C5','G3'],fade:.5},
    shift:{degree:6,notes:['A4','E4','C4','A2','E5','A3'],fade:.68},
    wide:{degree:4,notes:['C4','F4','A4','F2','F5','C3'],fade:.54},
    tension:{degree:5,size:4,voicing:{anchor:'D4',glass:'F4',prism:'B4',bass:'G2',spark:'G5',tick:'G3',stress:'Bb4'},fade:.4},
    resolve:{degree:1,voicing:{anchor:'C4',glass:'E4',prism:'G4',bass:'C3',spark:'C5',tick:'G3'},fade:.62}
  },
  changes:[
    {id:'home',harmony:'home',time:0},
    {id:'wide',harmony:'wide',time:{bar:4}},
    {id:'tension',harmony:'tension',time:{bar:5}},
    {id:'resolve',harmony:'resolve',time:{bar:6}}
  ],
  bindings:{
    anchor:{voice:'anchor',from:'pitch',colors:{C:'#79e3db',D:'#a9d7fa'},fallback:'#427f9e'},
    glass:{voice:'glass',from:'pitch',colors:{E:'#baaff8',F:'#a2c4ff'},fallback:'#7c88aa'},
    prism:{voice:'prism',from:'pitch',colors:{G:'#87d2ff',A:'#ffc68d',B:'#ff938e'},fallback:'#5878a2'},
    steps:{voice:'spark',from:'phase',scale:'majorPentatonic',range:[-1.4,.55]},
    push:{voice:'bass',from:'level',range:[0,1]},
    spread:{from:'roughness',pair:['prism','stress'],domain:[0,.85],range:[.065,.40]},
    texture:{from:'roughness',pair:['prism','stress'],range:[0,1]},
    excite:{from:'ratioFit',range:[.28,1]}
  }
};

const world = {
  id:'after-the-fifth',dt:1/60,systems:{score:{kind:'procedural-score',config:{score}}},
  timeline:{duration:16,events:[{id:'relay-latched',kind:'relay-latched',time:3.21}]},
  eventActions:{latch:{on:{kind:'relay-latched',system:'world'},actions:[
    {action:'score/change',args:{harmony:'shift',quantize:'bar'}}
  ]}}
};
const run = K.world.runtime.create(world);
run.advance(16*60);
const capture = run.query().probe('score/schedule').value;
const program = compile(capture.score,{requests:capture.requests});
const cueRequest = capture.requests[0];
const cue = program.events.find(event=>event.harmony==='shift');

const W=1040, H=608, fps=24, end=program.duration, tau=2*Math.PI;
const white='#f3f1fa', cool='#9aabc6', dim='#7182a2';
const ink = (hex,alpha) => hex.slice(0,7) + Math.round(alpha*255).toString(16).padStart(2,'0');
const clamp = x => Math.min(1,Math.max(0,x));
const rect = (x,y,w,h,fill,falloff) => ({type:'rect',rect:[x,y,w,h],fill,falloff});
const text = (x,y,label,color=white,scale=1) => ({type:'text',at:[x,y],text:label,color,scale});
const pathLine = (points,color,width=1,falloff) => ({type:'path',points,color,width,falloff});
const polygon = (points,fill) => ({type:'polygon',points,fill});
const radial = (center,radii,opacity) => ({type:'radial',center,radii,opacity});
const draw = commands => drawing2d.render({width:W,height:H,commands});
const dot = ([x,y],n,tint) => rect(x-n/2,y-n/2,n,n,tint);
const center = [691,298];
const orbitIds = ['anchor','glass','prism'];
const pilots = ['ANCHOR','GLASS','PRISM'];
const labels = {home:'C MAJOR',shift:'A MINOR',wide:'F MAJOR',tension:'G7 / CLUSTER',resolve:'C MAJOR'};
const short = {home:'C',shift:'Am',wide:'F',tension:'G7',resolve:'C'};
const grain = materials.blueNoise({width:32,seed:139});
const backdrop = raster.canvas({width:W,height:H});
for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
  const field = Math.exp(-((x-692)**2/66000+(y-270)**2/40000));
  const halo = Math.exp(-((x-879)**2/46000+(y-385)**2/31000));
  const v = (grain.sample(x,y)-.5)*(3+5*field);
  const i=(y*W+x)*4;
  backdrop.data[i]=8+13*field+2*halo+v;
  backdrop.data[i+1]=11+15*field+5*halo+v;
  backdrop.data[i+2]=20+33*field+8*halo+v;
  backdrop.data[i+3]=255;
}

function ellipsePoint(cx,cy,rx,ry,rotate,angle) {
  const x=rx*Math.cos(angle), y=ry*Math.sin(angle), c=Math.cos(rotate), s=Math.sin(rotate);
  return [cx+x*c-y*s,cy+x*s+y*c];
}
function arc(cx,cy,rx,ry,rotate,from,to,steps=84) {
  return Array.from({length:steps+1},(_,i) => ellipsePoint(cx,cy,rx,ry,rotate,from+(to-from)*i/steps));
}
function circle(cx,cy,r,fill) {
  return {type:'ellipse',rect:[cx-r,cy-r,r*2,r*2],fill};
}
const grid = {type:'registrationGrid',origin:[386.5,56.5],step:[76,54],markColor:'#a7bed5',
  color:'#536f9c34',guides:[...Array.from({length:9},(_,i)=>({axis:'v',index:i,span:[0,9]})),
    ...Array.from({length:10},(_,i)=>({axis:'u',index:i,span:[0,8],...(i%3===2 && {dash:[.04,.048]})}))],
  crosses:[{at:[0,0],size:13},{at:[8,0],size:11},{at:[0,9],size:10},{at:[8,9],size:11},{at:[4,4],size:8}]};
const staticFrame = draw([
  grid,
  pathLine([[38.5,40.5],[1001.5,40.5]],'#50628066'),
  pathLine([[38.5,553.5],[1001.5,553.5]],'#50628077'),
  pathLine([[356.5,62.5],[356.5,521.5]],'#50628066'),
  text(40,20,'INK / PROCEDURAL SCORE',cool),
  text(845,20,'OPTICAL SYNTHESIS',cool),
  text(40,76,'AFTER THE',white,3),text(40,107,'FIFTH',white,6),
  text(42,174,'A SCORE FOR LIGHT AND SOUND',cool),
  text(42,295,'VOICE',dim),text(142,295,'PITCH',dim),text(229,295,'PHASE',dim),
  text(42,400,'CIRCLE OF FIFTHS',cool),
  text(567,580,'BEATS',dim)
]);
const wheel = [190,475], wheelR = 49;
const wheelPoints = harmony.pitchClasses.map((name,i)=>({
  name, center:ellipsePoint(...wheel,wheelR,wheelR,0,-Math.PI/2+i*tau/12),
  label:ellipsePoint(...wheel,65,65,0,-Math.PI/2+i*tau/12)
}));
function wheelLayer(frame) {
  const active = harmony.pitchClass(frame.chord.root);
  const route = frame.chord.travel.path;
  const dots = route.map(name=>wheelPoints.find(point=>point.name===name).center);
  return [
    pathLine(arc(...wheel,wheelR,wheelR,0,0,tau,56),'#62749283'),
    ...(dots.length > 1 ? [pathLine(dots,ink(frame.bindings.prism,.68),1.15)] : []),
    ...wheelPoints.flatMap(({name,center,label})=>{
      const selected=harmony.pitchClass(name)===active;
      return [circle(...center,selected?4:2,selected?frame.bindings.prism:'#6d7fa0'),
        text(Math.round(label[0]-name.length*3),Math.round(label[1]-4),name,selected?white:cool)];
    })
  ];
}

function geometry(frame) {
  const {bindings,voices} = frame, [cx,cy] = center;
  const energy = bindings.push;
  const colors = orbitIds.map(id=>bindings[id]);
  const baseGlow = [cx+52*voices.prism.signal,cy-42*voices.glass.signal];
  const fan = voices.prism.signal*.33+bindings.steps*.28;
  const commands = [
    rect(386,56,608,490,ink(colors[2],.106),radial(baseGlow,[20,312])),
    {type:'rayFan',origin:[cx-153,cy+102],angles:[-1.37+fan,-.21+fan+bindings.spread],
      radii:[54,318],count:66,width:.58,color:ink(colors[2],.47),
      falloff:radial([cx-9,cy+16],[44,288])},
    pathLine(arc(cx,cy,224,224,0,0,tau,110),'#7c98c34d',.82,radial([cx-73,cy-135],[31,448])),
    pathLine(arc(cx,cy,199,199,0,.05,3.6,80),'#7c98c364',.72),
    pathLine([[cx-245,cy+.5],[cx+242,cy+.5]],'#91abd236',.75),
    pathLine([[cx+.5,cy-214],[cx+.5,cy+215]],'#91abd236',.75)
  ];

  for (const [i,id] of orbitIds.entries()) {
    const voice=voices[id], phase=voice.phase*tau, tone=colors[i];
    const rx=226-i*18+energy*(3-i), ry=76+i*14;
    const tilt=-.8+i*.79+(i===2 ? .28*voice.signal : .065*voice.signal);
    const star=ellipsePoint(cx,cy,rx,ry,tilt,phase);
    commands.push(pathLine(arc(cx,cy,rx,ry,tilt,0,tau),ink(tone,.29),.92));
    commands.push(pathLine(arc(cx,cy,rx,ry,tilt,phase-1.12,phase+.14,34),ink(tone,.14),6.1,radial(star,[6,120])));
    commands.push(pathLine(arc(cx,cy,rx,ry,tilt,phase-1.12,phase+.14,34),ink(tone,.88),1.55,radial(star,[4,136])));
    commands.push(circle(...star,4.1,tone),dot(star,2.2,white));
    for (let j=0;j<21;j++) {
      const p=ellipsePoint(cx,cy,rx,ry,tilt,j*tau/21);
      const scale=1+.5*Math.cos(j*1.7+i);
      commands.push(dot(p,scale,ink(tone,.29)));
    }
  }
  const trace = [];
  for (let i=0;i<=280;i++) {
    const t = i/280 * 1.9, a=voices.anchor, b=voices.glass, c=voices.prism;
    const x=Math.sin(tau*(t*a.rate+a.phase)), y=Math.sin(tau*(t*b.rate+b.phase));
    const z=Math.sin(tau*(t*c.rate+c.phase));
    trace.push([cx+x*77+z*33,cy+y*58-z*39]);
  }
  commands.push(pathLine(trace,ink(colors[1],.21),4.6),
    pathLine(trace,ink(colors[1],.38+.42*bindings.excite),1.17),circle(...trace[0],3.1,colors[0]));
  const accentAngle = bindings.steps;
  const slit = arc(cx,cy,240,240,0,accentAngle-.065,accentAngle+.065,14);
  commands.push(pathLine(slit,ink(colors[2],.22),7.5),pathLine(slit,colors[2],1.85));
  for (let i=1;i<4;i++) {
    const pulse = ((frame.beat/2+i/3)%1), radius = 20+159*pulse;
    commands.push(pathLine(arc(cx,cy,radius,radius,0,.6,2.55,36),
      ink(colors[0],.30*(1-pulse)*energy),.95));
  }
  return commands;
}

function captions(frame) {
  const {chord,bindings,voices,time,beat}=frame, output=[];
  const t = 42+510*clamp(time/end);
  const pending=time>=cueRequest.time && time<cue.time;
  const sign=pending?'RELAY / NEXT BAR':chord.id===cue.id?'RELAY / ON GRID':'CURRENT HARMONY';
  output.push(text(42,216,sign,pending?'#efbc84':cool),
    text(40,239,labels[chord.harmony],bindings.prism,3));
  for (const [i,key] of orbitIds.entries()) {
    const y=317+i*23, voice=voices[key];
    const event=chord.voices.find(entry=>entry.id===key);
    output.push(text(42,y,pilots[i],bindings[key]),text(142,y,voice.note??'REST',white),
      text(182,y,event.retained?'HOLD':chord.time===0?'ON':'MOVE',dim),
      rect(230,y+3,89,1,'#42546d'),
      rect(230+88*voice.phase,y,2,7,bindings[key]));
  }
  const step = Math.round(12*(bindings.steps+1.4)/1.95);
  output.push(text(859,73,'SCALE STEP '+String(step).padStart(2,'0'),cool),
    text(847,510,'PAIR ROUGHNESS',cool),rect(846,527,127,1,'#42546d'),...wheelLayer(frame));
  if (bindings.texture > 0) output.push(rect(846,526,127*bindings.texture,3,bindings.prism));
  output.push(pathLine([[42.5,568.5],[552.5,568.5]],'#40536b'),
    pathLine([[42.5,568.5],[t,568.5]],bindings.prism,1.3),rect(t-1,565,2,8,white));
  for (const row of program.events) {
    const x=42+510*row.time/end;
    output.push(pathLine([[x+.5,565.5],[x+.5,573.5]],'#9ca9c1'),text(Math.round(x),580,short[row.harmony],row.id===chord.id?white:dim));
  }
  for (let i=0;i<4;i++) output.push(rect(608+i*17,580,11,5,Math.floor(beat%4)===i?bindings.prism:'#344356'));
  output.push(text(842,580,'BAR '+String(frame.bar+1).padStart(2,'0')+'  /  phrase '+String(frame.phrase+1).padStart(2,'0'),cool));
  return output;
}

function paint(timeFrame) {
  const frame = program.frame(timeFrame);
  const luminance = draw([...geometry(frame),...captions(frame)]);
  return raster.stack({width:W,height:H,layers:[{source:backdrop},{source:staticFrame},{source:luminance}]}).value;
}
function write(file,image) {
  fs.writeFileSync(file,PNG.encode(image.width,image.height,image.data,4));
}
const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/after-the-fifth.cjs <out-dir> [--frames]');
fs.mkdirSync(output,{recursive:true});
const take=K.timeDomains.take({fps,sampleRate:48000});
for (const [name,at] of [['home',2.55],['shift',6.12],['tension',11.38]]) write(path.join(output,name+'.png'),paint(take.at(Math.round(at*fps))));
const audio = program.audio({sampleRate:48000});
fs.writeFileSync(path.join(output,'after-the-fifth.wav'),WAV.encode(audio.value,{encoding:'pcm24'}));
fs.writeFileSync(path.join(output,'score.json'),JSON.stringify(capture,null,2)+'\n');
fs.writeFileSync(path.join(output,'take.json'),JSON.stringify({fps,duration:end,frames:end*fps,
  request:cueRequest,events:program.events,audio:audio.report},null,2)+'\n');
if (process.argv.includes('--frames')) {
  const folder=path.join(output,'frames');
  fs.mkdirSync(folder,{recursive:true});
  for (let i=0;i<end*fps;i++) write(path.join(folder,String(i).padStart(4,'0')+'.png'),paint(take.at(i)));
}
