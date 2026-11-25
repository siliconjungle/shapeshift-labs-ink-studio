'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir=path.resolve(process.argv[2] ?? 'transform-variants');
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(dir,name);
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const { KIT: K }=ink.load(), T=K.meshTopology, art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f5ebd8')=>({type:'text',text,at:[x,y],scale,color});
const muted='#afc5c8', green='#a4dec2', pink='#eab4b3', gold='#ebc277';
const plates=[
  {id:'a',x:-.72,z:.04,outer:'#284852',pigment:'#5b9581',light:'#d2e9aa',accent:green},
  {id:'b',x:.72,z:-.04,outer:'#4d4056',pigment:'#a5636e',light:'#f6d1a6',accent:pink}
];
const hull=[[0,.14],[.14,0],[.86,0],[1,.14],[1,.86],[.86,1],[.14,1],[0,.86]];
const vertices=[], faces=[];
for (const [i,{id,x,z}] of plates.entries()) {
  vertices.push(...hull.map(([u,v],j)=>({id:id+'/'+j,position:[x+(u-.5)*1.07,.14+(1-v)*.98,z]})));
  faces.push({id,corners:hull.map(([u,v],j)=>({id:id+'/c'+j,vertex:id+'/'+j,uv:[(i*32+.5+u*31)/64,(.5+v*31)/32]})).reverse()});
}
const document=T.create({id:'painted-relay-plates',vertices,faces});
const atlas=art.render({width:64,height:32,edges:'hard',commands:plates.flatMap(({id,outer,pigment,light},i)=>{
  const x=i*32;
  return [rect(x,0,32,32,outer),rect(x+3,2,26,28,pigment),rect(x+5,3,22,2,light),
    rect(x+7,8,18,15,outer),label(id.toUpperCase(),x+11,10,2,light),
    rect(x+3,25,2,2,light),rect(x+27,25,2,2,light),rect(x+12,27,8,2,light)];
})});
const paint=PNG.encode(64,32,atlas.data,4);
const scene={id:'relay-production-bench',style:'slate',solids:[],
  camera:{target:[0,.66,0],dist:3.35,yaw:.23,pitch:.14,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(paint)},topologyMeshes:{plates:{document,materials:[
    {id:'default',texture:{tileset:'paint'}}]}}};
json('original.json',scene);
write('paint.png',paint);

const selection=T.select(document,{domain:'faces'});
const recipe={kind:'randomize',mode:'individual',
  translation:{x:{min:-.25,max:.25,step:.125},y:{min:-.25,max:.25,step:.125}},
  rotation:{y:{min:-20,max:20,step:10},z:{min:-30,max:30,step:5}},
  scale:{x:{min:.8,max:1.2,step:.1},y:{min:.8,max:1.2,step:.1}}};
const cases=[
  ['original','Original','The plates start in their authored positions.'],
  ['seed-246','Seed 246','Two groups draw separate transforms.',246],
  ['seed-901','Seed 901','The same bounds produce another layout.',901],
  ['replay','Replay seed 246','The receipt exactly restores the recorded edit.']
];
const view={w:166,h:88}, commands=[];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const [id,,,seed] of cases) {
  if (seed!==undefined) {
    json(id+'-request.json',{selection,space:'world',operation:{...recipe,seed}});
    const args=['mesh-topology','transform','original.json',id+'-request.json','--object','plates'];
    run(args,id+'-preview.json');
    run([...args,'--out',id+'.json','--report',id+'-receipt.json']);
    const evidence=read(id+'-receipt.json').transform;
    assert.deepEqual(evidence,read(id+'-preview.json').report);
    assert.equal(evidence.operation.groups.length,2);
  }
  if (id==='replay') run(['mesh-topology','transform','original.json','seed-246-receipt.json',
    '--object','plates','--replay','--out','replay.json','--report','replay-receipt.json']);
  run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
}
for (const ext of ['.json','-1x.png']) {
  assert.deepEqual(fs.readFileSync(file('seed-246'+ext)),fs.readFileSync(file('replay'+ext)));
  assert.notDeepEqual(fs.readFileSync(file('seed-246'+ext)),fs.readFileSync(file('seed-901'+ext)));
  commands.push('cmp seed-246'+ext+' replay'+ext);
}

const W=714,H=621, zoom=2, slots=[[18,111],[366,111],[18,356],[366,356]];
const format=(nums,places)=>nums.map(value=>value.toFixed(places)).join('/');
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#192730'),label('INK STUDIO / MESH TRANSFORMS',18,15,2,muted),
  label('Vary two painted relay plates',18,44,3),
  ...cases.flatMap(([id,title,note],i)=>{
    const [x,y]=slots[i], bottom=y+zoom*view.h;
    const groups=id==='original' ? [] : read((id==='replay' ? 'seed-246' : id)+'-receipt.json').transform.operation.groups;
    return [label(title,x,y-21,2,id==='replay' ? gold : '#f5ebd8'),
      rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#526c71'),label(note,x,bottom+9,1,muted),
      ...groups.map((row,j)=>label(plates[j].id.toUpperCase()+'  '+format(row.translation.slice(0,2),3)+
        '   '+format(row.rotation.slice(1),0)+'   '+format(row.scale.slice(0,2),1),x,bottom+24+j*12,1,plates[j].accent))];
  }),
  label('READOUT   MOVE X/Y   TURN Y/Z   SCALE X/Y',18,603,1,muted)
]});
for (const [i,[x,y]] of slots.entries()) {
  const {w,h,data}=PNG.raster(file(cases[i][0]+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at=(Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
}
write('Mesh-randomize.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Vary two painted relay plates

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce the
native captures, variants, and receipts.

Two seeds draw within the same translation, rotation, and scale
bounds. The plates each keep their own pivot and paint. The final
commands replay seed 246 from its receipt and compare both the scene
JSON and native PNG byte for byte.
`);
