'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'painting-wave-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const at = name => path.join(out,name);
const put = (name,value) => files.json(at(name+'.json'),value);
function run(...args) {
  const result=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8',stdio:'pipe'}).trim();
  return result.startsWith('{') ? JSON.parse(result) : result;
}

const camera={target:[0,.075,.08],dist:4.42,yaw:-.07,pitch:.11,projection:'orthographic',sway:0,fov:.68};
const style={sun:[-.47,.54,.70],amb:.38,sky:.25,palette:[
  0x101a25,0x192c3d,0x284353,0x3b6170,0x60919a,0x9dbcb9,
  0x67432e,0xb97040,0xf1a555,0xffdb96,
  0x2b5f58,0x428978,0x73c8a0,0xc5f3c2,
  0x603650,0xa55b6e,0xf2958b,0xffc7a6
],roles:{stone:[0,1,2,3,4],metal:[1,2,3,4,5],ember:[6,7,8,9],mint:[10,11,12,13],rose:[14,15,16,17]}};
const box=(id,at,half,round,mat='metal')=>({id,kind:'box',at,half,round,mat,res:.032});
const x=[-1.24,0,1.24];
put('stage',{id:'reed-signal',seed:17,camera,style,finish:{detail:15,dither:0},
  solids:[
    box('plinth',[0,-.91,0],[1.86,.14,.43],.09),
    ...x.flatMap((v,i)=>[
      box('collar-'+i,[v,-.753,.02],[.41,.106,.249],.075,'stone'),
      box('ring-'+i,[v,-.685,.088],[.34,.032,.22],.024,'metal')
    ]),
    box('pigment-board',[x[0],.12,0],[.42,.82,.117],.105,'stone'),
    box('relief-board',[x[1],.12,0],[.42,.82,.117],.105,'stone'),
    box('reed',[x[2],.12,.03],[.185,.82,.146],.119,'mint')
  ]});
function mark(id,slot,mat,radius,points,relief) {
  return {id,mat,brush:{kind:'sphere',radius},step:.035,res:.026,relief,
    poses:points.map(point=>({point,pressure:1})),
    attachment:{kind:'surface',slot,snap:{mode:'surface',direction:[0,0,1],maxDistance:.23}}
  };
}
const across=(v,z)=>[[v,-.61,z],[v,-.36,z],[v-.035,-.09,z],[v+.034,.26,z],[v+.026,.57,z],[v,.785,z]];
const paint=[
  mark('signal','flat','ember',.059,across(x[0],.25),{mode:'flat'}),
  mark('ridge','relief','rose',.066,across(x[1],.25),{mode:'volume',height:.11,castShadow:true}),
  mark('reed-vein','reed','ember',.044,across(x[2],.28),{mode:'flat'})
];
for(const [i,v] of x.entries()) {
  const slot=['flat','relief','reed'][i], z=i===2?.28:.25;
  for(let level=0;level<3;level++) {
    const h=-.55+level*.072;
    paint.push(mark('reference-'+i+'-'+level,slot,'metal',.016,[[v-.122,h,z],[v+.122,h,z]],{mode:'flat'}));
  }
}
put('placement',{id:'signal-lines',bindings:{flat:'pigment-board',relief:'relief-board',reed:'reed'},painting:{
  id:'reed-paint',format:KIT.authoring.paintings3d.format,version:1,marks:paint}});
run('painting-3d','apply','stage.json','placement.json','--out','straight.json');

const target=[
  {mode:'pigment',painting:'signal-lines',marks:['signal']},
  {mode:'raised',painting:'signal-lines',marks:['ridge']},
  {mode:'geometry',solid:'reed'}
];
let scene='straight.json';
for(const [i,selection] of target.entries()) {
  const id=selection.mode, direction=i===1?[-1,0,0]:[1,0,0];
  put(id+'-plan',{format:KIT.procedural.paintWave.format,version:1,id,target:selection,
    root:{at:[x[i],-.64,0],axis:[0,1,0],length:1.45,lock:.17},
    amplitude:i===2?.38:.26,frequency:1,base:{direction,phase:0,stiffness:.03},
    strokes:[
      {points:[.69,.93],radius:.41,feather:.92,phase:i===1?-31:39,opacity:.8},
      {points:[.69],radius:.35,feather:1,stiffness:.34},
      {points:[1.25,1.45],radius:.37,feather:1,direction:[direction[0],0,i===1?.17:-.15],opacity:.75}
    ]});
  const next=i===2?'scene-ready.json':id+'-scene.json';
  run('painting-wave','apply',scene,id+'-plan.json','--out',next);
  scene=next;
}
const selected=run('painting-wave','inspect',scene,'--at','.25');
assert.deepEqual(selected.waves.map(row=>row.target.mode),['pigment','raised','geometry']);
assert(selected.waves.every(row=>row.samples[1].offset.every(axis=>axis===0) &&
  Math.abs(row.samples.at(-1).offset[0])>.21));
put('wave-report',selected);
run('painting-wave','sample',scene,'--at','.25','--out','editable-peak.json');

const w=380,h=230,fps=8,flags=['--w',String(w),'--h',String(h),'--px','1','--ortho','--raw'];
const columns=[
  ['STRAIGHT SOURCE','straight.json',0],
  ['QUARTER CYCLE','editable-peak.json',.25],
  ['THREE-QUARTER CYCLE',scene,.75]
];
const tiles=columns.map(([,file,time],i)=>{
  const png='still-'+i+'.png';
  run('render',file,'--t',String(time),...flags,'--out',png);
  return PNG.raster(at(png));
});
run('clip',scene,'--from','0','--to','1','--fps',String(fps),...flags,'--out','reed-signal-loop.png');

const gap=12,W=3*w+4*gap,H=h+103;
const commands=[{type:'rect',rect:[0,0,W,H],fill:'#101a25'}];
const text=(text,x,y,scale=1,color='#f4e4c9')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('REED SIGNAL',gap,13,3);
text('ROOTED WAVE',W-87,23,1,'#99c4bb');
const labels=[['PIGMENT','#ffc783'],['RAISED','#f5a6a1'],['GEOMETRY','#a4dfbc']];
for(const [i,[heading]] of columns.entries()) {
  const left=gap+i*(w+gap);
  text(heading,left,48,2);
  for(const [j,[label,color]] of labels.entries()) text(label,left+100+j*91-label.length*3,70+h,1,color);
}
text('THE ANCHOR BANDS HOLD THROUGH THE SWAY',gap,H-13,1,'#9dbcb9');
const sheet=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for(const [i,image] of tiles.entries()) for(let y=0;y<h;y++)
  sheet.data.set(image.data.subarray(y*w*4,(y+1)*w*4),((y+64)*W+gap+i*(w+gap))*4);
files.write(at('reed-signal.png'),PNG.encode(W,H,sheet.data,4));
console.log(at('reed-signal.png'));
console.log(at('reed-signal-loop.png'));
