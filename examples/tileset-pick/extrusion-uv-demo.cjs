'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;

const dir = path.resolve(process.argv[2] ?? 'extrusion-uv-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,value)=>fs.writeFileSync(file(name),value);
const json = (name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f2e2c3')=>({type:'text',text,at:[x,y],scale,color});
function atlas(id,width,height,commands) {
  const {data} = art.render({width,height,edges:'hard',commands});
  const png = PNG.encode(width,height,data,4);
  write(id+'.png',png);
  return ink.readTilesetImage(png);
}

function masonry(width,height,block,course,grout,colors,rim) {
  const commands = [rect(0,0,width,height,grout)];
  for (let r=0;r<Math.ceil(height/course);r++) {
    for (let c=0;c<=Math.ceil(width/block);c++) {
      const x = c*block-(r%2)*Math.floor(block/2), y = r*course;
      const fill = colors[(c*7+r*11+c*r)%colors.length];
      commands.push(rect(x,y,block-1,course-1,fill),rect(x,y,block-1,1,rim));
      if (block>=10) commands.push(rect(x+3+(c+r)%4,y+3,3,1,grout));
    }
  }
  return commands;
}
const brick = masonry(96,80,12,8,'#725445',['#d09c6b','#bc8559','#c18d60','#ce925f','#d1a374'],'#e5ba81');
const stone = masonry(32,24,10,6,'#273e49',['#5c7883','#506a76','#678490','#59737e'],'#8aa3a2');
const scene = {id:'masonry-arch',style:'slate',solids:[],
  camera:{target:[0,.86,-.11],dist:4.2,yaw:-.54,pitch:-.13,projection:'orthographic',sway:0},
  tilesets:{brick:atlas('arch-brick',96,80,brick),stone:atlas('tunnel-stone',32,24,stone)}
};

const outline = [[-1.2,0],[-.73,0],[-.73,.91],[-.49,1.2],[.49,1.2],[.73,.91],[.73,0],
  [1.2,0],[1.2,1.21],[.81,1.7],[-.81,1.7],[-1.2,1.21]];
const vertices = outline.map(([x,y],i)=>({id:'v'+i,position:[x,y,0]}));
const front = {id:'front',material:'tileset/brick',corners:outline.map(([x,y],i)=>({id:'c'+i,vertex:'v'+i,
  uv:[(47.5+24*x)/95,(61-24*y)/79]}))};
const doc = T.create({id:'arch',vertices,faces:[front]});
scene.topologyMeshes = {arch:{document:doc,materials:[{id:front.material,texture:{tileset:'brick'}}]}};
json('before.json',scene);
const boundaries = T.inspect(doc).edges;
const edges = Array.from({length:5},(_,i)=>boundaries
  .find(edge=>edge.vertices.includes('v'+(i+1)) && edge.vertices.includes('v'+(i+2))).id);
const selection = T.select(doc,{domain:'edges',ids:edges});
const brush = ink.pickTilesetRectangle(scene,'stone',{x:1,y:1,width:30,height:22});
const request = {id:'arch-reveal',revision:T.revision(doc),
  operation:{kind:'extrude-edge',selection,direction:[0,0,-1],distance:.5,strict:true}};
json('extend-request.json',{...request,operation:{...request.operation,uv:'extend'}});
json('brush-request.json',{...request,operation:{...request.operation,uv:'brush',brush:{selection:brush},
  material:'tunnel-stone'}});

const commands = [], plans = {};
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const mode of ['extend','brush']) {
  const args = ['mesh-topology','edge-edit','before.json',mode+'-request.json','--object','arch'];
  run(args,mode+'-preview.json');
  run(args.concat('--out',mode+'.json','--report',mode+'-receipt.json'));
  const {report} = read(mode+'-preview.json'), after = read(mode+'.json').topologyMeshes.arch;
  assert(report.canCommit,JSON.stringify(report.issues));
  assert.deepEqual(read(mode+'-receipt.json').edgeEdit,report);
  assert.deepEqual(after.document.faces[0],doc.faces[0]);
  assert.equal(report.detail.sidewallUVs.faces.length,5);
  plans[mode] = after;
}
assert.deepEqual(plans.extend.document.vertices,plans.brush.document.vertices);
assert(plans.extend.document.faces.every(face=>face.material===front.material));
assert.equal(plans.brush.bindings.length,5);
assert(plans.brush.bindings.every(binding=>binding.data.selection.tileset==='stone'));

const w = 152, h = 100, zoom = 2, W = 980, H = 341, y = 112;
const cases = [
  ['before','Painted arch','FLAT FRONT','#abc1bf'],
  ['extend','Extend mapping','BRICK CONTINUES AROUND THE FOLD','#efb67f'],
  ['brush','Separate brush','TUNNEL STONE ON THE NEW FACES','#98bdcb']
];
const renders = cases.map(([id])=>{
  const name = id+'-1x.png';
  run(['render',id+'.json','--w',w,'--h',h,'--px','1','--ortho','--raw','--out',name]);
  return PNG.raster(file(name)).data;
});
assert.notDeepEqual(renders[0],renders[1]);
assert.notDeepEqual(renders[1],renders[2]);

const panelX = i=>16+i*322;
const board = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#18282f'),text('INK STUDIO / TILE MODELING',16,16,2,'#abc1bf'),
  text('Choose the UV source for an extrusion',16,42,3),
  ...cases.flatMap(([id,title,note,color],i)=>[
    text(title,panelX(i),86,2),rect(panelX(i)-1,y-1,w*zoom+2,h*zoom+2,'#47616a'),
    text(note,panelX(i),323,1,color)
  ])
]});
for (const [i,data] of renders.entries()) for (let row=0;row<h*zoom;row++) for (let column=0;column<w*zoom;column++) {
  const at = (Math.floor(row/zoom)*w+Math.floor(column/zoom))*4;
  board.data.set(data.subarray(at,at+4),((y+row)*W+panelX(i)+column)*4);
}
write('Extrusion-uv-sources.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Extrusion UV sources

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the previews, receipts, scene files and native renders.

Both requests extrude the five inside edges of the painted arch by
0.5 units. Extend continues the brick mapping through that fold.
Brush stamps the selected tunnel stone on each new face. Both retain
the original painted face and produce identical geometry.
`);
