'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');

const dir = path.resolve(process.argv[2] ?? 'plane-alignment-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const kit = ink.load(), { KIT: K } = kit, T=K.meshTopology, art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f5ebd8')=>({type:'text',text,at:[x,y],scale,color});
const line=(points,color,width)=>({type:'path',points,color,width});
const guide='#e9b876', faint='#a7bfc1';
const datum = -.13;
const panels = [
  {id:'mint',points:[[-1.42,.14,-.53],[-.48,.14,-.22],[-.89,1.16,.40]],pigment:'#579683',light:'#bfe49e',shadow:'#203f47'},
  {id:'rose',points:[[.44,.14,.04],[1.38,.14,.35],[.91,1.16,.83]],pigment:'#a26365',light:'#f5c49a',shadow:'#472f48'}
];
const document=T.create({id:'trim-plates',vertices:panels.flatMap(({id,points})=>points.map((position,i)=>({id:id+'/'+i,position}))),
  faces:panels.map(({id},i)=>({id,corners:[[0,1],[1,1],[.5,0]].map(([u,v],j)=>({
    id:id+'/corner/'+j,vertex:id+'/'+j,uv:[(i*32+.5+31*u)/64,(.5+31*v)/32]
  }))}))});
const texture=art.render({width:64,height:32,edges:'hard',commands:panels.flatMap(({pigment,light,shadow},i)=>{
  const x=i*32;
  return [rect(x,0,32,32,pigment),rect(x,18,32,4,shadow),rect(x,18,32,1,light),rect(x,28,32,4,shadow),
    rect(x,28,32,1,light),rect(x+15,5,2,10,shadow),rect(x+11,9,10,2,light),rect(x+15,8,2,4,light),
    ...[5,10,15,20,25].map(l=>rect(x+l,24,2,2,light))];
})});
const paint=PNG.encode(64,32,texture.data,4);
const scene={id:'alignment-bench',style:'slate',solids:[],constructionPlane:{origin:[0,0,datum]},
  camera:{target:[0,.61,datum],dist:3.2,yaw:.66,pitch:.28,projection:'orthographic',sway:0},
  tilesets:{markings:ink.readTilesetImage(paint)},
  topologyMeshes:{plates:{document,materials:[{id:'default',texture:{tileset:'markings'}}]}}};
json('original.json',scene);
write('paint.png',paint);
const faces=T.select(document,{domain:'faces'});
const tips=T.select(document,{domain:'vertices',ids:['mint/2','rose/2']});
const cases=[
  ['original','Original','The painted plates span both sides.'],
  ['near','Align near','The nearest extent touches the plane.',{kind:'align',side:'near'}],
  ['center','Align center','The mid-depth lands on the plane.',{kind:'align',side:'center'}],
  ['far','Align far','The farthest extent touches the plane.',{kind:'align',side:'far'}],
  ['flatten','Flatten','All six vertices lie on the plane.',{kind:'flatten'}],
  ['collapse','Collapse tips','The two tips meet at one point.',{kind:'collapse',point:[0,1.22,datum]}]
];
const view={w:154,h:85,px:1,raw:true,ortho:true}, commands=[];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const [id,,,operation] of cases) {
  if (operation) {
    json(id+'-request.json',{operation,selection:id==='collapse' ? tips : faces});
    const args=['mesh-topology','transform','original.json',id+'-request.json','--object','plates'];
    run(args,id+'-preview.json');
    run([...args,'--out',id+'.json','--report',id+'-receipt.json']);
    const evidence=read(id+'-receipt.json').transform;
    assert.deepEqual(evidence,read(id+'-preview.json').report);
    assert.deepEqual(evidence.operation.removedFaces,[]);
    const resolved=evidence.operation.after;
    const error=id==='collapse' ? evidence.operation.maxError :
      id==='flatten' ? Math.max(Math.abs(resolved.near),Math.abs(resolved.far)) : Math.abs(resolved[id]);
    assert(error<1e-8);
    if (operation.kind==='align') assert(Math.abs(evidence.operation.before[id])>.1);
  }
  run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
}

let camera,focal;
render(ink.createSceneEditor(scene).build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose=kit.CameraLens.fromView(camera.view), zoom=2, W=992,H=599;
const slots=cases.map((_,i)=>[20+i%3*322,112+Math.floor(i/3)*235]);
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#18252e'),label('INK STUDIO / MESH TRANSFORMS',20,15,2,faint),
  label('Set the depth of painted plates',20,42,3),
  ...cases.flatMap(([,title,note],i)=>{
    const [x,y]=slots[i];
    return [label(title,x,y-20,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#4d6870'),
      label(note,x,y+view.h*zoom+10,1,faint)];
  }),
  label('GOLD / WORKING PLANE',20,582,1,guide),
  label('BARS / SIGNED DEPTH ALONG THE PLANE NORMAL',342,582,1,faint)
]});
const marks=[];
for (const [i,[x,y]] of slots.entries()) {
  const [id]=cases[i], {w,h,data}=PNG.raster(file(id+'-1x.png'));
  for (let row=0;row<h*zoom;row++) for (let col=0;col<w*zoom;col++) {
    const at=(Math.floor(row/zoom)*w+Math.floor(col/zoom))*4;
    board.data.set(data.subarray(at,at+4),((y+row)*W+x+col)*4);
  }
  const project = point => {
    const at=K.V.sub(point,pose.eye);
    return [x+w+zoom*focal*K.V.dot(at,pose.right),y+h-zoom*focal*K.V.dot(at,pose.up)];
  };
  marks.push(line([project([-1.62,.07,datum]),project([1.62,.07,datum])],guide,2));
  const doc=read(id+'.json').topologyMeshes.plates.document;
  const depths=doc.vertices.filter(({id:vertex})=>id!=='collapse' || vertex.endsWith('/2')).map(({position})=>position[2]-datum);
  const zero=x+view.w, scale=88, bar=y+view.h*zoom+28;
  const min=Math.round(zero+scale*Math.min(...depths)), max=Math.round(zero+scale*Math.max(...depths));
  marks.push(rect(zero-124,bar,249,1,'#4d6870'),rect(min,bar-2,Math.max(1,max-min+1),5,'#92cdc0'),
    rect(zero,bar-4,1,9,guide));
  if (id==='collapse') {
    const [u,v]=project([0,1.22,datum]).map(Math.round);
    marks.push(rect(u-4,v-4,9,9,'#18252e'),rect(u-3,v-3,7,7,guide),rect(u-1,v-1,3,3,'#18252e'));
  }
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Mesh-plane-alignment.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Set the depth of painted plates

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to reproduce the
native-resolution renders, previews, and committed receipts.

Near, center, and far each move the two plates by one offset along the
working plane normal. Flatten projects all six vertices onto the plane.
Collapse sends the two selected tips to a single point. Each plate
keeps its authored face and paint. The gold line on the board marks the
working plane. The measure below each capture shows the signed depth
range, with a gold tick at zero. In the collapse panel it measures
only the two selected tips.
`);
