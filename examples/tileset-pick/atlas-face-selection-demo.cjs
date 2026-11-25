'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');

const dir = path.resolve(process.argv[2] ?? 'atlas-face-selection-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eee7cf')=>({type:'text',text,at:[x,y],scale,color});
const mark = (points,color,closed=true,width=2)=>({type:'path',points,color,closed,width});
const atlas = art.render({width:24,height:16,edges:'hard',commands:[
  rect(0,0,24,16,'#263a47'),rect(1,1,22,14,'#3c6d6c'),rect(2,2,20,1,'#8cb199'),
  rect(4,3,16,10,'#2a454e'),rect(5,4,14,8,'#579183'),rect(5,4,14,1,'#a5c3a0'),
  rect(7,5,10,5,'#355f60'),rect(8,6,8,3,'#ae785f'),rect(10,6,4,1,'#d7a577'),
  rect(11,7,2,2,'#f0cc8e'),rect(1,5,2,5,'#a8bd91'),rect(21,5,2,5,'#a8bd91'),
  rect(3,13,4,1,'#6fa095'),rect(17,13,5,1,'#6fa095')
]});
const atlasBytes = PNG.encode(24,16,atlas.data,4);
write('Enamel-atlas.png',atlasBytes);
const scene = {id:'atlas-rectangle',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  camera:{target:[2.5,.45,0],dist:4.6,yaw:0,pitch:0,projection:'orthographic',sway:0},tilesets:{
    enamel:ink.readTilesetImage(atlasBytes),other:ink.createBlankTileset({width:24,height:16,background:'#51748a'})}};
const editor = ink.createSceneEditor(scene), object = 'wall';
const crop = {x:6,y:4,width:12,height:8};
for (const [index,id,sheet,bounds] of [
  [0,'exact','enamel',crop],[1,'inset','enamel',{x:9,y:6,width:6,height:4}],
  [2,'crossing','enamel',{x:2,y:7,width:20,height:2}],[4,'other-sheet','other',crop]
]) editor.placeTilesetFace({object,face:id,origin:[index+.07,0,0],worldSize:[.86,.86],
  ...(id==='exact' && {paint:{rotation:90,flipX:true}}),selection:ink.pickTilesetRectangle(scene,sheet,bounds)});
const nearMiss = [[16,15],[22,10],[22,15]];
const vertices = [[3.07,0,0],[3.93,0,0],[3.93,.86,0]].map((position,i)=>({id:'near-miss/v'+i,position}));
editor.editMeshTopology(object,{vertices,faces:[{id:'near-miss',material:'tileset/enamel',corners:vertices.map(({id:vertex},i)=>({
  id:'near-miss/c'+i,vertex,uv:[nearMiss[i][0]/23,nearMiss[i][1]/15]}))}]});
json('wall.json',editor.snapshot());
json('edges-query.json',{convert:'edges'});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
}
studio(['tileset','pick','--scene','wall.json','--id','enamel','--x','6','--y','4','--width','12','--height','8','--out','pick.json']);
const modes = [
  ['match',['exact'],'#8fe3bd'],['inside',['exact','inset'],'#f6cb8b'],['touch',['crossing','exact','inset'],'#f3977e']
];
for (const [mode,expected] of modes) {
  studio(['tileset','select-atlas','pick.json','--scene','wall.json','--object',object,'--mode',mode,
    '--out',mode+'-selection.json'],mode+'-report.json');
  assert.deepEqual(read(mode+'-report.json').ids,expected);
}
studio(['mesh-topology','select','wall.json','edges-query.json','--object',object,'--from','touch-selection.json','--out','edges.json']);
assert.equal(read('edges.json').ids.length,12);
const view = {w:150,h:58,px:1,ortho:true,yaw:0,pitch:0,target:[2.5,.45,0],zoom:1.45,raw:true,lockCamera:true};
studio(['render','wall.json','--w','150','--h','58','--px','1','--ortho','--yaw','0','--pitch','0',
  '--target','2.5,.45,0','--zoom','1.45','--raw','--out','Wall-1x.png']);
let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(capture,sample)=>{camera=capture;focal=sample.focal;})});
assert(camera.ortho);

const W=992,H=537, panels=[24,346,668], frame=PNG.raster(file('Wall-1x.png'));
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172933'),text('INK STUDIO / TILE MESHES',24,18,2,'#a4c8ab'),text('Select faces from the atlas',24,47,3),
  text('EXACT TEXEL PICK',24,98,2,'#a4c8ab'),text('UV FOOTPRINTS',346,98,2,'#a4c8ab'),
  rect(23,124,242,162,'#4d7169'),rect(345,124,242,162,'#4d7169'),
  text('PICK  X6 Y4  12 X 8 TEXELS',24,300,1),
  text('MATCH / ROTATED RECTANGLE',640,134,1,modes[0][2]),text('INSIDE / SMALLER CROP',640,159,1,modes[1][2]),
  text('TOUCH / CROSSING STRIP',640,184,1,modes[2][2]),text('MISS / DISJOINT TRIANGLE',640,209,1,'#bbc7cf'),
  text('SAME UVS ON THE OTHER SHEET STAY UNSELECTED',640,244,1,'#a4c8ab'),
  ...modes.flatMap(([mode,ids,color],i)=>[
    text(mode.toUpperCase(),panels[i],337,2,color),rect(panels[i]-1,367,302,118,'#4d7169'),
    text(ids.join(' / ').toUpperCase(),panels[i],499,1,color)
  ])
]});
function blit(data,w,h,dx,dy,scale) {
  for (let y=0;y<scale*h;y++) for (let x=0;x<scale*w;x++) {
    const at=(Math.floor(y/scale)*w+Math.floor(x/scale))*4;
    board.data.set(data.subarray(at,at+4),((dy+y)*W+dx+x)*4);
  }
}
for (const dx of [24,346]) blit(atlas.data,24,16,dx,125,10);
const marks = [mark([[6,4],[18,4],[18,12],[6,12]].map(([x,y])=>[24+10*x,125+10*y]),'#f2a2b8')];
const doc=editor.meshTopology(object).document, positions=new Map(doc.vertices.map(v=>[v.id,v.position]));
for (const [id,color] of [['exact',modes[0][2]],['inset',modes[1][2]],['crossing',modes[2][2]],['near-miss','#bbc7cf']]) {
  const face=doc.faces.find(face=>face.id===id);
  marks.push(mark(face.corners.map(({uv:[u,v]})=>[346+(u*23+.5)*10,125+(v*15+.5)*10]),color));
}
const {view:matrix}=camera;
for (const [i,[mode,,color]] of modes.entries()) {
  const dx=panels[i], dy=368;
  blit(frame.data,frame.w,frame.h,dx,dy,2);
  const {ids}=read(mode+'-report.json');
  for (const face of doc.faces.filter(face=>ids.includes(face.id))) marks.push(mark(face.corners.map(({vertex})=>{
    const [x,y,z]=positions.get(vertex);
    return [dx+frame.w+2*focal*(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12]),
      dy+frame.h-2*focal*(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])];
  }),color));
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let at=0;at<overlay.length;at+=4) if (overlay[at+3]) board.data.set(overlay.subarray(at,at+4),at);
write('Atlas-face-selection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Select faces from a tileset rectangle

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The three modes
select the rotated rectangle, then also the smaller crop, then also the
strip crossing the rectangle. The triangle's bounds overlap the pick,
but its footprint misses. A face on a different sheet uses identical UV
values. The last selection feeds the existing face-to-edge conversion.
`);
