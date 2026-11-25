'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');

const dir = path.resolve(process.argv[2] ?? 'region-selection-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const draw = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eee6cc')=>({type:'text',text,at:[x,y],scale,color});
const palettes = [['#233c45','#407571','#80ad96','#c5d1a3'],['#353948','#6b6872','#aa9191','#f1b484'],
  ['#263b41','#537768','#9bb18a','#dae0a4'],['#3c3548','#775e7d','#a98b9d','#e0bd96']];
const atlas = draw.render({width:64,height:16,edges:'hard',commands:palettes.flatMap(([dark,base,light,accent],i)=>{
  const x = i*16;
  return [rect(x,0,16,16,dark),rect(x+1,1,14,14,base),rect(x+1,1,14,1,light),rect(x+2,4,12,8,dark),
    rect(x+3,5,10,6,base),rect(x+3,5,10,1,light),rect(x+6,6,4,4,dark),rect(x+7,7,2,2,accent),
    rect(x+3,13,2,1,light),rect(x+11,13,2,1,light)];
})});
const png = PNG.encode(64,16,atlas.data,4);
write('Panel-atlas.png',png);
const draft = {id:'selection-panel',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  camera:{target:[1.5,1,0],dist:4.4,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(png)}};
const editor = ink.createSceneEditor(draft);
const pick = index=>ink.pickTilesetRectangle(draft,'paint',{x:index*16,y:0,width:16,height:16});
for (let y=0;y<2;y++) for (let x=0;x<3;x++) editor.placeTilesetFace({object:'panel',face:`tile-${x}-${y}`,
  origin:[x,y,0],selection:pick((x+y)%3)});
editor.placeTilesetFace({object:'cover',face:'shutter',origin:[.99,-.01,.62],worldSize:[1.02,1.02],selection:pick(3)});
json('scene.json',editor.snapshot());

const view = {w:150,h:88,px:1,ortho:true,yaw:0,pitch:0,target:[1.5,1,0],zoom:1.25,raw:true,lockCamera:true};
json('view.json',view);
let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(capture,sample)=>{camera=capture;focal=sample.focal;})});
assert(camera.ortho);
const {view:matrix} = camera;
const project = ([x,y,z=0])=>[
  view.w/2+focal*(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12]),
  view.h/2-focal*(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])
];
const [left,top] = project([.12,.84]).map(Math.floor), [right,bottom] = project([1.89,.16]).map(Math.ceil);
const marquee = {type:'marquee',rect:[left,top,right-left,bottom-top]};
const sweep = {type:'brush',points:[[.42,1.52],[.9,1.63],[1.55,1.48]].map(project),radius:3};
const dab = {type:'brush',points:[project([.5,.5])],radius:6};
const panels = [
  ['marquee','MARQUEE',{region:marquee,filter:{visibility:'through'}},null,['tile-0-0','tile-1-0']],
  ['add','ADD WITH BRUSH',{region:sweep,operation:'add'},'marquee',['tile-0-0','tile-0-1','tile-1-0','tile-1-1']],
  ['subtract','SUBTRACT WITH BRUSH',{region:dab,operation:'subtract'},'add',['tile-0-1','tile-1-0','tile-1-1']],
  ['invert','INVERT',{operation:'invert'},'subtract',['tile-0-0','tile-2-0','tile-2-1']],
  ['edges','FACE TO EDGE',{convert:'edges'},'invert',12],
  ['vertices','FACE TO VERTEX',{convert:'vertices'},'invert',12]
];
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
}
for (const [id,,query,prior,expected] of panels) {
  json(id+'-query.json',{object:'panel',domain:'tiles',query});
  studio(['tileset','select',id+'-query.json','--scene','scene.json',...(query.region ? ['--view','view.json'] : []),
    ...(prior ? ['--from',prior+'-selection.json'] : []),'--topology-out',id+'-selection.json'],id+'-report.json');
  const {ids} = read(id+'-report.json');
  if (Array.isArray(expected)) assert.deepEqual(ids,expected);
  else assert.equal(ids.length,expected);
}
studio(['render','scene.json','--w','150','--h','88','--px','1','--ortho','--yaw','0','--pitch','0',
  '--target','1.5,1,0','--zoom','1.25','--raw','--out','Panel-1x.png']);

