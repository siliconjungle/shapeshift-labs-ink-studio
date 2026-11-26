'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inflateSync}=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load();
const PNG=require('../cli/png.js');
const files=require('../cli/asset-files.js');

const out=path.resolve(process.argv[2]??'scene-poses-demo'), at=name=>path.join(out,name);
const put=(name,value)=>files.json(at(name+'.json'),value);
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
function run(...args) {
  const result=execFileSync(process.execPath,[cli,...args],{encoding:'utf8',stdio:'pipe',cwd:out}).trim();
  return result.startsWith('{')?JSON.parse(result):result;
}

const style={sun:[-.45,.65,.58],amb:.25,sky:.17,palette:[
  0x101923,0x1c2d41,0x314959,0x506d79,0x78949a,0xb5c5b9,
  0x714433,0xb5794f,0xf2aa62,0xffd39a,
  0x22545b,0x3d9691,0x77d2b4,0xc2f3ca,
  0x5b3b55,0x995878,0xe48696,0xffb9a4
],roles:{stone:[0,1,2,3,4],metal:[1,2,3,4,5],amber:[6,7,8,9],mint:[10,11,12,13],rose:[14,15,16,17]}};
const box=(id,at,half,round,mat='metal',part)=>({id,kind:'box',at,half,round,mat,res:.036,...(part&&{part})});
const move='/poses/shutter/translation', tilt='/poses/shutter/rotation', light='/effects/0/strength', yaw='/camera/yaw';
const stage={
  id:'relay-shutter',seed:41,style,finish:{detail:15,dither:0},
  parts:{shutter:{joint:[0,.29,.16]}},
  camera:{target:[0,.29,.11],dist:4.45,yaw:-.18,pitch:.16,projection:'orthographic',fov:.62,sway:0},
  effects:[{do:'lamp',at:[.35,.91,1.16],r:2.1,strength:.7}],
  timeline:{duration:2,markers:[{id:'unkeyed',time:.9375},{id:'return',time:1.3125}],
    tracks:[{target:light,keys:[{time:0,value:.32},{time:.9375,value:2.1},
      {time:1.125,value:2.8},{time:1.375,value:.7},{time:2,value:.35}]}]},
  solids:[
    box('base',[0,-.36,-.07],[1.64,.128,.53],.064),
    box('back',[0,.26,-.24],[1.55,.53,.19],.12,'stone'),
    box('rail',[0,.265,.008],[1.39,.066,.087],.040,'amber'),
    box('slot',[0,.275,.083],[1.29,.025,.035],.023,'stone'),
    ...[-1,1].flatMap(side=>[
      box('post-'+side,[side*1.37,.22,.05],[.063,.37,.08],.042,'metal'),
      box('knob-'+side,[side*1.37,.48,.15],[.083,.068,.046],.034,'rose'),
      box('foot-'+side,[side*1.31,-.19,.10],[.158,.064,.27],.043,'mint')
    ]),
    box('pivot',[0,.277,.144],[.13,.15,.072],.056,'rose','shutter'),
    box('vane',[0,.28,.193],[.38,.196,.087],.072,'mint','shutter'),
    box('rib-left',[-.25,.28,.276],[.032,.14,.030],.021,'metal','shutter'),
    box('rib-right',[.25,.28,.276],[.032,.14,.030],.021,'metal','shutter'),
    box('flag',[0,.28,.284],[.111,.065,.020],.023,'amber','shutter')
  ]
};
put('stage',stage);
const edits=(...pairs)=>({changes:pairs.map(([target,value])=>({target,value}))});
const pose=(x,z,...extra)=>edits([move,[x,0,0]],[tilt,[0,0,z]],...extra);
put('left-edit',pose(-.64,-.45,[yaw,-.18],[light,1.05]));
put('right-edit',pose(.56,.30));
put('far-edit',pose(.70,-.26));
put('finish-edit',pose(-.43,.43));
let sequence;
const steps=[
  ['left-edit.json','.125','--hold','.25','--blend','smooth'],
  ['right-edit.json','.75'],
  ['stage.json','.9375'],
  ['far-edit.json','1.3125','--blend','step'],
  ['finish-edit.json','1.625']
];
for (const [i,[file,time,...flags]] of steps.entries()) {
  const made='sequence-'+i+'.json';
  const report=run('scene-pose','capture','stage.json',file,'--at',time,...flags,
    ...(sequence?['--sequence',sequence]:['--id','shutter-pass','--duration','2']),'--out',made);
  if (i===0) assert.deepEqual(report.changes.map(row=>'/'+row.target.join('/')),[move,tilt,light]);
  if (i===2) assert.deepEqual(report.changes,[]);
  sequence=made;
}
const document=JSON.parse(fs.readFileSync(at(sequence),'utf8'));
put('poses',document);
const receipt=run('scene-pose','apply','stage.json','poses.json','--out','posed.json');
assert.equal(receipt.ranges[2].targets.length,0);

const w=302,h=179,fps=8,opts=['--w',String(w),'--h',String(h),'--px','1','--raw','--ortho'];
const shots=[
  ['HOLD',.25],['BLEND',.5],['LANDED',.875],
  ['EMPTY RANGE',1.125],['STEP HOLD',1.5],['NEXT KEY',1.875]
];
const frames=shots.map(([,time],i)=>{
  const file='pose-'+i+'.png';
  run('render','posed.json','--t',String(time),...opts,'--out',file);
  return PNG.raster(at(file));
});
run('render','stage.json','--t','1.125',...opts,'--out','base-gap.png');
assert.deepEqual(frames[3].data,PNG.raster(at('base-gap.png')).data);
run('clip','posed.json','--from','0','--to','2','--fps',String(fps),...opts,'--out','relay-shutter-loop.png');
const loop=PNG.readFullFrameAnimation(at('relay-shutter-loop.png'),{w,h,count:16,fps});
for (const [i,[,time]] of shots.entries()) {
  const rgb=Buffer.alloc(w*h*3), {data}=frames[i];
  for (let j=0;j<w*h;j++) for (let c=0;c<3;c++) rgb[j*3+c]=data[j*4+c];
  assert.deepEqual(inflateSync(loop[time*fps].compressed),inflateSync(PNG.packFrame({w,h,rgb}).compressed));
}

const gap=12, W=3*w+4*gap,H=2*h+126;
const commands=[{type:'rect',rect:[0,0,W,H],fill:'#101923'}];
const text=(text,x,y,scale=1,color='#f4e3ce')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('RELAY SHUTTER',gap,14,3);
text('SPARSE POSE PLAYBACK',W-126,22,1,'#9accc0');
for (const [i,[label,time]] of shots.entries()) {
  const x=gap+i%3*(w+gap), y=54+Math.floor(i/3)*(h+34);
  text(label,x,y,2,i===3?'#fcd095':'#f4e3ce');
  text(time.toFixed(3)+' S',x+w-48,y+3,1,'#9accc0');
}
const sheet=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for (const [i,{data}] of frames.entries()) for (let y=0;y<h;y++)
  sheet.data.set(data.subarray(y*w*4,(y+1)*w*4),((y+72+Math.floor(i/3)*(h+34))*W+gap+i%3*(w+gap))*4);
files.write(at('relay-shutter.png'),PNG.encode(W,H,sheet.data,4));
console.log(at('relay-shutter.png'));
console.log(at('relay-shutter-loop.png'));
