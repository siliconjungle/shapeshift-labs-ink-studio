'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'collection-orientation-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const art = ink.load().KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#e7e9cc')=>({type:'text',text,at:[x,y],scale,color});
const shapes = {
  fern:x=>[
    rect(x+5,11,2,3,'#102d32'),rect(x+6,9,2,3,'#527759'),rect(x+7,6,2,4,'#709754'),
    rect(x+8,4,2,4,'#8eb263'),rect(x+9,2,2,3,'#a9c679'),rect(x+10,1,1,2,'#c3d489'),
    rect(x+3,8,5,2,'#577b57'),rect(x+4,6,4,2,'#7f9d5d'),rect(x+2,5,4,1,'#6c8d58'),
    rect(x+8,7,5,2,'#7e9f5d'),rect(x+10,5,4,2,'#a1b972'),rect(x+11,4,3,1,'#bad088'),
    rect(x+4,11,2,1,'#335746'),rect(x+12,12,2,1,'#34574b')
  ],
  bloom:x=>[
    rect(x+5,9,2,5,'#102d32'),rect(x+6,7,2,4,'#829957'),rect(x+7,5,1,3,'#9a9e5b'),
    rect(x+3,9,3,2,'#527759'),rect(x+2,8,3,1,'#749458'),rect(x+7,8,4,2,'#527759'),
    rect(x+9,7,3,1,'#829957'),rect(x+6,3,5,3,'#b57761'),rect(x+7,2,3,5,'#cd9373'),
    rect(x+7,3,2,2,'#e8b983'),rect(x+12,11,2,2,'#527759'),rect(x+13,10,1,1,'#829957')
  ],
  stones:x=>[
    rect(x+3,8,7,4,'#152f38'),rect(x+2,7,6,3,'#536c68'),rect(x+3,6,5,2,'#788777'),
    rect(x+4,6,3,1,'#9a9c7c'),rect(x+9,4,5,3,'#536c68'),rect(x+10,3,3,1,'#8a9479'),
    rect(x+11,10,3,2,'#4a6d53'),rect(x+11,9,2,1,'#749458'),rect(x+4,12,2,1,'#34574b')
  ]
};
const variants = Object.keys(shapes);
const atlas = art.render({width:48,height:16,edges:'hard',commands:variants.flatMap((id,i)=>{
  const x = i*16;
  return [rect(x,0,16,16,'#23423e'),rect(x+1,2,2,2,'#294943'),rect(x+10,13,4,2,'#294943'),...shapes[id](x)];
})});
const image = PNG.encode(48,16,atlas.data,4);
write('Courtyard-atlas.png',image);
const scene = {id:'garden-tiles',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},
  tilesets:{garden:ink.readTilesetImage(image)}};
const draft = {id:'garden-path',entries:variants.map((id,i)=>({id,weight:[5,2,3][i],
  selection:ink.pickTilesetRectangle(scene,'garden',{x:i*16,y:0,width:16,height:16})}))};
const orientations = [{},{rotation:90},{rotation:180},{rotation:270},{flipX:true},{rotation:90,flipX:true}];
json('garden.json',scene);
json('fixed-draft.json',draft);
json('varied-draft.json',{...draft,orientations});
json('bed-request.json',{id:'bed',object:'courtyard',mode:'fill',from:[0,0],to:[7,3],seed:42});

const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+' > '+(report ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}
for (const kind of ['fixed','varied']) {
  studio(['tileset','collection','create',kind+'-draft.json','--scene','garden.json','--out',kind+'-collection.json']);
  const args = ['tileset','rectangle','bed-request.json','--scene','garden.json','--collection',kind+'-collection.json'];
  const preview = studio(args,kind+'-preview.json');
  assert.equal(studio([...args,'--out',kind+'-bed.json'],kind+'-receipt.json'),preview);
  studio(['render',kind+'-bed.json','--w','150','--h','82','--px','1','--ortho','--yaw','0','--pitch','0',
    '--target','4,2,0','--zoom','1.97','--raw','--out',kind+'-1x.png']);
}
const fixed = read('fixed-receipt.json'), varied = read('varied-receipt.json');
assert.deepEqual(fixed.cells.map(cell=>cell.variant.id),varied.cells.map(cell=>cell.variant.id));
assert.deepEqual(read('fixed-bed.json').topologyMeshes.courtyard.document.vertices,
  read('varied-bed.json').topologyMeshes.courtyard.document.vertices);
const used = new Set(varied.cells.map(cell=>JSON.stringify(cell.variant.paint))).size;
assert(used>2);
const choice = studio(['tileset','collection','sample','varied-collection.json','--scene','garden.json','--seed','42','--key','3',
  '--out','tile-pick.json'],'tile-choice.json');
const stamp = studio(['tileset','stamp','--scene','garden.json','--object','single','--face','tile','--selection','tile-pick.json',
  '--out','single-tile.json'],'stamp-receipt.json');
assert.deepEqual(JSON.parse(stamp).source.collectionChoice,JSON.parse(choice).selection.collectionChoice);

const W = 956,H = 461;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#172832'),text('INK STUDIO / TILE MESHES',24,20,2,'#a8c493'),
  text('Seeded tile orientations',24,52,3),text('SAME 32 TILE PICKS / SEED 42',24,87,2),
  text('FIXED PAINT',24,123,2,'#a8c493'),text('PERMITTED ROTATIONS AND REFLECTIONS',486,123,2,'#a8c493'),
  rect(23,151,452,248,'#4d7067'),rect(485,151,452,248,'#4d7067'),
  text('SOURCE TILES',24,428,1,'#a8c493'),text(`${used} OF ${orientations.length} PERMITTED ORIENTATIONS USED`,486,423,2)
]});
function blit(data,width,crop,at,scale) {
  const [sx,sy,w,h] = crop, [dx,dy] = at;
  for (let y=0;y<h*scale;y++) for (let x=0;x<w*scale;x++) {
    const start = ((sy+Math.floor(y/scale))*width+sx+Math.floor(x/scale))*4;
    board.data.set(data.subarray(start,start+4),((dy+y)*W+dx+x)*4);
  }
}
for (const [kind,x] of [['fixed',24],['varied',486]]) {
  const frame = PNG.raster(file(kind+'-1x.png'));
  blit(frame.data,frame.w,[0,0,frame.w,frame.h],[x,152],3);
}
variants.forEach((_,i)=>blit(atlas.data,48,[16*i,0,16,16],[110+40*i,414],2));
write('Tile-orientations.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp fixed-preview.json fixed-receipt.json\ncmp varied-preview.json varied-receipt.json\n');
write('README.md',`# Seeded tile orientations

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. Both 32-face garden
patches pick the same tiles. The varied patch opts into six paint transforms.
The native renders use the same camera, brush size, and geometry. The receipts
record every placement choice. The single-tile stamp shows how an oriented pick
carries its provenance into a separate edit.
`);