const frame = PNG.raster(file('Panel-1x.png')), W = 990,H = 584;
const locations = panels.map((_,i)=>[24+(i%3)*322,118+Math.floor(i/3)*234]);
const board = draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172933'),text('INK STUDIO / TILE MESHES',24,18,2,'#a4c8ab'),text('Marquee and brush selection',24,47,3),
  ...panels.flatMap(([id,label,query,prior],i)=>{
    const [x,y] = locations[i], {ids,domain} = read(id+'-report.json');
    const note = query.region ? (id==='marquee' ? 'THROUGH / ' : 'VISIBLE / ') : '';
    return [text(label,x,y-29,2,'#a4c8ab'),rect(x-1,y-1,302,178,'#51716c'),
      text(`${note}${ids.length} ${domain.toUpperCase()} SELECTED${prior ? ' / FROM '+prior.toUpperCase() : ''}`,x,y+187,1)];
  }),text('MESH PICKS IN MINT AND AMBER     MARQUEE AND BRUSH IN ROSE',24,562,1,'#a4c8ab')
]});
const doc = editor.meshTopology('panel').document, positions = new Map(doc.vertices.map(v=>[v.id,v.position]));
const mark = (points,color,closed=false,width=2)=>({type:'path',points,color,closed,width});
const marks = [];
for (const [i,[dx,dy]] of locations.entries()) {
  for (let y=0;y<2*frame.h;y++) for (let x=0;x<2*frame.w;x++) {
    const at = (Math.floor(y/2)*frame.w+Math.floor(x/2))*4;
    board.data.set(frame.data.subarray(at,at+4),((dy+y)*W+dx+x)*4);
  }
  const screen = ([x,y])=>[dx+2*x,dy+2*y];
  const [id,,{region}] = panels[i], {ids,domain} = read(id+'-report.json'), selected = new Set(ids);
  const to = id=>screen(project(positions.get(id)));
  if (domain==='tiles') for (const face of doc.faces.filter(face=>selected.has(face.id)))
    marks.push(mark(face.corners.map(({vertex})=>to(vertex)),'#83e3cc',true));
  if (domain==='edges') for (const edge of doc.edges.filter(edge=>selected.has(edge.id)))
    marks.push(mark(edge.vertices.map(to),'#f1bf77',false,3));
  if (domain==='vertices') for (const vertex of ids) {
    const [x,y] = to(vertex);
    marks.push(rect(Math.round(x)-2,Math.round(y)-2,5,5,'#f1bf77'));
  }
  if (region?.type==='marquee') {
    const [x,y,w,h] = region.rect;
    marks.push(mark([[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(screen),'#ec89a8',true));
  } else if (region?.type==='brush') {
    const ring = (point,radius)=>Array.from({length:24},(_,n)=>{
      const angle = n*Math.PI/12;
      return screen([point[0]+Math.cos(angle)*radius,point[1]+Math.sin(angle)*radius]);
    });
    if (region.points.length>1) marks.push(mark(region.points.map(screen),'#ec89a8'));
    for (const point of region.points) marks.push(mark(ring(point,region.radius),'#ec89a8',true));
  }
}
const overlay = draw.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let at=0;at<overlay.length;at+=4) if (overlay[at+3]) board.data.set(overlay.subarray(at,at+4),at);
write('Geometry-selection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Marquee and brush selection for geometry

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. A through marquee
selects two lower faces, including the one behind the purple shutter.
A visible brush adds the two upper faces. A brush dab subtracts the
left lower face. Invert selects the remaining three. The final commands
export their incident edges and vertices for the existing topology tools.
`);
