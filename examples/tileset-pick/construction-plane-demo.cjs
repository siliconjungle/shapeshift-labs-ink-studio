'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');

const dir = path.resolve(process.argv[2] ?? 'construction-plane-demo');
fs.mkdirSync(dir,{recursive:true});
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const read = name=>fs.readFileSync(file(name));
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const commands = [];
function studio(args,report) {
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (report) write(report,output);
  return output;
}

const width=40,height=20,pixels=new Uint8Array(width*height*4);
function paint(x,y,color) {
  pixels.set(color,(y*width+x)*4);
}
for (let y=0;y<16;y++) for (let x=0;x<24;x++) {
  const rim = x === 0 || y === 0 || x === 23 || y === 15;
  const lit = x === 1 || y === 1;
  const bar = y > 6 && y < 11 && (x > 4 && x < 11 || x > 13 && x < 20);
  paint(1+x,2+y,rim ? [30,58,63,255] : lit || bar ? [124,179,151,255] : [61,114,113,255]);
}
for (let y=0;y<12;y++) for (let x=0;x<12;x++) {
  const rim = x === 0 || y === 0 || x === 11 || y === 11;
  const stripe = (x+y)%4===0;
  paint(27+x,2+y,rim ? [108,64,43,255] : stripe ? [242,191,113,255] : [202,131,75,255]);
}
const image=ink.readTilesetImage(PNG.encode(width,height,pixels,4));
json('draft.json',{id:'plane-jig',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:16},tilesets:{paint:image}});
const first = JSON.parse(studio(['mesh-topology','plane','draft.json','--origin','.4,.65,-.2','--right','4,0,-3',
  '--grid','.25','--out','plane.json'],'plane-start.json'));
const stamp = (input,name,crop,out)=>JSON.parse(studio(['tileset','stamp','--scene',input,'--object','sign','--face',name,
  '--id','paint','--x',crop[0],'--y',crop[1],'--width',crop[2],'--height',crop[3],'--plane','0,0','--out',out],
name+'-stamp.json'));
const panel=stamp('plane.json','panel',[1,2,24,16],'panel.json');
assert.deepEqual(panel.vertices[0].position,first.after.origin);
const relocated = JSON.parse(studio(['mesh-topology','plane','panel.json','--origin','1.8,.65,-1.25',
  '--out','moved-plane.json'],'plane-relocated.json'));
const tab=stamp('moved-plane.json','tab',[27,2,12,12],'stamped.json');
assert.deepEqual(tab.vertices[0].position,relocated.after.origin);

json('tab-query.json',{domain:'faces',ids:['tab']});
json('rotate.json',{space:'plane',planePivot:[0,0],operation:{kind:'rotate',axis:[0,0,1],degrees:24}});
studio(['mesh-topology','select','stamped.json','tab-query.json','--object','sign','--out','tab-selection.json']);
const rotate=['mesh-topology','transform','stamped.json','rotate.json','--object','sign','--selection','tab-selection.json'];
const pivot = JSON.parse(studio(rotate,'pivot-preview.json'));
assert.deepEqual(pivot.report.worldPivot,tab.vertices[0].position);
studio([...rotate,'--out','pivoted.json','--report','pivot-commit.json']);
const align=['mesh-topology','move','pivoted.json','--object','sign','--vertex','tab/v2',
  '--by','.30,.30,.12','--space','plane','--align','grid'];
const moved=JSON.parse(studio(align,'align-preview.json'));
assert.deepEqual(moved.constructionPlane,relocated.after);
assert(moved.snap.gridAt.every(Number.isSafeInteger));
assert.deepEqual(JSON.parse(studio([...align,'--expect',moved.beforeRevision,'--out','aligned.json'],'align-commit.json')),moved);
const [before,after]=['stamped.json','aligned.json'].map(name=>JSON.parse(read(name)).topologyMeshes.sign);
assert.deepEqual(before.bindings,after.bindings);

const renders=['stamped','pivoted','aligned'];
for (const phase of renders) studio(['render',phase+'.json','--w','145','--h','99','--px','1','--ortho',
  '--target','1.3,1.13,-.8','--yaw','.57','--pitch','.12','--zoom','4','--raw','--out',phase+'-1x.png']);
assert.notDeepEqual(read('stamped-1x.png'),read('pivoted-1x.png'));
assert.notDeepEqual(read('pivoted-1x.png'),read('aligned-1x.png'));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\ncmp align-preview.json align-commit.json\n');
write('README.md',`# Shared construction plane

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH. It saves a
rotated plane, stamps the green panel, moves the plane origin, and
stamps the orange tab. It rotates the tab about the moved origin
and aligns its upper-right vertex to the same quarter-unit grid.
The JSON previews contain the plane, pivot, and alignment coordinates.
`);

const W=952,H=381, panels=[24,332,640];
const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f8e8d1')=>({type:'text',text,at:[x,y],scale,color});
const board = ink.load().KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#121c27'),
  text('INK STUDIO / CONSTRUCTION PLANE',24,20,2,'#a6e3cd'),
  text('A movable frame for painted geometry',24,52,3),
  text('STAMP',panels[0],111,2),
  text('PIVOT',panels[1],111,2,'#a6e3cd'),
  text('ALIGN',panels[2],111,2,'#ffc789'),
  ...panels.map(x=>rect(x-1,139,292,200,'#506d75')),
  text('TWO STAMPS / ORIGIN MOVED BETWEEN',panels[0],354,1),
  text('24 DEGREES ABOUT THE MOVED ORIGIN',panels[1],354,1,'#a6e3cd'),
  text('CORNER TO GRID '+moved.snap.gridAt.join(', '),panels[2],354,1,'#ffc789')
]});
for (const [index,phase] of renders.entries()) {
  const {w,h,data}=PNG.raster(file(phase+'-1x.png'));
  let visible=0;
  for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) visible++;
  assert(visible>850);
  for (let y=0;y<h*2;y++) for (let x=0;x<w*2;x++) {
    const at=(Math.floor(y/2)*w+Math.floor(x/2))*4;
    board.data.set(data.subarray(at,at+4),((140+y)*W+panels[index]+x)*4);
  }
}
write('Construction-plane.png',PNG.encode(W,H,board.data,4));
