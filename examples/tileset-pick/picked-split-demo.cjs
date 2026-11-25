'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {render,cameraCapture} = require('../../cli/render.js');
const kit = ink.load(), {KIT:K} = kit, T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'picked-split-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#faecd3')=>({type:'text',text,at:[x,y],scale,color});
const line = (points,color,width=1)=>({type:'path',points,color,width});
const navy = '#1b2b34', mint = '#b0f1c6', amber = '#f9c786', slate = '#afc5c4';
const atlas = {width:64,height:42}, selection = {x:6,y:7,width:52,height:28};
const enamel = art.render({...atlas,edges:'hard',commands:[
  rect(0,0,64,42,'#23363e'),...Array.from({length:7},(_,i)=>rect(0,6*i,64,1,'#293e45')),
  rect(6,7,52,28,'#3a5354'),rect(7,8,50,26,'#788f7b'),rect(9,9,46,2,'#c9d3a4'),
  rect(9,14,46,11,'#314b50'),text('GATE 07',11,16,1,'#eee1aa'),
  ...[11,19,27,35,43,51].map(x=>rect(x,28,4,3,'#d3a271')),
  ...[[8,12],[54,12],[8,31],[54,31]].map(([x,y])=>rect(x,y,2,2,'#c9d3a4'))
]});
const atlasPNG = PNG.encode(atlas.width,atlas.height,enamel.data,4);
write('enamel-atlas.png',atlasPNG);
const scene = {id:'gate-number',style:'slate',solids:[],
  camera:{target:[0,.72,.05],dist:3.12,yaw:.23,pitch:.15,projection:'orthographic',sway:0},
  tilesets:{enamel:ink.readTilesetImage(atlasPNG)}};
const editor = ink.createSceneEditor(scene);
const crop = ink.pickTilesetRectangle(scene,'enamel',selection);
editor.placeTilesetFace({object:'sign',face:'panel',selection:crop,origin:[-1.28,.12,0],worldSize:[2.56,1.2]});
const doc = editor.meshTopology('sign').document;
json('sign.json',editor.snapshot());
json('request.json',{id:'gate-cut',revision:T.revision(doc),
  operation:{kind:'split-face',face:'panel',axis:'u',at:[.38,.58]}});

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
const repair = ['mesh-topology','edge-edit','sign.json','request.json','--object','sign'];
run(repair,'preview.json');
run(repair.concat('--out','split.json','--report','receipt.json'));
const preview = read('preview.json'), {cut,atlas:chart,children} = preview.report.detail;
assert(preview.report.canCommit);
assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
assert.equal(children.length,2);
assert(Math.abs(chart.pick[0]-25.38)<1e-9);
const [first,second] = chart.children.map(row=>row.selection);
assert(first.x+first.width>second.x);
for (const [i,id] of children.entries()) {
  const name = 'child-'+(i+1)+'-crop.json';
  run(['tileset','eyedrop','--scene','split.json','--object','sign','--face',id,'--out',name]);
  assert(read(name).canStamp);
}

const w = 155, h = 104, zoom = 2, W = 1018, H = 368, y = 111;
const view = {w,h,px:1,ortho:true,raw:true};
for (const id of ['sign','split']) run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
assert.deepEqual(fs.readFileSync(file('sign-1x.png')),fs.readFileSync(file('split-1x.png')));
commands.push('cmp sign-1x.png split-1x.png');

let camera, focal;
render(editor.build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width === w && raster.height === h) { camera = raster; focal = sample.focal; }
})});
assert(camera?.ortho);
const pose = kit.CameraLens.fromView(camera.view), xAt = i=>16+i*333;
const facePoint = (x,p)=>{
  const offset = K.V.sub(p,pose.eye);
  return [Math.round(x+w+zoom*focal*K.V.dot(offset,pose.right)),Math.round(y+h-zoom*focal*K.V.dot(offset,pose.up))];
};
const atlasZoom = 4, atlasAt = [xAt(1)+27,y+20];
const atlasPoint = ([u,v])=>[Math.round(atlasAt[0]+atlasZoom*(u+.5)),Math.round(atlasAt[1]+atlasZoom*(v+.5))];
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,navy),text('INK STUDIO / MESH TOPOLOGY',16,16,2,slate),
  text('Split a painted tile at a picked point',16,43,3),
  ...[
    ['Face preview','PICK AT U 0.38 / V 0.58',mint],
    ['Source atlas','CUT AT ATLAS X 25.38 TEXEL CENTERS',amber],
    ['Committed split','TWO EDITABLE QUADS / IDENTICAL 1X PAINT',mint]
  ].flatMap(([title,note,color],i)=>[
    text(title,xAt(i),87,2),rect(xAt(i)-1,y-1,w*zoom+2,h*zoom+2,'#506f74'),
    rect(xAt(i),y,w*zoom,h*zoom,'#14242a'),text(note,xAt(i),331,1,color)
  ])
]});
function place(image,w,h,x,y,scale) {
  for (let row=0;row<h*scale;row++) for (let col=0;col<w*scale;col++) {
    const at = (Math.floor(row/scale)*w+Math.floor(col/scale))*4;
    board.data.set(image.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
}
place(PNG.raster(file('sign-1x.png')).data,w,h,xAt(0),y,zoom);
place(enamel.data,atlas.width,atlas.height,...atlasAt,atlasZoom);
place(PNG.raster(file('split-1x.png')).data,w,h,xAt(2),y,zoom);

const mark = (points,pick,color)=>[
  line(points,navy,4),line(points,color,2),rect(pick[0]-3,pick[1]-3,7,7,navy),
  rect(pick[0]-2,pick[1]-2,5,5,color)
];
const outline = chart.outline.map(atlasPoint);
const left = cut.line.map(row=>facePoint(xAt(0),row.position));
const right = cut.line.map(row=>facePoint(xAt(2),row.position));
const annotations = art.render({width:W,height:H,edges:'hard',commands:[
  ...mark(left,facePoint(xAt(0),cut.pick.position),mint),
  line(outline.concat([outline[0]]),slate,1),...mark(chart.line.map(atlasPoint),atlasPoint(chart.pick),amber),
  line(right,navy,3),line(right,mint,1)
]}).data;
for (let i=0;i<annotations.length;i+=4) if (annotations[i+3]) board.data.set(annotations.subarray(i,i+4),i);
write('Picked-split.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Split a painted tile at a picked point

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the native renders, source picks, preview, and receipt.

The normalized face pick [0.38, 0.58] maps to atlas x = 25.38 in texel
centers. The same cut appears on the face and the atlas. The two
committed quads can be eyedropped independently, and the native
render matches the original byte for byte.
`);
