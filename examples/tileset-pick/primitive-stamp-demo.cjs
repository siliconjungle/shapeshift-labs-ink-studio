'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir=path.resolve(process.argv[2] ?? 'primitive-stamp-demo');
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(dir,name);
const write=(name,data)=>fs.writeFileSync(file(name),data);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const art=ink.load().KIT.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color='#efe6cf')=>({type:'text',text,at:[x,y],scale,color});
const sample=art.render({width:32,height:16,edges:'hard',commands:[
  rect(0,0,32,16,'#21434e'),rect(0,1,32,13,'#366d71'),
  rect(0,1,32,2,'#9ab7a1'),rect(0,3,32,1,'#67928a'),
  rect(0,12,32,2,'#254f5b'),rect(0,14,32,1,'#967254'),
  ...[0,8,16,24].flatMap(x=>[
    rect(x,4,1,8,'#2c5762'),rect(x+1,4,6,1,'#56908f'),rect(x+2,7,5,2,'#be9664'),
    rect(x+3,6,2,4,'#e5c585'),rect(x+3,7,2,1,'#f5dba4'),rect(x+2,10,4,1,'#2f5762')
  ])
]});
const draft={id:'primitive-enamel-set',style:'slate',solids:[],
  constructionPlane:{right:[1,0,0],up:[0,0,-1]},
  tilesets:{enamel:{...ink.readTilesetImage(PNG.encode(32,16,sample.data,4)),tileSize:{width:8,height:8}}}};
json('draft.json',draft);

const commands=[];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const fd=report ? fs.openSync(file(report),'w') : null;
  try {
    execFileSync(process.execPath,[cli,...args],{cwd:dir,stdio:['ignore',fd ?? 'ignore','pipe']});
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
studio(['tileset','pick','--scene','draft.json','--id','enamel','--brush','--x','0','--y','0','--width','32','--height','16',
  '--out','brush.json']);
studio(['tileset','brush-preview','brush.json','--scene','draft.json','--out','brush-1x.png']);
const forms=[
  ['box',[1.72,1.15,1.3],{subdivisions:2},'2 DIVISIONS PER EDGE'],
  ['wedge',[1.85,1.3,1.52],{subdivisions:2},'2 DIVISIONS PER EDGE'],
  ['cylinder',[1.6,1.42,1.74],{radial:10,axial:3},'10 RADIAL / 3 AXIAL'],
  ['cone',[1.68,1.46,2.03],{radial:10,axial:3},'10 RADIAL / 3 AXIAL'],
  ['sphere',[1.71,1.5,1.67],{radial:8,axial:4},'8 RADIAL / 4 AXIAL']
];
for (const [kind,size,segments] of forms) {
  const request={id:kind,object:'prop',kind,size,segments};
  json(kind+'-request.json',request);
  const args=['tileset','primitive',kind+'-request.json','--scene','draft.json','--selection','brush.json'];
  studio(args,kind+'-preview.json');
  studio([...args,'--out',kind+'.json'],kind+'-receipt.json');
  assert.deepEqual(read(kind+'-preview.json'),read(kind+'-receipt.json'));
}
const revise={id:'sphere',object:'prop',mode:'revise',size:[1.9,1.6,2.04],segments:{radial:16,axial:8}};
json('revised-request.json',revise);
const args=['tileset','primitive','revised-request.json','--scene','sphere.json'];
studio(args,'revised-preview.json');
studio([...args,'--out','revised.json'],'revised-receipt.json');
assert.deepEqual(read('revised-preview.json'),read('revised-receipt.json'));
assert.equal(read('revised-receipt.json').faces,128);
assert.deepEqual(read('revised-receipt.json').size,revise.size);
const editor=ink.createSceneEditor(read('sphere.json'));
editor.applyTilesetPrimitive(revise);
editor.undo();
assert.deepEqual(editor.snapshot(),read('sphere.json'));

const views=[...forms.map(([kind,,,note])=>[kind,kind.toUpperCase(),note]),
  ['revised','REVISED SPHERE','16 RADIAL / 8 AXIAL / TALLER']];
for (const [name] of views)
  studio(['render',name+'.json','--w','146','--h','105','--px','1','--ortho','--yaw','.53','--pitch','.34',
    '--target','.87,.94,-.73','--zoom','4.35','--raw','--out',name+'-1x.png']);

const W=960,H=650,panels=[23,334,645],Y=[133,392];
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#14232c'),text('INK STUDIO / PAINTED MESHES',23,19,2,'#a6dcbd'),
  text('Stamp and revise textured primitives',23,49,3),
  text('ONE SAVED BRUSH / NATIVE 1X CAPTURES SHOWN AT 2X',23,83,1),
  ...views.flatMap(([,label,note],i)=>{
    const x=panels[i%3], y=Y[Math.floor(i/3)];
    return [text(label,x,y-26,2,'#a6dcbd'),rect(x-1,y-1,294,212,'#486972'),text(note,x,y+224,1)];
  })
]});
for (const [i,[name]] of views.entries()) {
  const {w,h,data}=PNG.raster(file(name+'-1x.png')), x0=panels[i%3], y0=Y[Math.floor(i/3)];
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at=(Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((y0+y)*W+x0+x)*4);
  }
}
write('Textured-primitives.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n'+
  views.map(([name])=>'cmp '+name+'-preview.json '+name+'-receipt.json').join('\n')+'\n');
write('README.md',`# Stamp and revise textured primitives

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The same compact
enamel brush paints a box, wedge, cylinder, cone, and sphere. The
last request revises the first sphere's dimensions and segments.
Every capture uses the same native grid and camera. The receipts
record each mesh's parameters and atlas bindings.
`);
