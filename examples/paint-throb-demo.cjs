'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const {KIT}=require('..').load();
const PNG=require('../cli/png.js');
const WAV=require('../cli/wav.js');
const files=require('../cli/asset-files.js');

const out=path.resolve(process.argv[2]??'paint-throb-demo');
const at=name=>path.join(out,name);
const put=(name,value)=>files.json(at(name+'.json'),value);
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
function run(...args) {
  const result=execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:'pipe',encoding:'utf8'}).trim();
  return result.startsWith('{')?JSON.parse(result):result;
}

const style={sun:[-.45,.61,.65],amb:.39,sky:.23,palette:[
  0x101a24,0x1a2a38,0x2c4759,0x416677,0x68919a,0xa4c2be,
  0x6c3a41,0xb75853,0xf09970,0xffc29b,
  0x644d2a,0xb18137,0xeac15b,0xffe29a,
  0x21625f,0x359182,0x67d8b4,0xc3f3c9
],roles:{base:[1,2,3,4,5],panel:[0,1,2,3],coral:[6,7,8,9],gold:[10,11,12,13],mint:[14,15,16,17]}};
const camera={target:[0,.02,.12],dist:4.85,yaw:-.27,pitch:.16,projection:'orthographic',sway:0,fov:.67};
const box=(id,at,half,round,mat='base')=>({id,kind:'box',at,half,round,mat,res:.037});
const centers=[-1.16,-.38,.39,1.15];
put('stage',{id:'beat-relay',seed:53,camera,style,finish:{detail:15,dither:0},timeline:{duration:1,markers:[
  {id:'press',time:.25},{id:'release',time:.5}
]},solids:[
  box('base',[0,-.64,-.09],[1.82,.105,.32],.073),
  box('frame',[0,.02,-.09],[1.75,.66,.19],.11),
  ...centers.map((x,i)=>box('meter-'+i,[x,.05,.023],[.318,.508,.135],.072,'panel'))
]});

const stamp=(id,index,mat,radius,points,extra)=>({id,mat,brush:{kind:'sphere',radius},step:.024,res:.028,
  poses:points.map(([x,y])=>({point:[centers[index]+x,y,.26]})),
  attachment:{kind:'surface',slot:'m'+index,snap:{mode:'surface',direction:[0,0,1],maxDistance:.24}},...extra});
const pathLine=[[0,-.27],[-.04,-.13],[.04,.02],[-.04,.15],[0,.31]];
const marks=[
  stamp('width',0,'mint',.082,pathLine,{relief:{mode:'flat'}}),
  stamp('height',1,'coral',.112,[[-.08,-.24],[.11,-.10],[-.10,.07],[.09,.24]],{relief:{mode:'volume',height:.13,castShadow:true}}),
  stamp('coverage',2,'gold',.077,[[-.08,-.22],[.10,-.03],[-.10,.12],[.1,.26]],{relief:{mode:'flat'}}),
  stamp('emission',3,'mint',.119,[[0,-.22],[0,.26]],{finish:{tint:{color:'#80c3bc'},emission:{color:'#29b5ab',strength:1.3}}})
];
put('placement',{id:'meters',bindings:Object.fromEntries(centers.map((_,i)=>['m'+i,'meter-'+i])),
  painting:{format:KIT.authoring.paintings3d.format,version:1,id:'bars',marks}});
run('painting-3d','apply','stage.json','placement.json','--out','dry.json');

const sampleRate=16000,duration=1;
const notes=[[.335,.441,377],[.71,.97,510]];
const samples=Float64Array.from({length:sampleRate*duration},(_,i)=>{
  const time=i/sampleRate;
  return notes.reduce((signal,[from,to,hz])=>{
    if (time<from || time>=to) return signal;
    const age=time-from, envelope=Math.min(1,age/.017)*Math.exp(-age*6)*Math.min(1,(to-time)/.04);
    return signal+.92*envelope*Math.sin(age*2*Math.PI*hz);
  },0);
});
files.write(at('relay.wav'),WAV.encode({sampleRate,channels:1,samples}));
const manifest=KIT.procedural.paintThrob.format;
const drivers=[
  {type:'oscillator',frequency:1},
  {type:'cue',timeline:true,keys:[{at:0,value:0},{cue:'press',value:1},{cue:'release',value:0},{at:1,value:0}]},
  {type:'oscillator',frequency:1,phase:.75,shape:'triangle'},
  {type:'audio',file:'relay.wav',measure:'rms',rate:48,gain:3}
];
const channels=[['width',[.68,1.85]],['height',[.28,2.9]],['coverage',[0,1]],['emission',[0,1.8]]];
let scene='dry.json';
for(const [i,[channel,range]] of channels.entries()) {
  put(channel+'-plan',{format:manifest,version:1,id:channel,painting:'meters',marks:[channel],
    drivers:{signal:drivers[i]},channels:{[channel]:{driver:'signal',range}}});
  const output=i===3?'pulsing.json':channel+'-scene.json';
  run('paint-throb','apply',scene,channel+'-plan.json','--out',output);
  scene=output;
}

const w=300,h=205,fps=8,view=['--w',String(w),'--h',String(h),'--px','1','--ortho','--raw'];
const poses=[['START',0],['CUE PEAK',.25],['WIDTH PEAK',.5],['AUDIO PEAK',.75]];
const reports=poses.map(([,time])=>run('paint-throb','inspect',scene,'--at',String(time)));
assert(reports[1].pulses.find(row=>row.id==='height').channels.height>2.8);
assert.equal(reports[1].pulses.find(row=>row.id==='coverage').channels.coverage,0);
assert(reports[3].pulses.find(row=>row.id==='emission').channels.emission>1.5);
put('pulse-report',reports);
const stills=poses.map(([,time],i)=>{
  const image='pose-'+i+'.png';
  run('render',scene,'--t',String(time),...view,'--out',image);
  return PNG.raster(at(image));
});
run('clip',scene,'--from','0','--to','1','--fps',String(fps),...view,'--out','beat-relay-loop.png');

const gap=12,width=w*4+gap*5,height=h+101;
const commands=[{type:'rect',rect:[0,0,width,height],fill:'#101a24'}];
const text=(text,x,y,scale=1,color='#e8e9d7')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('BEAT RELAY',gap,13,3);
const labels=[['WIDTH','#9ee4bd'],['HEIGHT','#ffb894'],['COVERAGE','#ffe1a0'],['GLOW','#81eae3']];
for(const [i,[label]] of poses.entries()) {
  const left=gap+i*(w+gap);
  text(label,left,48,2);
  for(const [j,[label,color]] of labels.entries()) text(label,left+76+j*49-label.length*3,69+h,1,color);
}
const sheet=KIT.procedural.drawing2d.render({width,height,edges:'hard',commands});
for(const [i,still] of stills.entries()) for(let y=0;y<h;y++)
  sheet.data.set(still.data.subarray(y*w*4,(y+1)*w*4),((y+62)*width+gap+i*(w+gap))*4);
files.write(at('beat-relay.png'),PNG.encode(width,height,sheet.data,4));
console.log(at('beat-relay.png'));
console.log(at('beat-relay-loop.png'));
