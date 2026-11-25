'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {atlas:gatehouseAtlas} = require('../gatehouse-revision/portal.cjs');

const dir = path.resolve(process.argv[2] ?? 'edge-plane-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const read = name=>fs.readFileSync(file(name));
const write = (name,data)=>fs.writeFileSync(file(name),data);
const commands = [];
function studio(args,receipt) {
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (receipt) write(receipt,output);
  return output;
}

const width=49,height=41,pixels=new Uint8Array(width*height*4);
const portal=gatehouseAtlas();
const paint=(x,y,color)=>pixels.set(color,(y*width+x)*4);
for (let y=0;y<20;y++) for (let x=0;x<48;x++) {
  const at=((24+y%8)*portal.width+24+x%16)*4;
  paint(x,y,portal.pixels.subarray(at,at+4));
}
for (let y=0;y<18;y++) for (let x=0;x<48;x++) {
  const seam=(x+(Math.floor(y/4)%2)*4)%8;
  const ink=y === 0 || y === 17 ? [56,91,88,255] : seam === 0 || y%4 === 3 ? [64,104,100,255] :
    y%4 === 0 || seam === 1 ? [149,192,162,255] : [100,154,138,255];
  paint(x,21+y,ink);
}
const image=ink.readTilesetImage(PNG.encode(width,height,pixels,4));
const source={id:'painted-eave',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},tilesets:{paint:image}};
const editor=ink.createSceneEditor(source);
editor.placeTilesetFace({object:'wall',face:'masonry',selection:ink.pickTilesetRectangle(source,'paint',
  {x:0,y:0,width:48,height:20})});
const draft=JSON.parse(JSON.stringify(editor.snapshot()));
const row=draft.topologyMeshes.wall;
row.document.edges.find(edge=>edge.vertices.includes('masonry/v3') && edge.vertices.includes('masonry/v2')).id='eave';
write('wall.json',JSON.stringify(draft,null,2)+'\n');

const hinge=['mesh-topology','plane','wall.json','--edge-object','wall','--edge','eave','--edge-from','masonry/v3',
  '--reference-up','0,0,-1','--grid','.25','--tilt','25'];
const early=JSON.parse(studio(hinge,'low-preview.json'));
assert.deepEqual(JSON.parse(studio([...hinge,'--out','low-guide.json'],'low-guide-receipt.json')),early);
const steep=JSON.parse(studio(['mesh-topology','plane','low-guide.json','--tilt','45',
  '--out','steep-guide.json'],'steep-guide-receipt.json'));
assert.deepEqual(steep.after.edgeAnchor,{...early.after.edgeAnchor,degrees:45});
studio(['mesh-topology','move','steep-guide.json','--object','wall','--vertex','masonry/v2','--by','0,.4,0',
  '--out','moved-guide.json'],'raised-eave.json');
const moved=JSON.parse(studio(['mesh-topology','plane','moved-guide.json'],'moved-guide-inspection.json'));
assert.deepEqual(moved.after.edgeAnchor,steep.after.edgeAnchor);
assert.notDeepEqual(moved.axes[0],steep.axes[0]);
const names=['low','steep','moved'];
const stamps=names.map(name=>JSON.parse(studio(['tileset','stamp','--scene',name+'-guide.json',
  '--object','roof','--face','panel','--id','paint','--x','0','--y','21','--width','48','--height','18',
  '--plane','0,0','--out',name+'.json'],name+'-stamp.json')));
assert.deepEqual(stamps.map(stamp=>stamp.constructionPlane.edgeAnchor.degrees),[25,45,45]);
const editedWall=JSON.parse(read('moved-guide.json')).topologyMeshes.wall.document.vertices;
const [left,right]=moved.after.edgeAnchor.vertices.map(id=>editedWall.find(v=>v.id === id).position);
const {V}=ink.load().KIT;
assert.deepEqual(stamps[2].vertices[0].position,left);
const stampEdge=V.sub(stamps[2].vertices[1].position,left);
assert(V.len(V.cross(stampEdge,V.sub(right,left)))<1e-10);
assert.notDeepEqual(stamps[2].vertices[1].position,stamps[1].vertices[1].position);
assert.deepEqual(stamps[0].corners,stamps[2].corners);

for (const name of names) studio(['render',name+'.json','--w','146','--h','101','--px','1','--ortho',
  '--yaw','.61','--pitch','.39','--target','1.45,1.15,-.4','--zoom','2.65','--raw','--out',name+'-1x.png']);
assert.notDeepEqual(read('low-1x.png'),read('steep-1x.png'));
assert.notDeepEqual(read('steep-1x.png'),read('moved-1x.png'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp low-preview.json low-guide-receipt.json\n');
write('README.md',`# A roof hinged on a mesh edge

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. It creates a
25-degree roof guide from the wall's eave and adjusts the tilt to 45
degrees using the saved reference. It then raises the right endpoint
of the same authored edge and uses the retained guide to place the
same painted roof crop. The reports show the directed edge and the
resolved frame for each stamp. All three renders use one camera.
`);

const W=960,H=390, panels=[23,334,645];
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const draw=ink.load().KIT.procedural.drawing2d;
const board=draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121c27'),
  text('INK STUDIO / EDGE-ANCHORED PLANE',23,20,2,'#a6e3cd'),
  text('One eave guides three roof placements',23,52,3),
  text('25 DEGREE PITCH',panels[0],111,2),
  text('45 DEGREE PITCH',panels[1],111,2,'#a6e3cd'),
  text('RAISED EAVE',panels[2],111,2,'#ffc789'),
  ...panels.map(x=>rect(x-1,139,294,204,'#506d75')),
  text('HINGE / EAVE EDGE',panels[0],359,1),
  text('SAME HINGE AND REFERENCE UP',panels[1],359,1,'#a6e3cd'),
  text('45 DEGREE TILT / RIGHT END +.4',panels[2],359,1,'#ffc789')
]});
for (const [index,name] of names.entries()) {
  const {w,h,data}=PNG.raster(file(name+'-1x.png'));
  let visible=0;
  for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) visible++;
  assert(visible>850);
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at=(Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((140+y)*W+panels[index]+x)*4);
  }
}
write('Edge-plane-roof.png',PNG.encode(W,H,board.data,4));
