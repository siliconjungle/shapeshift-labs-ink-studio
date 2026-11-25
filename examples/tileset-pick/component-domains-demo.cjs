'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');

const dir = path.resolve(process.argv[2] ?? 'component-domains-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#e9e4ce')=>({type:'text',text,at:[x,y],scale,color});
const tiles = ['recess','inlay','rivets'];
const atlas = art.render({width:48,height:16,edges:'hard',commands:tiles.flatMap((id,i)=>{
  const x = i*16;
  const accent = {
    recess:[rect(x+3,5,10,6,'#203f46'),rect(x+4,5,8,1,'#75a59a'),rect(x+4,7,8,3,'#366b69')],
    inlay:[rect(x+2,5,12,6,'#28454a'),rect(x+5,7,6,2,'#b98761'),rect(x+7,5,2,6,'#b98761'),
      rect(x+7,7,2,2,'#e8b773')],
    rivets:[rect(x+2,5,12,6,'#28454a'),rect(x+3,6,10,3,'#487b72'),rect(x+4,7,2,2,'#e2b785'),rect(x+10,7,2,2,'#c08e62')]
  };
  return [rect(x,0,16,16,'#162c38'),rect(x+1,1,14,14,'#3f7775'),rect(x+1,1,14,1,'#96b5a0'),
    rect(x+1,13,14,2,'#315359'),rect(x+1,2,1,11,'#5e9b8a'),...accent[id]];
})});
const paint = PNG.encode(48,16,atlas.data,4);
write('Facade-atlas.png',paint);
const scene = {id:'facade-component-domains',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{enamel:ink.readTilesetImage(paint)},prefabs:{signal:{revision:1,solids:{
    plinth:{kind:'box',at:[0,.12,0],half:[.24,.12,.15],mat:'stone'},
    post:{kind:'box',at:[0,.64,0],half:[.09,.52,.09],mat:'metal'},
    cap:{kind:'box',at:[0,1.14,0],half:[.21,.12,.12],mat:'metal'},
    lens:{kind:'box',at:[0,1.19,.11],half:[.11,.06,.03],mat:'glow'}
  }}},instances:{signal:{prefab:'signal',transform:{translation:[4.7,.24,0]}}}};
json('draft.json',scene);
json('enamel-draft.json',{id:'enamel',sequence:['recess','inlay','rivets','inlay'],entries:tiles.map((id,i)=>({id,weight:1,
  selection:ink.pickTilesetRectangle(scene,'enamel',{x:i*16,y:0,width:16,height:16})}))});
json('facade-request.json',{mode:'fill',id:'facade',object:'wall',from:[0,0],to:[3,1]});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,result);
}
studio(['tileset','collection','create','enamel-draft.json','--scene','draft.json','--out','enamel.json']);
studio(['tileset','rectangle','facade-request.json','--scene','draft.json','--collection','enamel.json','--out','wall.json']);

const editor = ink.createSceneEditor(read('wall.json')), doc = editor.meshTopology('wall').document;
const edge = doc.edges.find(row=>row.vertices.includes('facade/2/v0') && row.vertices.includes('facade/2/v1'));
const view = {w:172,h:94,px:1,ortho:true,yaw:0,pitch:0,target:[2.45,1,0],zoom:3.05,raw:true};
json('view.json',view);
const mesh = {object:'wall'};
const inquiries = [
  ['tiles','RESKIN / ONE PAINTED FACE',{edit:'reskin',...mesh,query:{ids:['facade/6'],filter:{visibility:'visible'}}},'#f2bd79'],
  ['edges','GROW / ONE BOUNDARY EDGE',{edit:'grow',...mesh,query:{ids:[edge.id]}},'#ef886b'],
  ['vertices','MOVE VERTEX / ONE CORNER',{edit:'move-vertex',...mesh,query:{ids:['facade/5/v2']}},'#83e3d7'],
  ['instances','SNAP ORIGIN / ONE PREFAB',{edit:'snap-origin',enabledDomains:['instances'],query:{kind:'prefab',ids:['signal']}},'#efda8a']
];
for (const [domain,,request] of inquiries) {
  json(domain+'-query.json',{domain,...request});
  studio(['tileset','select',domain+'-query.json','--scene','wall.json',
    ...(domain==='tiles' ? ['--view','view.json'] : []),
    ...(domain==='vertices' ? ['--topology-out','corner-selection.json'] : [])],domain+'-report.json');
  const result = read(domain+'-report.json');
  assert.deepEqual(result.enabledDomains,[domain]);
  assert.equal(result.ids.length,1);
}
json('move-request.json',{operation:{kind:'move',offset:[0,.22,0]}});
studio(['mesh-topology','transform','wall.json','move-request.json','--object','wall',
  '--selection','corner-selection.json','--out','moved.json','--report','move-receipt.json']);
