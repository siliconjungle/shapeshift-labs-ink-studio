'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'quad-straighten-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const line = (a,b,color,width=1)=>({type:'path',points:[a,b],color,width});
const navy = '#1b2b34', mint = '#a9d9bd', amber = '#eab980', slate = '#aec3c3';
function tile(name,mark,colors) {
  const [shade,body,trim,light] = colors;
  const paint = art.render({width:34,height:32,edges:'hard',commands:[
    rect(0,0,34,32,shade),rect(2,2,30,28,body),rect(3,3,28,2,light),
    rect(4,9,26,11,shade),text(mark,5,11,1,light),
    ...[6,13,20,27].map(x=>rect(x,24,4,2,trim)),
    ...[[3,6],[29,6],[3,27],[29,27]].map(([x,y])=>rect(x,y,2,2,light))
  ]});
  const png = PNG.encode(34,32,paint.data,4);
  write(name+'.png',png);
  return ink.readTilesetImage(png);
}

const source = {id:'service-vent',style:'slate',solids:[],
  camera:{target:[0,.64,.24],dist:3.28,yaw:.51,pitch:.43,projection:'orthographic',sway:0},
  tilesets:{brace:tile('brace-atlas','RAIL',['#28464c','#5b8984','#3d6969','#b2d2b6']),
    cover:tile('cover-atlas','VENT',['#583f46','#a86e56','#d0a16b','#f0d09d'])}};
const editor = ink.createSceneEditor(source);
const pick = tileset=>ink.pickTilesetRectangle(source,tileset,{x:0,y:0,width:34,height:32});
editor.placeTilesetFace({object:'panel',face:'brace',selection:pick('brace'),worldSize:[1.35,1.25],origin:[-1.35,0,0]});
const base = editor.meshTopology('panel').document;
const hinge = T.inspect(base).edges.find(row=>row.vertices.every(id=>['brace/v1','brace/v2'].includes(id)));
editor.growTilesetFace({object:'panel',face:'cover',edge:hinge.id,selection:pick('cover'),depth:1.35,paint:{rotation:270}});
const bridge = editor.meshTopology('panel').document, cover = bridge.faces.find(face=>face.id === 'cover');
editor.editMeshTopology('panel',{vertices:[
  {id:'cover/v2',position:[1.35,0,.19]},{id:'cover/v3',position:[1.35,1.25,.78]}
],faces:[{...cover,diagonal:['cover/c0','cover/c2']}]});
const original = editor.snapshot(), doc = original.topologyMeshes.panel.document;
json('warped.json',original);
const request = guide=>({revision:T.revision(doc),operations:[{kind:'straighten-quad',faces:['cover'],...guide}]});
json('neighbor-request.json',request({neighbor:'brace'}));
json('plane-request.json',request({plane:{origin:[0,0,0],normal:[-.29,0,1]}}));

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const id of ['neighbor','plane']) {
  const args = ['mesh-topology','repair','warped.json',id+'-request.json','--object','panel'];
  run(args,id+'-preview.json');
  run(args.concat('--out',id+'.json','--report',id+'-receipt.json'));
  const preview = read(id+'-preview.json'), step = preview.report.steps[0];
  assert.deepEqual(read(id+'-receipt.json').repair,preview.report);
  assert(step.faces[0].maxBefore>.26 && step.faces[0].maxAfter<1e-12);
  assert.equal(step.faces[0].corners.filter(row=>row.moved).length,2);
  const row = read(id+'.json').topologyMeshes.panel;
  assert.deepEqual(row.bindings,original.topologyMeshes.panel.bindings);
  assert.deepEqual(row.document.faces,doc.faces);
}

const w = 154, h = 101, zoom = 2, W = 1010, H = 452, y = 110;
const views = [
  ['warped','Warped cover','TWO OUTER CORNERS OFF THE BRACE PLANE',amber],
  ['neighbor','Match the brace','SHARED EDGE STAYS FIXED',mint],
  ['plane','Use a sloped plane','BOTH OUTER CORNERS LAND ON THE DATUM',mint]
];
for (const [id] of views)
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
const image = id=>fs.readFileSync(file(id+'-1x.png'));
assert.notDeepEqual(image('warped'),image('neighbor'));
assert.notDeepEqual(image('plane'),image('neighbor'));

const xAt = i=>16+i*333;
const guide = [0,0,0], moved = id=>read(id+'-preview.json').report.steps[0].faces[0].corners.filter(row=>row.moved);
const before = moved('neighbor').map(row=>row.before);
function profile(id,x) {
  const map = ([u,,z])=>[Math.round(x+126+75*u),Math.round(419-55*z)];
  const after = id === 'warped' ? before : moved(id).map(row=>row.after);
  const paths = [line(map([-1.34,0,0]),map(guide),slate,2),...after.map(point=>line(map(guide),map(point),id === 'warped' ? amber : mint,1))];
  if (id !== 'warped') before.forEach((point,i)=>paths.push(line(map(point),map(after[i]),amber)));
  const dots = (points,color)=>points.map(point=>{
    const [u,v] = map(point);
    return rect(u-2,v-2,5,5,color);
  });
  return [...paths,...dots(before,amber),...dots(after,id === 'warped' ? amber : mint),...dots([guide],slate)];
}
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Straighten a warped painted cover',16,43,3),
  ...views.flatMap(([id,title,note,color],i)=>{
    const x = xAt(i);
    return [text(title,x,86,2),rect(x-1,y-1,w*zoom+2,h*zoom+2,'#55727b'),
      text(note,x,323,1,color),...profile(id,x)];
  }),
  text('X-Z SECTION',16,434,1,slate),text('ORIGINAL CORNERS',349,434,1,amber),text('PROJECTED CORNERS',682,434,1,mint)
]});
for (const [i,[id]] of views.entries()) {
  const {data} = PNG.raster(file(id+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at = (Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+xAt(i)+col)*4);
  }
}
write('Quad-straighten.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Straighten a warped painted cover

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to recreate the
native renders, proposals, and edit receipts.

The two free corners begin at different depths. One repair follows the
painted brace while keeping the hinge fixed. The second puts both
corners on an explicit sloped datum. The X-Z sections below the
renders show how the same original corners move in each repair.
`);
