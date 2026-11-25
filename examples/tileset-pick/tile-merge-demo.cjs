'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'tile-merge-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const navy = '#1c2c33', mint = '#abdbbc', amber = '#efbd78', slate = '#a9bec0';
const width = 52, height = 24;
const pigment = art.render({width,height,edges:'hard',commands:[
  rect(0,0,width,height,'#25424a'),rect(1,1,50,22,'#619288'),rect(2,2,48,2,'#a9cdb0'),
  rect(3,6,46,11,'#2d5155'),text('PUMP BAY',3,8,1,'#f0ddae'),
  ...[3,11,19,27,35,43].map(x=>rect(x,19,6,2,'#c69363')),
  rect(24,2,2,3,'#f4ca87'),rect(25,18,2,4,'#f4ca87')
]});
const atlas = PNG.encode(width,height,pigment.data,4);
write('paint-atlas.png',atlas);
const source = {id:'painted-pump-bay',style:'slate',solids:[],
  camera:{target:[0,.6,0],dist:3.2,yaw:.13,pitch:.10,projection:'orthographic',sway:0},
  tilesets:{paint:ink.readTilesetImage(atlas)}};
const pick = (x,width)=>ink.pickTilesetRectangle(source,'paint',{x,y:0,width,height});

function assemble(second) {
  const editor = ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'sign',face:'left',selection:pick(0,26),worldSize:[1.18,1.15],origin:[-1.18,.03,0]});
  const {document} = editor.meshTopology('sign');
  const edge = T.inspect(document).edges.find(row=>row.vertices.every(id=>['left/v1','left/v2'].includes(id)));
  editor.growTilesetFace({object:'sign',face:'right',edge:edge.id,selection:second,depth:1.18,paint:{rotation:270}});
  const doc = editor.meshTopology('sign').document;
  return {scene:editor.snapshot(),request:{revision:T.revision(doc),operations:[{kind:'merge-tiles',edge:edge.id,keep:'left'}]}};
}

const exact = assemble(pick(25,26)), gap = assemble(pick(31,20));
json('exact.json',exact.scene);
json('safe.json',exact.request);
json('gap.json',gap.scene);
json('blocked.json',gap.request);
json('override.json',{...gap.request,operations:gap.request.operations.map(op=>({...op,mode:'force'}))});
json('tile-query.json',{domain:'tiles',object:'sign'});

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const repair = (scene,request)=>['mesh-topology','repair',scene+'.json',request+'.json','--object','sign'];
run(repair('exact','safe').concat('--out','merged.json','--report','merge-receipt.json'));
run(['tileset','select','tile-query.json','--scene','merged.json'],'merged-sources.json');
run(repair('gap','blocked'),'blocked-preview.json');
const refusal = repair('gap','blocked').concat('--out','refused.json');
commands.push('if ink-studio '+refusal.join(' ')+' 2> rejected.log; then exit 1; fi','test ! -e refused.json');
const failed = spawnSync(process.execPath,[cli,...refusal],{cwd:dir,encoding:'utf8'});
assert.equal(failed.status,1);
assert.match(failed.stderr,/changes registered data/);
assert(!fs.existsSync(file('refused.json')));
write('rejected.log',failed.stderr);
run(repair('gap','override'),'override-preview.json');
run(repair('gap','override').concat('--out','forced.json','--report','override-receipt.json'));
assert.equal(read('merged-sources.json').tiles[0].sources.length,2);
assert.equal(read('blocked-preview.json').report.blockers[0].code,'tile-merge-loss');
assert.deepEqual(read('override-receipt.json').repair,read('override-preview.json').report);
assert.equal(read('override-preview.json').report.steps[0].discarded.filter(row=>row.kind==='shared-uv').length,2);

const w = 118, h = 90, zoom = 2;
const views = [
  ['exact','Registered tiles','2 faces / one shared border texel',mint],
  ['merged','Safe merge','1 face / both source crops retained',mint],
  ['gap','Atlas gap','Safe merge blocked',amber],
  ['forced','Forced merge','LEFT wins at both seam endpoints',amber]
];
for (const [name] of views)
  run(['render',name+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',name+'-1x.png']);
assert.deepEqual(fs.readFileSync(file('exact-1x.png')),fs.readFileSync(file('merged-1x.png')));
assert.notDeepEqual(fs.readFileSync(file('gap-1x.png')),fs.readFileSync(file('forced-1x.png')));
commands.push('cmp exact-1x.png merged-1x.png');

const W = 1020, H = 340, y = 112;
const xAt = i=>16+i*251;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / TILE TOPOLOGY',16,16,2,slate),
  text('Merge a painted panel across its seam',16,43,3),
  ...views.flatMap(([,title,note,color],i)=>{
    const x = xAt(i);
    return [text(title,x,87,2),rect(x-1,y-1,w*zoom+2,h*zoom+2,'#506e73'),text(note,x,y+h*zoom+15,1,color)];
  })
]});
for (const [i,[name]] of views.entries()) {
  const {data} = PNG.raster(file(name+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at = (Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+xAt(i)+col)*4);
  }
}
write('Tile-merge.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Merge adjacent painted tiles

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce the
native renders, source picks, previews, and receipts.

The first pair of tiles shares an atlas border texel on each end of the
seam. Safe merge removes the shared edge and keeps both paint references.
The second pair skips six atlas texels at the seam. The forced preview
records the endpoint changes and what happens to the original crop
bindings when LEFT's values win.
`);