assert.deepEqual(read('moved.json').topologyMeshes.wall.document.vertices.find(row=>row.id==='facade/5/v2').position,[2,2.22,0]);
studio(['mesh-topology','plane','wall.json','--snap-origin','instance','--instance','signal','--instance-kind','prefab'],
  'instance-snap.json');
assert.deepEqual(read('instance-snap.json').after.origin,read('instances-report.json').instances[0].target);

studio(['render','wall.json','--w','172','--h','94','--px','1','--ortho','--yaw','0','--pitch','0',
  '--target','2.45,1,0','--zoom','3.05','--raw','--out','Facade-1x.png']);
let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(capture,sample)=>{camera=capture;focal=sample.focal;})});
assert(camera.ortho);
const {view:matrix} = camera;
const positions = new Map(doc.vertices.map(vertex=>[vertex.id,vertex.position]));
const selectedFace = doc.faces.find(face=>face.id===read('tiles-report.json').ids[0]);
const selectedEdge = doc.edges.find(row=>row.id===read('edges-report.json').ids[0]);
const selectedVertex = positions.get(read('vertices-report.json').ids[0]);
const instanceOrigin = read('instances-report.json').instances[0].target;
const points = [selectedFace.corners.map(corner=>positions.get(corner.vertex)),selectedEdge.vertices.map(id=>positions.get(id)),
  [selectedVertex],[instanceOrigin]];

const W = 760,H = 592, placements = [[24,124],[392,124],[24,373],[392,373]];
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172932'),text('INK STUDIO / TILE MESHES',24,18,2,'#a6cbb3'),text('Independent selection domains',24,48,3),
  ...inquiries.flatMap(([domain,label,,color],index)=>{
    const [x,y] = placements[index];
    return [text(domain.toUpperCase(),x,y-29,2,color),rect(x-1,y-1,346,190,'#4f7068'),text(label,x,y+200,1)];
  })
]});
const frame = PNG.raster(file('Facade-1x.png'));
const pathMark = (points,color,closed=false)=>({type:'path',points,color,closed,width:3});
const marks = [];
for (const [i,[dx,dy]] of placements.entries()) {
  for (let y=0;y<frame.h*2;y++) for (let x=0;x<frame.w*2;x++) {
    const at = (Math.floor(y/2)*frame.w+Math.floor(x/2))*4;
    board.data.set(frame.data.subarray(at,at+4),((dy+y)*W+dx+x)*4);
  }
  const projected = points[i].map(([x,y,z])=>[
    dx+frame.w+2*focal*(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12]),
    dy+frame.h-2*focal*(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])
  ]);
  const color = inquiries[i][3];
  if (i<2) marks.push(pathMark(projected,color,i===0));
  else {
    const [x,y] = projected[0], r = i===2 ? 4 : 9;
    marks.push(pathMark([[x-r,y],[x,y-r],[x+r,y],[x,y+r]],color,true));
    if (i===3) marks.push(pathMark([[x-14,y],[x+14,y]],color),pathMark([[x,y-14],[x,y+14]],color));
  }
}
const overlay = art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let at=0;at<overlay.length;at+=4) if (overlay[at+3]) board.data.set(overlay.subarray(at,at+4),at);
write('Tile-selection-domains.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Tile selection domains

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. Four queries select a
painted face, an authored edge, a vertex, and a prefab instance on the same
facade. Each report shows the enabled domains for its edit. The vertex query
exports a native selection used by the existing transform command. The prefab
target supplies the origin for the construction plane snap.
`);
