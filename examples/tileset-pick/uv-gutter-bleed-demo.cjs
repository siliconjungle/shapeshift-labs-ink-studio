'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-gutter-bleed-demo'), cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const box = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,scale,color='#f5e5c3')=>({type:'text',text,at:[x,y],scale,color});
const width=64,height=48, rect=[14,9,28,28], [l,t,w,h]=rect;
const image = art.render({width,height,edges:'hard',commands:[
  box(0,0,width,height,'#ca276b'),
  ...[1,8,15,22,29,36,43].map(y=>box(0,y,width,2,'#e4487e')),
  box(l,t,w,h,'#537d6a'),box(l+1,t+1,26,26,'#367e73'),
  box(l+2,t+3,24,1,'#8db89a'),box(l+2,t+23,24,2,'#ba975e'),
  box(l+5,t+10,18,9,'#29434c'),label('R4',l+9,t+11,1,'#f4d594'),
  box(48,14,12,18,'#616b9a')
]});
const png = PNG.encode(width,height,image.data,4);
write('atlas.png',png);
const vertices = [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]].map((position,i)=>({id:'v'+i,position}));
const corners = [[l,t+h-1],[l+w-1,t+h-1],[l+w-1,t],[l,t]].map(([x,y],i)=>
  ({id:'c'+i,vertex:'v'+i,uv:[x/(width-1),y/(height-1)]}));
const document = T.create({id:'relay',vertices,faces:[{id:'plate',material:'enamel',corners}]});
const scene = {id:'relay-gutters',style:'slate',solids:[],
  tilesets:{atlas:ink.readTilesetImage(png)},
  camera:{target:[0,0,0],dist:8,yaw:.23,pitch:.14,projection:'orthographic',sway:0},
  topologyMeshes:{relay:{document,materials:[{id:'enamel',texture:{tileset:'atlas'},mipmaps:true}]}}};
json('relay.json',scene);
const writable = [[0,0,48,height]], padding = 8;
json('gutters.json',{tileset:'atlas',padding,writable,regions:[{id:'plate',rect}]});
const views = [6,10,16,24,42,54].map((dist,i)=>({t:i/12,camera:{dist,yaw:.46+i*.08,pitch:.26}}));
json('motion.json',{object:'relay',face:'plate',rect,inset:{left:3,right:3,top:3,bottom:3},
  padding,writable,w:112,h:90,views});
const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
run(['tileset','gutters','gutters.json','--scene','relay.json','--out','padded.json'],'gutter-receipt.json');
run(['tileset','bleed-review','motion.json','--scene','relay.json','--out','motion'],'motion-receipt.json');
const report = read('motion-receipt.json');
const {baseline,inset,gutter} = report.summary;
assert(report.inset.uvEdits>0 && report.inset.paintWrites===0);
assert(report.gutter.writtenTexels>0 && report.gutter.uvEdits===0);
assert.equal(read('padded.json').topologyMeshes.relay.document.id,document.id);
assert.deepEqual(read('padded.json').topologyMeshes.relay.document,document);
assert(baseline.affectedPixels>0 && inset.affectedPixels<baseline.affectedPixels && gutter.affectedPixels<baseline.affectedPixels,
  JSON.stringify(report.summary));

const diagnostics = PNG.raster(file('motion/bleed.png'));
const originals = ['motion/atlas-original.png','motion/atlas-gutter.png'].map(name=>PNG.raster(file(name)));
const lanes = ['BASELINE','UV INSET','GUTTER'];
const W=526,H=464, x=i=>22+i*168;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  box(0,0,W,H,'#182b36'),label('INK STUDIO / TILESET SAMPLING',22,15,2,'#a8c9c0'),
  label('Inset or painted gutter?',22,41,3),
  ...lanes.flatMap((name,i)=>[label(name,x(i),86,2),label([baseline,inset,gutter][i].affectedPixels+
    ' AFFECTED PIXELS',x(i),104,1,i ? '#a9cbc3' : '#f2a6c0')]),
  label('TWO MOTION SAMPLES / 4X DETAIL',22,124,1,'#a8c9c0'),
  label('FRAME 4',22,139,1,'#a8c9c0'),label('FRAME 6',22,235,1,'#a8c9c0'),
  label('ORIGINAL ATLAS',22,335,1,'#a8c9c0'),label('PAINTED ATLAS',188,335,1,'#a8c9c0'),
  label('PINK = COLOR MISMATCH',354,353,1,'#f2a6c0'),
  label(report.gutter.writtenTexels+' GUTTER TEXELS',354,379,1),
  label(report.inset.uvEdits+' INSET UV CORNERS',354,398,1)
]});
function blit(src,sx,sy,w,h,left,top,scale=1) {
  for (let y=0;y<h*scale;y++) for (let x=0;x<w*scale;x++) {
    const i=((sy+Math.floor(y/scale))*src.w+sx+Math.floor(x/scale))*4;
    board.data.set(src.data.subarray(i,i+4),((top+y)*W+left+x)*4);
  }
}
const [fw,fh] = report.grid;
for (const [row,index] of [3,5].entries()) for (let lane=0;lane<lanes.length;lane++)
  blit(diagnostics,lane*fw+fw/2-17,index*fh+fh/2-10,34,20,x(lane),150+row*97,4);
originals.forEach((atlas,i)=>blit(atlas,0,0,width,height,22+i*166,352,2));
write('UV-gutter-motion.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Compare a UV inset with painted gutters

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to recreate the
padded scene and the camera-motion review.

Pink marks a base-paint mismatch against the isolated chart. The
camera samples include an orbit and a zoom into minification.
The inset changes corner coordinates. The gutter writes atlas
pixels while retaining those coordinates.
`);
