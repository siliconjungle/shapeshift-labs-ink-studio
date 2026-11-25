'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');

const dir = path.resolve(process.argv[2] ?? 'through-selection-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const draw = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#ebead5')=>({type:'text',text,at:[x,y],scale,color});
const palette = [
  ['#283d46','#407a77','#80ae95','#bad9a2'],['#283b43','#3e605a','#799780','#d8be80'],
  ['#4b3b4d','#805969','#ba8176','#f2b184'],['#28293d','#544465','#8a6689','#c095a5']
];
const atlas = draw.render({width:64,height:16,edges:'hard',commands:palette.flatMap(([dark,base,bright,ink],i)=>{
  const x = i*16;
  return [rect(x,0,16,16,dark),rect(x+1,1,14,14,base),rect(x+1,1,14,1,bright),rect(x+2,3,12,10,dark),
    rect(x+3,4,10,8,base),rect(x+3,4,10,1,bright),rect(x+4,9,8,1,dark),rect(x+7,5,2,6,ink),
    rect(x+5,7,6,2,ink),rect(x+3,12,2,1,bright),rect(x+11,12,2,1,bright)];
})});
const png = PNG.encode(64,16,atlas.data,4);
write('Panels-atlas.png',png);
const scene = {id:'shutter-selection',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  camera:{target:[0,0,0],dist:4.2,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(png)}};
const editor = ink.createSceneEditor(scene);
for (const [index,[object,face,origin,right,worldSize]] of [
  ['panels','front',[-1.72,-.5,0]],['panels','covered',[-.5,-.5,0]],
  ['panels','backface',[1.72,-.5,0],[-1,0,0]],['shutter','latch',[-.58,-.58,.7],[1,0,0],[1.16,1.16]]
].entries()) editor.placeTilesetFace({object,face,origin,right,worldSize,selection:
  ink.pickTilesetRectangle(scene,'paint',{x:16*index,y:0,width:16,height:16})});
json('scene.json',editor.snapshot());

const view = {w:172,h:88,px:1,ortho:true,yaw:0,pitch:0,target:[0,0,0],zoom:1.42,raw:true,lockCamera:true};
json('view.json',view);
const {visibility} = ink.captureMeshTopologyVisibility(editor.build(),'panels',view,{participation:true});
json('view-capture.json',visibility);

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
}
const cases = [
  ['visible','include',['backface','front']],['through','include',['backface','covered','front']],
  ['visible','exclude',['front']],['through','exclude',['covered','front']]
];
for (const [mode,backfaces,ids] of cases) {
  const id = mode+'-'+backfaces;
  json(id+'-query.json',{domain:'tiles',object:'panels',query:{filter:{visibility:mode,backfaces}}});
  studio(['tileset','select',id+'-query.json','--scene','scene.json','--view','view.json'],id+'-report.json');
  assert.deepEqual(read(id+'-report.json').ids,ids);
}
studio(['tileset','select','through-exclude-query.json','--scene','scene.json','--visibility','view-capture.json',
  '--topology-out','through-selection.json'],'saved-view-report.json');
assert.deepEqual(read('saved-view-report.json'),read('through-exclude-report.json'));
studio(['render','scene.json','--w','172','--h','88','--px','1','--ortho','--yaw','0','--pitch','0',
  '--target','0,0,0','--zoom','1.42','--raw','--out','Panels-1x.png']);

let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(capture,sample)=>{camera=capture;focal=sample.focal;})});
assert(camera.ortho);
const {view:matrix} = camera, doc = editor.meshTopology('panels').document;
const positions = new Map(doc.vertices.map(vertex=>[vertex.id,vertex.position]));
const W = 760,H = 596, placements = [[24,132],[392,132],[24,376],[392,376]];
const board = draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172932'),text('INK STUDIO / TILE MESHES',24,18,2,'#a6cbb3'),text('Visible and through selection',24,48,3),
  ...cases.flatMap(([mode,backfaces,ids],index)=>{
    const [x,y] = placements[index];
    return [text(mode.toUpperCase(),x,y-42,2,'#a6cbb3'),text((backfaces+' backfaces').toUpperCase(),x,y-21,1),
      rect(x-1,y-1,346,178,'#50746c'),text(ids.join(' / ').toUpperCase(),x,y+188,1)];
  }),text('DASHED OUTLINE = COVERED TILE     ORANGE OUTLINE = BACKFACE',24,583,1,'#a6cbb3')
]});
const frame = PNG.raster(file('Panels-1x.png'));
const mark = (points,color,closed=false)=>({type:'path',points,color,closed,width:3});
const overlays = [];
for (const [index,[dx,dy]] of placements.entries()) {
  for (let y=0;y<2*frame.h;y++) for (let x=0;x<2*frame.w;x++) {
    const at = (Math.floor(y/2)*frame.w+Math.floor(x/2))*4;
    board.data.set(frame.data.subarray(at,at+4),((dy+y)*W+dx+x)*4);
  }
  const [visibilityMode,backfaces] = cases[index];
  const {ids} = read(visibilityMode+'-'+backfaces+'-report.json');
  for (const face of doc.faces.filter(face=>ids.includes(face.id))) {
    const ring = face.corners.map(({vertex})=>{
      const [x,y,z] = positions.get(vertex);
      return [dx+frame.w+2*focal*(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12]),
        dy+frame.h-2*focal*(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])];
    });
    const color = visibility.participation.throughFront.faces.includes(face.id) ? '#81e5cc' : '#f9a577';
    if (visibility.visible.faces.includes(face.id)) overlays.push(mark(ring,color,true));
    else for (const [i,a] of ring.entries()) {
      const b = ring[(i+1)%ring.length], at=t=>a.map((value,k)=>value+(b[k]-value)*t);
      for (let dash=0;dash<4;dash++) overlays.push(mark([at(dash/4),at((dash+.58)/4)],color));
    }
  }
}
const overlay = draw.render({width:W,height:H,edges:'hard',commands:overlays}).data;
for (let at=0;at<overlay.length;at+=4) if (overlay[at+3]) board.data.set(overlay.subarray(at,at+4),at);
write('Through-selection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp through-exclude-report.json saved-view-report.json\n');
write('README.md',`# Visible and through tile selection

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. All four queries
use one camera. The plum shutter covers the middle tile. A dashed outline
marks the covered tile in through mode. Orange marks the reversed tile.
The last query reuses the saved view capture and exports an ordinary
mesh selection with the front-facing through tiles.
`);
