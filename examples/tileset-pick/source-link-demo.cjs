'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {atlas} = require('../gatehouse-revision/portal.cjs');

const directory = path.resolve(process.argv[2] ?? 'tileset-source-link-demo');
fs.mkdirSync(directory,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(directory,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const commands = [];
function studio(args, {report,log,blocked=false} = {}) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : '')+(log ? ' 2> '+log : ''));
  if (blocked) commands[commands.length-1] = 'if '+commands.at(-1)+'; then exit 1; else test "$?" -eq 1; fi';
  const run = spawnSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
  assert.equal(run.status,blocked ? 1 : 0,run.stderr);
  if (log) write(log,run.stderr);
  if (!report) return run;
  write(report,run.stdout);
  return JSON.parse(run.stdout);
}

const {width,pixels} = atlas(), w=16, h=8, brick = new Uint8Array(w*h*4);
for (let y=0;y<h;y++) {
  const at = ((24+y)*width+24)*4;
  brick.set(pixels.subarray(at,at+w*4),y*w*4);
}
const incoming = brick.slice(), local = brick.slice();
for (let y=1;y<=5;y++) for (let x=1;x<=8;x++) {
  const at = (y*w+x)*4;
  incoming.set([Math.round(brick[at]*.68),brick[at+1]+34,brick[at+2]+49,255],at);
}
for (const [x,y] of [[10,2],[11,2],[12,2],[13,2],[11,3],[12,3],[13,4],[14,4],[12,5],[13,5]]) {
  const at=(y*w+x)*4;
  local.set(y === 2 ? [255,206,128,255] : [225,155,90,255],at);
}
const encode = data=>PNG.encode(w,h,data,4);
write('source-original.png',encode(brick));
write('source-incoming.png',encode(incoming));
write('local-paint.png',encode(local));
function source(name) {
  commands.push('cp '+name+' paint.png');
  fs.copyFileSync(file(name),file('paint.png'));
}

const vertices = [], faces = [];
for (let row=0;row<3;row++) for (let column=0;column<4;column++) {
  const x = column+(row%2)*.5, y = row*.5, id = 'brick-'+row+'-'+column;
  const positions = [[x,y,0],[x+1,y,0],[x+1,y+.5,0],[x,y+.5,0]];
  const uvs = [[0,1],[1,1],[1,0],[0,0]];
  const corners = positions.map((position,i)=>{
    const vertex = id+'-v'+i;
    vertices.push({id:vertex,position});
    return {id:id+'-uv'+i,vertex,uv:uvs[i]};
  });
  faces.push({id,material:'masonry',corners});
}
json('original.json',{id:'linked-masonry',style:'slate',solids:[],
  tilesets:{brick:{...ink.readTilesetImage(encode(brick)),tileSize:{width:w,height:h}}},
  topologyMeshes:{wall:{document:{id:'wall',vertices,faces},
    materials:[{id:'masonry',texture:{tileset:'brick'}}]}}});

source('source-original.png');
const edit = (type, scene, ...args)=>['tileset',type,'--scene',scene+'.json','--id','brick',...args];
studio(edit('link','original','paint.png','--out','manual.json'),{report:'manual-link.json'});
studio(edit('link','original','paint.png','--refresh','on-load','--out','auto.json'),{report:'automatic-link.json'});
source('source-incoming.png');
const review = studio(edit('reload','manual'),{report:'external-review.json'});
assert.equal(review.diff.changed,40);
assert.equal(review.localPaint,false);
studio(edit('reload','manual','--expect',review.incoming.sha256,'--out','accepted.json'),{report:'accepted-review.json'});
studio(edit('replace','auto','local-paint.png','--out','local.json'),{report:'local-edit.json'});
const conflict = studio(edit('reload','local','--out','protected.json'),{report:'local-conflict.json',blocked:true});
assert.equal(conflict.localPaint,true);
assert.equal(conflict.blockers[0].reason,'local-paint');
assert.equal(fs.existsSync(file('protected.json')),false);
assert.equal(conflict.diff.changed,50);

function render(scene,log) {
  return studio(['render',scene+'.json','--w','154','--h','88','--px','1','--target','2.25,.75,0',
    '--zoom','3.15','--yaw','0','--pitch','0','--ortho','--raw','--out',scene+'-1x.png'],{log});
}
render('original');
render('manual');
assert.match(render('auto','auto-render.log').stderr,/refreshed in memory/);
render('accepted');
assert.match(render('local','local-render.log').stderr,/used embedded image \(local-paint\)/);
const bytes = name=>fs.readFileSync(file(name+'-1x.png'));
assert.deepEqual(bytes('original'),bytes('manual'));
assert.deepEqual(bytes('auto'),bytes('accepted'));
assert.notDeepEqual(bytes('local'),bytes('auto'));
assert.notDeepEqual(bytes('manual'),bytes('auto'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Linked tileset demo

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. The script switches
the external paint PNG and exercises both refresh modes. The blocked
reload writes only a review. The three gallery panels come from 1×
headless renders. The JSON reviews contain texel counts, bounds, sample
changes, raster fingerprints, and the reason local paint was held.
`);

const W=996,H=366, panels=[24,344,664];
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f7e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#101b24'),
  text('INK STUDIO / LINKED TILESET',24,20,2,'#9be1c4'),
  text('One wall. Three source decisions.',24,50,3),
  text('MANUAL',24,108,2),text('ON LOAD',344,108,2,'#9be1c4'),text('LOCAL PAINT HELD',664,108,2,'#ffc789'),
  ...panels.map(x=>rect(x-1,134,310,178,'#54707a')),
  text('Embedded revision stays visible.',24,331,1),
  text('40 updated texels load in memory.',344,331,1),
  text('Review flags 50 differing texels.',664,331,1)
]});
for (const [panel,name] of ['manual','auto','local'].entries()) {
  const {w,h,data} = PNG.raster(file(name+'-1x.png'));
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at = (Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((135+y)*W+panels[panel]+x)*4);
  }
}
write('Linked-tileset.png',PNG.encode(W,H,board.data,4));
