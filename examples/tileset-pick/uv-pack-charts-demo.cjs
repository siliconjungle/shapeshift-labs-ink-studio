'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, UV = T.uv, art = K.procedural.drawing2d;
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const dir = path.resolve(process.argv[2] ?? 'uv-pack-charts-demo');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f2e8ce')=>({type:'text',text,at:[x,y],scale,color});
const width=104,height=72;
const paper = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#1e323d'),
  ...Array.from({length:13},(_,i)=>rect(i*8,0,1,height,'#2e4855')),
  ...Array.from({length:9},(_,i)=>rect(0,i*8,width,1,'#2e4855')),
  rect(3,3,19,12,'#395663'),rect(4,4,17,1,'#7d9894'),text('P2',7,7,1,'#cebb97'),
  rect(51,3,25,8,'#314654'),rect(55,5,15,2,'#677984')
]});
const texture = PNG.encode(width,height,paper.data,4);
write('working-atlas.png',texture);

const vertices = [], faces = [];
function board(id,index,box,hold=false) {
  const keys = ['b'+index,'b'+(index+1),'t'+(index+1),'t'+index];
  for (const [i,key] of keys.entries()) if (!vertices.some(row=>row.id===key)) {
    const x = Number(key.slice(1))*.58, z = key.endsWith('2') ? -.23 : .01;
    vertices.push({id:key,position:[x,i<2 ? 0 : .85,z]});
  }
  const [l,t,r,b] = box;
  const uv = [[l,b],[r,b],[r,t],[l,t]];
  faces.push({id,material:'enamel',corners:keys.map((vertex,i)=>({
    id:id+'/'+i,vertex,uv:[uv[i][0]/width,uv[i][1]/height],...(hold && i===0 && {uvPinned:true})
  }))});
}
board('sign-panel',0,[15,37,34,54]);
board('sign-return',1,[34,37,46,54]);
board('badge',3,[51,43,66,54]);
board('brace',5,[76,21,94,27]);
board('corner-cap',7,[88,54,99,64]);
board('maker-mark',9,[3,3,22,15],true);
board('reserved-label',11,[51,3,76,11]);
const document = T.create({id:'enamel-side-panels',vertices,faces});
json('panel.json',{id:'chart-packing',style:'slate',solids:[],
  camera:{target:[3.45,.42,0],dist:10,yaw:-.12,pitch:.15,projection:'orthographic'},
  tilesets:{enamel:ink.readTilesetImage(texture)},
  topologyMeshes:{panel:{document,materials:[{id:'enamel',texture:{tileset:'enamel'}}]}}});
json('view.json',{w:234,h:176});
const selected = UV.select(document,{domain:'faces',ids:['sign-return','badge','brace','corner-cap','maker-mark']});
const base = {op:'pack-charts',selection:selected,groups:[{id:'sign-and-badge',islands:['sign-panel','badge']}],gutter:1};
const request = pool=>({revision:T.revision(document),operations:[{...base,pool}]});
json('pack.json',request([0,0,87,48]));
json('narrow.json',request([0,0,50,29]));

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const edit = name=>['mesh-uv','edit','panel.json',name+'.json','--object','panel','--view','view.json'];
run(edit('pack').concat('--preview','pack-review'),'pack-preview.json');
run(edit('pack').concat('--out','packed.json','--report','pack-receipt.json'));
run(edit('narrow').concat('--preview','narrow-review'),'narrow-preview.json');

const preview = read('pack-preview.json'), receipt = read('pack-receipt.json'), narrow = read('narrow-preview.json');
assert(receipt.canCommit);
assert.deepEqual(preview.operations,receipt.operations);
const evidence = receipt.operations[0].evidence, charts = new Map(evidence.charts.map(row=>[row.id,row]));
assert.deepEqual(charts.get('sign-panel').faces,['sign-panel','sign-return']);
assert.deepEqual(charts.get('sign-panel').translation,charts.get('badge').translation);
assert.equal(charts.get('maker-mark').status,'held');
assert.deepEqual(read('packed.json').topologyMeshes.panel.document.vertices,document.vertices);
assert(!narrow.canCommit);
assert.deepEqual(narrow.operations[0].evidence.unpacked,['badge','sign-panel']);

const W=596,H=276,x=i=>22+i*188, imageY=108;
const panel = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#162832'),text('INK STUDIO / MESH UV',22,15,2,'#9fc2bf'),
  text('Pack connected charts',22,43,3),
  text('SOURCE',x(0),82,2),text('PACKED',x(1),82,2),text('POOL TOO SMALL',x(2),82,2),
  text('ORIGINAL LAYOUT',x(0),100,1,'#a3c1c7'),text('87 X 48 POOL',x(1),100,1,'#a3c1c7'),
  text('50 X 29 POOL',x(2),100,1,'#eeb1b9'),
  text('GROUP NEEDS '+narrow.operations[0].conflicts[0].required.join(' X '),
    x(2),240,1,'#f391a6'),
  ...[['POOL','#ffe181'],['LINKED GROUP','#f0b8ff'],['HELD CHART','#a8beff'],['UNPACKED','#f391a6']]
    .flatMap(([label,color],i)=>[rect(22+i*141,257,8,8,color),text(label,37+i*141,257,1)])
]});
for (const [i,name] of ['pack-review/atlas-before.png','pack-review/atlas-after.png','narrow-review/atlas-after.png'].entries()) {
  const image = PNG.raster(file(name));
  for (let row=0;row<126;row++) {
    const start = (row+25)*image.w*4, out = ((row+imageY)*W+x(i))*4;
    panel.data.set(image.data.subarray(start,start+image.w*4),out);
  }
}
write('UV-pack-charts.png',PNG.encode(W,H,panel.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Pack connected UV charts

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the edited scene, receipts, and native review images.

The sign face and its folded return are one UV island. A named group holds
the separate badge at its original offset from the sign. Ink places other
islands around the pinned maker mark and the unselected label. A second
run uses a smaller pool and reports both island IDs in the oversized group.
`);
