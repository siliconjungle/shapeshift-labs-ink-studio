'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'painting-flow-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const at = (...parts) => path.join(out, ...parts);
const put = (name,value) => files.json(at(name+'.json'),value);
const run = (...args) => {
  const result=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8',stdio:'pipe'}).trim();
  return result.startsWith('{') ? JSON.parse(result) : result;
};

const camera={target:[0,.01,.12],dist:4.6,yaw:-.075,pitch:.18,projection:'orthographic',sway:0,fov:.67};
const style={sun:[-.50,.48,.80],amb:.25,sky:.22,palette:[
  0x0e1929,0x14293c,0x254450,0x3d616c,0x60818a,0x98aeaa,
  0x834333,0xd58447,0xf6b46d,0xffdcad,
  0x235762,0x3b8c85,0x69c9b0,0xbfebca,
  0x6c3952,0xae5869,0xff8d90,0xffc4a9
],roles:{frame:[1,2,3,4,5],bed:[1,2,2,3],amber:[6,7,8,9],cyan:[10,11,12,13],rose:[14,15,16,17]}};
const box=(id,at,half,round,mat='frame')=>({id,kind:'box',at,half,round,mat,res:.037});
put('stage',{id:'tidal-thread',seed:51,camera,style,finish:{detail:17,dither:0},solids:[
  box('rim',[0,0,-.22],[1.66,1.01,.18],.16),box('face',[0,0,-.035],[1.53,.87,.22],.11,'bed'),
  box('shoal',[-.085,.255,.201],[.225,.175,.060],.043),
  ...[-1,1].flatMap(s=>[-1,1].map(t=>({id:'rivet-'+s+'-'+t,kind:'ball',at:[s*1.44,t*.77,.190],r:.041,mat:'amber',res:.036})))
]});
put('view',{w:336,h:220,camera,raw:true});
const attachment={kind:'surface',slot:'plate',snap:{mode:'surface',direction:[0,0,1],maxDistance:.24}};
const stroke=(id,mat,radius,xy)=>({id,mat,brush:{kind:'sphere',radius},step:.035,res:.036,
  poses:xy.map(([x,y],i)=>({point:[x,y,.33],pressure:i===0?.8:1})),attachment,relief:{mode:'flat'}});
const ink=[
  stroke('tide','amber',.059,[[.57,-.46],[.77,-.55],[.99,-.55],[1.17,-.49],[1.28,-.37]]),
  stroke('thread','cyan',.058,[[-1.13,.04],[-.91,.09],[-.68,.19],[-.45,.22]]),
  stroke('thread-dab','cyan',.045,[[-.53,.12]]),
  stroke('foam','rose',.052,[[.35,.56],[.47,.66],[.61,.64],[.73,.53]]),
  stroke('left-guide','cyan',.018,[[-1.38,-.64],[-1.38,.68]]),
  stroke('right-guide','cyan',.018,[[1.38,-.64],[1.38,.68]]),
  stroke('base-guide','cyan',.015,[[-1.37,-.68],[1.37,-.68]])
];
put('placement',{id:'marks',bindings:{plate:'face'},painting:{id:'tidal-ink',
  format:KIT.authoring.paintings3d.format,version:1,marks:ink}});
run('painting-3d','apply','stage.json','placement.json','--out','scene.json');
run('flow-map','new','--size','32,18','--bounds','-1.38,-0.73,1.38,0.73','--out','blank-field.json');
put('flow-brush',[
  {points:[[-1.45,0],[1.45,0]],radius:1.14,speed:.93,direction:[1,.27],hardness:.78},
  {points:[[.26,.61],[.87,.61]],radius:.26,speed:.87,direction:[.22,1],hardness:.62},
  {points:[[-.87,.12],[-.18,.33]],radius:.38,speed:.73,direction:[.85,.62],opacity:.84}
]);
run('flow-map','paint','blank-field.json','flow-brush.json','--out','tide-field.json');
put('flow-plan',{format:'ink-studio/painting-flow',version:1,painting:'marks',marks:['tide','thread','thread-dab','foam'],
  field:{file:'tide-field.json'},wrap:[true,false],seam:'split',edge:'lose',spacing:.072,
  obstructions:[{id:'shoal',rect:[-.31,.08,.14,.43],mode:'slide'}]});
const baked=run('painting-flow','bake','scene.json','flow-plan.json','--fps','8','--frames','8','--playback','loop','--out','flow-cels.json');
const selected=run('painting-flow','sample','scene.json','flow-plan.json','--at','.375','--out','editable-flow.json');
assert(selected.marks.find(row=>row.id==='tide').wraps>0);
assert(selected.marks.find(row=>row.id==='tide').fragments.length>1);
assert(baked.frames.some(frame=>frame.marks.find(row=>row.id==='thread').collisions>0));
assert(baked.frames.at(-1).marks.find(row=>row.id==='foam').lost>0);
const flip=run('painting-cels','export','scene.json','flow-cels.json','--view','view.json','--out','flipbook');

const tiles=[0,3,7].map(i=>PNG.raster(at('flipbook',flip.cels[i].image)));
const {w,h}=tiles[0],gap=14,W=3*w+gap*4,H=h+89;
const commands=[{type:'rect',rect:[0,0,W,H],fill:'#0e1825'}];
const text=(text,x,y,scale=1,color='#f3dfc6')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('TIDAL THREAD',gap,12,3);text('RETAINED PAINT ADVECTION',W-166,20,1,'#9ec9c2');
for(const [i,heading] of ['SOURCE','WRAP SEAM','SLIDE AND EDGE LOSS'].entries()) text(heading,gap+i*(w+gap),47,2);
text('AMBER  /  WRAPS IN U',gap,H-17,1,'#ffc58c');
text('CYAN  /  SLIDES ALONG THE SHOAL',gap+w+gap,H-17,1,'#8edec6');
text('ROSE  /  LEAVES THE V EDGE',gap+2*(w+gap),H-17,1,'#f49b9d');
const sheet=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for(const [i,image] of tiles.entries()) for(let y=0;y<h;y++)
  sheet.data.set(image.data.subarray(y*w*4,(y+1)*w*4),((y+65)*W+gap+i*(w+gap))*4);
files.write(at('tidal-thread.png'),PNG.encode(W,H,sheet.data,4));
put('flow-report',{...baked,selected});
console.log(at('tidal-thread.png'));
console.log(at('flipbook','painting.png'));
