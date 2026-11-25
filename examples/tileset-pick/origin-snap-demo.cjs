'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'origin-snap-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const read = name=>fs.readFileSync(file(name));
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const draw = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const marker = draw.render({width:12,height:12,edges:'hard',commands:[
  rect(0,0,12,12,'#356766'),rect(1,1,10,10,'#629e88'),
  rect(0,9,12,3,'#233c44'),rect(0,0,2,12,'#b7cfa3'),
  rect(4,4,5,2,'#f4d08b'),rect(4,6,2,3,'#f4d08b')
]});
const sheet=ink.readTilesetImage(PNG.encode(12,12,marker.data,4));
const world={
  id:'origin-snap-sample',style:'slate',solids:[],
  constructionPlane:{origin:[0,0,0],right:[1,0,0],up:[0,.96,.28],grid:.25},
  tilesetDefaults:{texelsPerUnit:16},tilesets:{marker:sheet},
  prefabs:{peg:{revision:1,solids:{pin:{kind:'box',at:[0,.08,-.18],half:[.18,.27,.12],mat:'accent',res:.06}}}},
  instances:{datum:{prefab:'peg',transform:{translation:[-1.4,.5,0],pivot:[.25,0,0],scale:2}}},
  topologyMeshes:{panel:{document:{id:'panel',vertices:[
    {id:'foot',position:[0,0,0]},{id:'toe',position:[2.6,0,0]},{id:'crown',position:[.55,1.8,0]}
  ],faces:[{id:'taper',material:'slate',corners:[
    {id:'foot-c',vertex:'foot'},{id:'toe-c',vertex:'toe'},{id:'crown-c',vertex:'crown'}
  ]}]},materials:[{id:'slate',color:0x344d57}]}}
};
json('draft.json',world);
json('vertices.json',{domain:'vertices',ids:['foot','toe','crown']});
studio(['mesh-topology','select','draft.json','vertices.json','--object','panel','--out','selection.json']);

const targets = [
  ['vertex',['--object','panel','--vertex','crown']],
  ['instance',['--instance','datum']],
  ['bounds',['--object','panel','--selection','selection.json']],
  ['average',['--object','panel','--selection','selection.json']]
];
const snaps=[];
for (const [name,args] of targets) {
  const command=['mesh-topology','plane','draft.json','--snap-origin',name,...args];
  const preview=JSON.parse(studio(command,name+'-preview.json'));
  assert.deepEqual(JSON.parse(studio([...command,'--out',name+'-guide.json'],name+'-receipt.json')),preview);
  const placed=JSON.parse(studio(['tileset','stamp','--scene',name+'-guide.json','--object','marker','--face','marker',
    '--id','marker','--x','0','--y','0','--width','12','--height','12','--plane','0,0',
    '--out',name+'.json'],name+'-stamp.json'));
  assert.deepEqual(placed.vertices[0].position,preview.snap.target);
  snaps.push(preview.snap.target);
  studio(['render',name+'.json','--w','126','--h','98','--px','1','--ortho','--yaw','.12','--pitch','.10',
    '--target','.6,1.1,0','--zoom','2.45','--raw','--out',name+'-1x.png']);
}
assert.notDeepEqual(snaps[2],snaps[3]);
assert.equal(new Set(targets.map(([id])=>read(id+'-1x.png').toString('base64'))).size,4);
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+
  '\n'+targets.map(([id])=>'cmp '+id+'-preview.json '+id+'-receipt.json').join('\n')+'\n');
write('README.md',`# Construction origin snap

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The demo stamps
the same green marker at a mesh vertex, the transformed origin of
a prefab peg, the bounds midpoint of three vertices, and their average.
The saved previews contain the exact target and the source used to
resolve it. The renders use one camera at native resolution.
`);

const W=1092,H=374, panels=[20,288,556,824];
const labels=['SCENE VERTEX','INSTANCE ORIGIN','SELECTION BOUNDS','SELECTION AVERAGE'];
const colors=['#f8e8d1','#f8e8d1','#a6e3cd','#ffc789'];
const board=draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121c27'),
  text('INK STUDIO / CONSTRUCTION ORIGIN',20,20,2,'#a6e3cd'),
  text('Four anchors for the same painted stamp',20,49,3),
  ...panels.flatMap((x,i)=>[
    text(labels[i],x,105,2,colors[i]),
    rect(x-1,132,254,198,'#506d75'),
    text('XYZ '+snaps[i].map(n=>Number(n.toFixed(2))).join(', '),x,347,1,colors[i])
  ])
]});
for (const [index,[name]] of targets.entries()) {
  const {w,h,data}=PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at=(Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((133+y)*W+panels[index]+x)*4);
  }
}
write('Origin-snap-placement.png',PNG.encode(W,H,board.data,4));
