'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'construction-grid-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const read = name=>fs.readFileSync(file(name));
const write = (name,data)=>fs.writeFileSync(file(name),data);
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const draw=ink.load().KIT.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const tile=draw.render({width:16,height:8,edges:'hard',commands:[
  rect(0,0,16,8,'#304b56'),rect(1,1,14,6,'#397d79'),
  rect(1,1,14,1,'#a1c5a4'),rect(2,5,12,1,'#244a54'),
  rect(4,3,2,2,'#f2bf82'),rect(7,3,2,2,'#f2bf82'),rect(10,3,2,2,'#f2bf82')
]});
const paint={...ink.readTilesetImage(PNG.encode(16,8,tile.data,4)),tileSize:{width:16,height:8}};

const vertices=[], faces=[];
function quad(name,x,y,w,h,material) {
  const corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b],i)=>{
    const vertex=name+'-v'+i;
    vertices.push({id:vertex,position:[a,b,-.05]});
    return {id:name+'-c'+i,vertex};
  });
  faces.push({id:name,material,corners});
}
for (let u=0;u<=4;u++) quad('u'+u,u-.026,0,.052,1.5,'line');
for (let v=0;v<=3;v++) quad('v'+v,0,v*.5-.026,4,.052,'line');
quad('origin',-.035,-.035,.07,.07,'datum');
write('draft.json',JSON.stringify({id:'grid-rounding-proof',style:'slate',solids:[],
  tilesetDefaults:{texelsPerUnit:16},tilesets:{paint},
  topologyMeshes:{grid:{document:{id:'grid',vertices,faces},materials:[
    {id:'line',color:0x456a74},{id:'datum',color:0xd8774a}
  ]}}
},null,2)+'\n');

const modes=['floor','nearest','ceiling'], expected=[[1,0],[2,0],[2,1]], resolved=[];
for (const [i,mode] of modes.entries()) {
  const settings=['mesh-topology','plane','draft.json','--grid-preset','brick','--grid-tileset','paint','--rounding',mode];
  const preview=JSON.parse(studio(settings,mode+'-preview.json'));
  assert.deepEqual(preview.after.grid,[1,.5]);
  assert.deepEqual(JSON.parse(studio([...settings,'--out',mode+'-guide.json'],mode+'-receipt.json')),preview);
  const stamp=JSON.parse(studio(['tileset','stamp','--scene',mode+'-guide.json','--object','panel','--face','panel',
    '--id','paint','--x','0','--y','0','--width','16','--height','8','--plane','1.68,.38','--snap-grid',
    '--out',mode+'.json'],mode+'-stamp.json'));
  assert.deepEqual(stamp.gridAt,expected[i]);
  const [u,v]=stamp.gridAt;
  assert.deepEqual(stamp.vertices[0].position,[u,v*.5,0]);
  resolved.push(stamp.gridAt);
  studio(['render',mode+'.json','--w','146','--h','101','--px','1','--ortho',
    '--yaw','0','--pitch','0','--target','2,.73,0','--zoom','3','--raw','--out',mode+'-1x.png']);
}
assert.equal(new Set(modes.map(mode=>read(mode+'-1x.png').toString('base64'))).size,3);
assert.equal(JSON.parse(studio(['mesh-topology','plane','draft.json','--grid-preset','texel'],'texel-preview.json')).after.grid,1/16);
assert.deepEqual(JSON.parse(studio(['mesh-topology','plane','draft.json','--grid-preset','module',
  '--module-size','2,1'],'module-preview.json')).after.grid,[2,1]);

write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  modes.map(mode=>'cmp '+mode+'-preview.json '+mode+'-receipt.json').join('\n')+'\n');
write('README.md',`# Rectangular construction grid and rounding

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The brick
preset resolves a 16×8 texel sheet at 16 texels per world unit to
a 1×0.5 grid. Each stamp starts from the same fractional grid address
(1.68, 0.38). The saved rounding mode changes its snapped cell.
Texel and custom module presets are captured as additional previews.
`);

const W=960,H=390,panels=[23,334,645],colors=['#f8e8d1','#a6e3cd','#ffc789'];
const board=draw.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121c27'),
  text('INK STUDIO / CONSTRUCTION GRID',23,20,2,'#a6e3cd'),
  text('One address, three rounding modes',23,52,3),
  text('REQUESTED GRID ADDRESS 1.68, 0.38 / BRICK GRID 1 x 0.5',23,86,1),
  ...panels.flatMap((x,i)=>[
    text(modes[i].toUpperCase(),x,111,2,colors[i]),
    rect(x-1,139,294,204,'#506d75'),
    text('SNAPPED GRID CELL '+resolved[i].join(', '),x,359,1,colors[i])
  ])
]});
for (const [index,mode] of modes.entries()) {
  const {w,h,data}=PNG.raster(file(mode+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at=(Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((140+y)*W+panels[index]+x)*4);
  }
}
write('Construction-grid-rounding.png',PNG.encode(W,H,board.data,4));
