'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load();
const files=require('../cli/asset-files.js');
const PNG=require('../cli/png.js');

const out=path.resolve(process.argv[2]??'paint-evaporation-demo');
const at=name=>path.join(out,name);
const put=(name,value)=>files.json(at(name+'.json'),value);
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
function run(...args) {
  const result=execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:'pipe',encoding:'utf8'}).trim();
  return result.startsWith('{')?JSON.parse(result):result;
}

const style={sun:[-.44,.57,.73],amb:.35,sky:.3,palette:[
  0x111a26,0x1b2b3c,0x304859,0x517183,0x6d8c94,0xa1c0b6,
  0x693f31,0xbd673d,0xf5a657,0xffd589,
  0x412e46,0x824661,0xcf7383,0xffa79b,
  0x176d7e,0x47a8b2,0x93dbca,0xc6f6da
],roles:{dark:[0,1,2,3],stone:[1,2,3,4,5],ember:[6,7,8,9],rose:[10,11,12,13],mint:[14,15,16,17]}};
const camera={target:[.045,.40,.15],dist:4.8,yaw:-.08,pitch:.12,projection:'orthographic',sway:0,fov:.65};
const box=(id,at,half,round,mat,res=.041)=>({id,kind:'box',at,half,round,mat,res});
put('stage',{id:'signal-kiln',seed:31,camera,style,finish:{detail:14,dither:0},solids:[
  box('plinth',[0,-.79,-.11],[1.32,.12,.41],.07,'stone'),
  box('body',[0,-.005,-.10],[1.17,.716,.19],.12,'stone'),
  box('panel',[0,.013,.015],[1.047,.60,.144],.09,'dark'),
  ...[-1,1].flatMap(side=>[-.405,.395].map((y,i)=>({
    id:'rivet-'+side+'-'+i,kind:'ball',at:[side*.925,y,.168],r:.037,mat:'stone',res:.037
  })))
]});
const attachment={kind:'surface',slot:'panel',snap:{mode:'surface',direction:[0,0,1],maxDistance:.25}};
const stroke=(id,mat,radius,xy,extra={})=>({id,mat,brush:{kind:'sphere',radius},step:.033,res:.033,attachment,
  poses:xy.map(([x,y])=>({point:[x,y,.27],pressure:1})),...extra});
const bars=[
  stroke('amber','ember',.065,[[-.70,-.44],[-.54,-.27],[-.73,-.08],[-.61,.11],[-.43,.28],[-.54,.45]],{relief:{mode:'flat'}}),
  stroke('beacon','mint',.075,[[-.18,-.44],[-.02,-.25],[.08,-.09],[-.10,.10],[.06,.28],[.19,.45]],
    {finish:{tint:{color:'#6adddb'},emission:{color:'#19887f',strength:1.8}}}),
  stroke('copper','rose',.058,[[.43,-.44],[.57,-.25],[.43,-.08],[.58,.09],[.73,.28],[.62,.45]],
    {relief:{mode:'volume',height:.099,castShadow:true}})
];
put('placement',{id:'signal',bindings:{panel:'panel'},painting:{
  format:KIT.authoring.paintings3d.format,version:1,id:'kiln-lines',marks:bars}});
run('painting-3d','apply','stage.json','placement.json','--out','source.json');
put('release-plan',{format:KIT.procedural.paintEvaporation.format,version:1,id:'kiln-draft',painting:'signal',
  marks:['amber','beacon','copper'],region:{points:[[-.73,.27,.17],[.76,.27,.17]],radius:.30,direction:[1,0,0]},
  start:.15,end:.82,life:.87,spacing:.045,size:.020,velocity:[.24,1.25,.24],spread:.52,fade:.45,seed:22});
const report=run('paint-evaporation','apply','source.json','release-plan.json','--out','released.json');
assert(report.particles>90 && report.sources.length===3);
const moment=run('paint-evaporation','inspect','released.json','--at','.75','--layer','kiln-draft');
assert(moment.layers[0].particles.some(row=>row.status==='airborne' && row.emission.some(Boolean)));
put('particle-report',moment);

const w=290,h=209,fps=8,view=['--w',String(w),'--h',String(h),'--px','1','--ortho','--raw'];
const panels=[['PAINTED',0],['LIFTING',.5],['AIRBORNE',.875],['CLEARED',1.75]];
const stills=panels.map(([,time],i)=>{
  const image='pose-'+i+'.png';
  run('render','released.json','--t',String(time),...view,'--out',image);
  return PNG.raster(at(image));
});
run('clip','released.json','--from','0','--to','2','--fps',String(fps),...view,'--out','signal-kiln-loop.png');

const gap=12,width=w*4+gap*5,height=h+93;
const commands=[{type:'rect',rect:[0,0,width,height],fill:'#111a26'}];
const text=(text,x,y,scale=1,color='#eedec1')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('SIGNAL KILN',gap,13,3);
for(const [i,[label]] of panels.entries()) text(label,gap+i*(w+gap),48,2);
text('AMBER PIGMENT  /  TEAL EMISSION  /  RAISED COPPER',gap,height-13,1,'#a3c8bd');
const sheet=KIT.procedural.drawing2d.render({width,height,edges:'hard',commands});
for(const [i,still] of stills.entries()) for(let y=0;y<h;y++)
  sheet.data.set(still.data.subarray(y*w*4,(y+1)*w*4),((y+63)*width+gap+i*(w+gap))*4);
files.write(at('signal-kiln.png'),PNG.encode(width,height,sheet.data,4));
console.log(at('signal-kiln.png'));
console.log(at('signal-kiln-loop.png'));
