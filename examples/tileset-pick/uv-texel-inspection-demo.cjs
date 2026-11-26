'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-texel-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f0e1c8')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color)=>({type:'path',points,color,width:1});
function sheet(name,width,height,commands) {
  const {data} = art.render({width,height,edges:'hard',commands});
  const png = PNG.encode(width,height,data,4);
  write(name+'.png',png);
  return ink.readTilesetImage(png);
}
const scene = {id:'relay-inspection',style:'slate',solids:[],
  camera:{target:[.2,.65,-.05],dist:3.8,yaw:-.17,pitch:.16,projection:'orthographic',sway:0},
  tilesets:{
    sign:sheet('sign',33,17,[
      rect(0,0,33,17,'#203c48'),rect(3,2,23,13,'#4f7f80'),rect(4,3,21,1,'#9eb192'),
      rect(6,6,16,6,'#254553'),text('RLY',8,7,1,'#e9c583'),rect(18,8,2,2,'#db9a64'),
      rect(27,2,4,8,'#ae865d'),rect(28,3,2,5,'#dcc19b'),rect(2,15,18,1,'#355964')
    ]),
    brass:sheet('brass',17,9,[
      rect(0,0,17,9,'#513c39'),rect(1,1,14,7,'#a36e52'),rect(2,1,12,1,'#d8ad79'),
      rect(3,3,10,3,'#6f5143'),rect(5,4,2,1,'#d8ad79'),rect(9,4,2,1,'#d8ad79'),
      rect(14,1,1,7,'#6f5143'),rect(2,7,12,1,'#d8ad79')
    ])
  }};
const editor = ink.createSceneEditor(scene);
const pick = (tileset,x,y,width,height)=>ink.pickTilesetRectangle(scene,tileset,{x,y,width,height});
editor.placeTilesetFace({object:'relay',face:'sign',selection:pick('sign',4,3,21,11),origin:[-1.15,.08,0],
  worldSize:[1.85,1.15],uvInset:{left:.5,top:1.25,right:1}});
const doc = editor.meshTopology('relay').document;
const edge = doc.edges.find(row=>row.vertices.includes('sign/v1') && row.vertices.includes('sign/v2')).id;
editor.growTilesetFace({object:'relay',edge,face:'trim',selection:pick('brass',2,1,12,7),depth:.78,angle:25,
  paint:{rotation:90},uvInset:{left:.25,bottom:.5}});
const before = editor.snapshot();
json('relay.json',before);
json('relay-topology.json',before.topologyMeshes.relay.document);
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
run(['mesh-uv','layout','relay.json','--object','relay','--channel','pigment'],'layout.json');
run(['mesh-uv','layout','relay-topology.json','--atlas','33,17'],'explicit-layout.json');
run(['tileset','eyedrop','--scene','relay.json','--object','relay','--face','trim'],'trim-eyepick.json');
const layout = read('layout.json'), eyedrop = read('trim-eyepick.json');
assert.deepEqual(layout,editor.inspectMeshUV('relay',{uvSet:'pigment'}));
const corners = id=>layout.corners.filter(corner=>corner.face===id);
assert.deepEqual(corners('sign').map(row=>row.texel),[[4.5,13],[23,13],[23,4.25],[4.5,4.25]]);
assert.deepEqual(corners('trim').map(row=>row.texel),eyedrop.uv.map(row=>row.texel));
assert.equal(layout.edges.find(row=>row.id===edge).sides[1].texels.length,2);

const w=172,h=114,W=1065,H=381;
run(['render','relay.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out','relay-1x.png']);
const color = ['#ffc47e','#82d9b8','#f399ab','#ace0fb'];
const commandList = [rect(0,0,W,H,'#172832'),text('INK STUDIO / UV INSPECTION',18,17,2,'#9fc2c3'),
  text('Source texels and normalized UVs',18,43,3),text('Painted relay',18,89,2),
  text('Source atlases',392,89,2),text('Corner coordinates',659,89,2),
  rect(17,117,346,230,'#506a73'),text('NATIVE 1X CAPTURE SHOWN AT 2X',18,356,1,'#9fc2c3')];
const sourceViews = [
  {face:'sign',atlas:'sign',x:410,y:135,zoom:6,heading:'SIGN / 33 x 17',table:126},
  {face:'trim',atlas:'brass',x:410,y:275,zoom:8,heading:'TRIM / 17 x 9',table:244}
];
for (const source of sourceViews) {
  const {face,x,y,zoom,heading,table} = source;
  commandList.push(text(heading,x,y-16,1,'#9fc2c3'),text(heading,659,table,1,'#9fc2c3'),
    text('TEXEL X,Y',683,table+20,1),text('NORMALIZED U,V',811,table+20,1));
  for (const [i,{texel,uv}] of corners(face).entries()) {
    const at = table+36+16*i;
    commandList.push(text('ABCD'[i],659,at,1,color[i]),text(texel.join(', '),683,at,1),text(uv.join(', '),811,at,1));
  }
}
const board = art.render({width:W,height:H,edges:'hard',commands:commandList});
function blit(raster,x,y,zoom) {
  for (let row=0;row<raster.h*zoom;row++) for (let col=0;col<raster.w*zoom;col++) {
    const input=(Math.floor(row/zoom)*raster.w+Math.floor(col/zoom))*4, at=((y+row)*W+x+col)*4;
    board.data.set(raster.data.subarray(input,input+4),at);
  }
}
blit(PNG.raster(file('relay-1x.png')),18,118,2);
const guides = [];
for (const {face,atlas,x,y,zoom} of sourceViews) {
  blit(PNG.raster(file(atlas+'.png')),x,y,zoom);
  const points = corners(face).map(({texel:[u,v]})=>[Math.round(x+(u+.5)*zoom),Math.round(y+(v+.5)*zoom)]);
  guides.push(line([...points,points[0]],'#e8dbc6'));
  points.forEach(([cx,cy],i)=>guides.push(rect(cx-2,cy-2,5,5,color[i]),
    text('ABCD'[i],cx+4,cy-9,1,color[i])));
}
const overlay = art.render({width:W,height:H,edges:'hard',commands:guides}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('UV-texel-inspection.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# UV and source texel inspection

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the JSON reports and native render.

The panel and its trim have separate source sheets. The sign has
fractional UV insets and the brass brush is rotated a quarter turn.
The layout report keeps normalized UVs and source texel coordinates
together for both faces and both sides of their shared edge.
`);
