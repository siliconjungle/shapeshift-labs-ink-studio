'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');
const {fixture} = require('./geometric-selection-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'geometric-selection-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#eee7d1')=>({type:'text',text,at:[x,y],scale,color});
const mark = (points,color,closed=false,width=2)=>({type:'path',points,color,closed,width});
const tiles = ['#4b7970','#587e6b','#6b815f','#8a785e','#805f64','#8e7154','#59818a'];
const atlas = art.render({width:56,height:8,edges:'hard',commands:tiles.flatMap((fill,i)=>{
  const x = i*8;
  return [rect(x,0,8,8,'#1c3238'),rect(x+1,1,6,6,fill),rect(x+1,1,6,1,'#a8b593'),rect(x+1,6,6,1,'#344f4e'),
    rect(x+2,3,4,2,'#304d4c'),rect(x+3,3,2,1,'#e7bc80'),rect(x+3,4,2,1,'#9c775f')];
})});
const png = PNG.encode(56,8,atlas.data,4);
write('Canopy-atlas.png',png);
const scene = fixture(ink.readTilesetImage(png)), editor = ink.createSceneEditor(scene);
json('canopy.json',scene);

const cases = [
  ['rim','CONNECTED OPEN EDGES','15 ONE-FACE EDGES / BRANCH INCLUDED','#f1bb77',
    {domain:'edges',query:{ids:['lead'],traverse:'open-edges'}},15],
  ['facing','CARDINAL +Z','4 FACES / 15-DEGREE CONE','#88dfc1',
    {domain:'tiles',query:{filter:{facing:{direction:'+z',tolerance:15}}}},['flat','rise-15','spare','tab']],
  ['patch','NORMAL PATCH','2 FACES / 20 DEGREES FROM THE SEED','#b5baf8',
    {domain:'tiles',query:{traverse:'normal-patch',normalAngle:20}},['flat','rise-15']]
];
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const stdout = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,stdout);
}
studio(['tileset','pick','--scene','canopy.json','--id','enamel','--x','0','--y','0','--width','8','--height','8','--out','atlas-pick.json']);
studio(['tileset','select-atlas','atlas-pick.json','--scene','canopy.json','--object','canopy','--out','seed.json'],'seed-report.json');
assert.deepEqual(read('seed-report.json').ids,['flat']);
for (const [id,,,,request,expected] of cases) {
  json(id+'-query.json',{object:'canopy',...request});
  studio(['tileset','select',id+'-query.json','--scene','canopy.json','--topology-out',id+'-selection.json',
    ...(id==='patch' ? ['--from','seed.json'] : [])],id+'-report.json');
  const {ids} = read(id+'-report.json');
  if (Array.isArray(expected)) assert.deepEqual(ids,expected);
  else assert.equal(ids.length,expected);
}

const view = {w:150,h:116,px:1,ortho:true,yaw:.42,pitch:.24,target:[1.25,.63,.94],zoom:1.18,raw:true,lockCamera:true};
studio(['render','canopy.json','--w','150','--h','116','--px','1','--ortho','--yaw','.42','--pitch','.24',
  '--target','1.25,.63,.94','--zoom','1.18','--raw','--out','Canopy-1x.png']);
let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(capture,sample)=>{camera=capture;focal=sample.focal;})});
assert(camera.ortho);

const W=990,H=452, panels=[24,346,668], frame=PNG.raster(file('Canopy-1x.png'));
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172933'),text('INK STUDIO / TILE MESHES',24,18,2,'#a2c9ab'),text('Select by geometric relationship',24,47,3),
  ...cases.flatMap(([,label,note,color],i)=>[
    text(label,panels[i],102,2,color),rect(panels[i]-1,127,302,234,'#4d7169'),text(note,panels[i],374,1,color)
  ]),
  text('STRIP NORMALS FROM +Z  /  0, 15, 30, 55, 90 DEGREES',24,410,1,'#a2c9ab'),
  text('NORMAL PATCH SEED  /  FLAT FACE PICKED FROM THE ATLAS',24,427,1)
]});
const {view:matrix}=camera, doc=ink.load().KIT.meshTopology.create(editor.meshTopology('canopy').document);
const positions=new Map(doc.vertices.map(v=>[v.id,v.position])), marks=[];
for (const [i,[id,,,color]] of cases.entries()) {
  const dx=panels[i],dy=128;
  for (let y=0;y<2*frame.h;y++) for (let x=0;x<2*frame.w;x++) {
    const at=(Math.floor(y/2)*frame.w+Math.floor(x/2))*4;
    board.data.set(frame.data.subarray(at,at+4),((dy+y)*W+dx+x)*4);
  }
  const to = vertex=>{
    const [x,y,z]=positions.get(vertex);
    return [dx+frame.w+2*focal*(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12]),
      dy+frame.h-2*focal*(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])];
  };
  const ids=new Set(read(id+'-report.json').ids);
  if (id==='rim') for (const edge of doc.edges.filter(edge=>ids.has(edge.id)))
    marks.push(mark(edge.vertices.map(to),color,false,edge.id==='lead' ? 4 : 2));
  else for (const face of doc.faces.filter(face=>ids.has(face.id)))
    marks.push(mark(face.corners.map(({vertex})=>to(vertex)),color,true,id==='patch' && face.id==='flat' ? 4 : 2));
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let at=0;at<overlay.length;at+=4) if (overlay[at+3]) board.data.set(overlay.subarray(at,at+4),at);
write('Geometric-selection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Select by geometric relationship

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The first query
follows the strip's open edges and reaches the little tab. The second
finds four faces near the +Z axis. The third starts from an atlas pick
and uses a 20-degree limit from the flat face. It includes the adjoining
15-degree face and stops before the 30-degree face. Each query saves a
native topology selection for further edits.
`);
