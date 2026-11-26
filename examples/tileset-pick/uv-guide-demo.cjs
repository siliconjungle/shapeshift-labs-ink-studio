'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {KIT:K} = ink.load(), T = K.meshTopology, art = K.procedural.drawing2d;
const dir = path.resolve(process.argv[2] ?? 'uv-guide-demo'), cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name=>path.join(dir,name);
const write = (name,data)=>fs.writeFileSync(file(name),data);
const json = (name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const width = 72, height = 54, vertices = new Map(), faces = [];
function polygon(id,points) {
  faces.push({id,material:'enamel',corners:points.map(([x,y],i)=>{
    const vertex = 'v'+x+'-'+y;
    vertices.set(vertex,{id:vertex,position:[x/18,-y/18,0]});
    return {id:id+'/'+i,vertex,uv:[x/(width-1),y/(height-1)]};
  })});
}
const xs = [6,18,32,44], ys = [6,17,34,45];
for (let row=0;row<3;row++) for (let col=0;col<3;col++) {
  if (row===1 && col===1) continue;
  const [l,r] = xs.slice(col,col+2), [t,b] = ys.slice(row,row+2);
  polygon('ring-'+row+col,[[l,b],[r,b],[r,t],[l,t]]);
}
polygon('latch',[[49,16],[64,19],[66,12],[51,9]]);
polygon('finial',[[49,34],[57,42],[65,34],[57,26]]);
const document = T.create({id:'gate-panels',vertices:[...vertices.values()],faces});
json('gate.json',document);
const style = {atlas:[width,height],revision:T.revision(document),
  palette:{amber:'#f1d999',clay:'#a07462',mist:'#619999',tide:'#365b64'},outline:{swatch:'amber'}};
json('outline.json',style);
json('solid.json',{...style,fill:{mode:'solid',swatch:'clay'}});
json('checker.json',{...style,outline:{...style.outline,mode:'faces'},
  fill:{mode:'checker',swatches:['mist','tide'],size:4}});

const commands = [];
function run(args,stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const mode of ['outline','solid','checker']) {
  run(['mesh-uv','guide','gate.json',mode+'.json','--out',mode],mode+'-receipt.json');
  assert.deepEqual(read(mode+'-receipt.json'),read(mode+'/report.json'));
}
const guide = read('checker/guide.json'), pixels = ink.createPixelEditor(guide);
const patch = {id:'gate-paint',frame:'guide',revision:pixels.describe().revision,operation:{
  tool:'pencil',layer:'uv-fill',swatch:'amber',points:[[9,9],[13,9],[13,12]]
}};
json('paint.json',patch);
run(['pixel-art','edit','checker/guide.json','paint.json','--out','painted.json']);
run(['pixel-art','draw','painted.json','--out','painted']);
const png = PNG.raster(file('checker/guide.png'));
assert.equal(png.data[(24*width+23)*4+3],0);
assert(!fs.readFileSync(file('checker/guide.png')).equals(fs.readFileSync(file('painted/art.png'))));
assert.deepEqual(read('painted.json').frames[0].cels['uv-outline'],guide.frames[0].cels['uv-outline']);

const rect = (x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color='#f1e6cd')=>({type:'text',text,at:[x,y],scale,color});
const W=660,H=244, left=i=>16+i*160, modes = [
  ['OUTLINE','Chart boundaries','outline/guide.png'],
  ['SOLID','One fill swatch','solid/guide.png'],
  ['CHECKER','Atlas-aligned fill','checker/guide.png'],
  ['EDITED','Stroke on fill layer','painted/art.png']
];
const poster = art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#182b35'),text('INK STUDIO / MESH UV',16,16,2,'#a2c9c3'),
  text('Draw editable UV guides',16,43,3),
  ...modes.flatMap(([mode,caption],i)=>[text(mode,left(i),85,2),text(caption,left(i),102,1,'#bad2d2'),
    rect(left(i),119,2*width,2*height,'#0d202a')])
]});
for (const [i,[,,name]] of modes.entries()) {
  const image = PNG.raster(file(name));
  for (let y=0;y<height*2;y++) for (let x=0;x<width*2;x++) {
    const start = (Math.floor(y/2)*width+Math.floor(x/2))*4;
    if (image.data[start+3]) poster.data.set(image.data.subarray(start,start+4),((y+119)*W+left(i)+x)*4);
  }
}
write('UV-guide.png',PNG.encode(W,H,poster.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Draw editable UV guides

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce the
three native PNGs, their editable pixel documents and receipts, and
the edited checker guide.

The gate chart surrounds a transparent opening. The checker also
traces each authored face edge. The last example paints an amber stroke
on the fill layer, keeping the outline layer intact.
`);
