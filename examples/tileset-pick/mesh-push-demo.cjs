'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { render, cameraCapture } = require('../../cli/render.js');

const dir = path.resolve(process.argv[2] ?? 'push-review');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
fs.mkdirSync(dir,{recursive:true});

const kit=ink.load(), { KIT: K }=kit, T=K.meshTopology, art=K.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f5ebd8')=>({type:'text',text,at:[x,y],scale,color});
const line=(points,color,width)=>({type:'path',points,color,width});
const gold='#e8b773', muted='#afc5c8', green='#9cdbc2', rose='#e8aaba';
const runners=[
  {id:'a',x:[-1.42,-.32],z:0,stop:.62,body:'#448775',ink:'#c9e8b0',marker:green},
  {id:'b',x:[.20,1.30],z:.16,stop:1.17,body:'#956576',ink:'#edc2ad',marker:rose}
];
function quads(id, rows, painted) {
  const vertices=[], faces=[];
  for (const [i,{id,x,y,z}] of rows.entries()) {
    const positions=[[x[0],y[0],z],[x[1],y[0],z],[x[1],y[1],z],[x[0],y[1],z]];
    vertices.push(...positions.map((position,j)=>({id:id+'/'+j,position})));
    faces.push({id,corners:[[0,1],[1,1],[1,0],[0,0]].map(([u,v],j)=>({
      id:id+'/corner/'+j,vertex:id+'/'+j,uv:painted ? [(i*32+.5+31*u)/64,(.5+31*v)/32] : [u,v]
    }))});
  }
  return T.create({id,vertices,faces});
}
const document=quads('painted-plates',runners.map(row=>({...row,y:[.13,.96]})),true);
const stops=quads('narrow-stops',runners.map(({id,x,stop})=>{
  const mid=(x[0]+x[1])/2;
  return {id:id+'-stop',x:[mid-.045,mid+.045],y:[.04,1.13],z:stop};
}));
const atlas=art.render({width:64,height:32,edges:'hard',commands:runners.flatMap(({id,body,ink},i)=>{
  const x=i*32;
  return [rect(x,0,32,32,'#2a4044'),rect(x+1,1,30,30,body),rect(x+1,1,30,2,ink),
    rect(x+1,28,30,2,'#2a4044'),rect(x+7,7,18,17,'#263e49'),label(id.toUpperCase(),x+11,10,2,ink),
    rect(x+3,4,2,2,ink),rect(x+27,4,2,2,ink),rect(x+3,25,2,2,ink),rect(x+27,25,2,2,ink)];
})});
const paint=PNG.encode(64,32,atlas.data,4);
const scene={id:'fixture-bench',style:'slate',solids:[],
  camera:{target:[-.11,.57,.45],dist:3.3,yaw:.67,pitch:.27,projection:'orthographic',sway:0},
  tilesets:{plates:ink.readTilesetImage(paint)},topologyMeshes:{
    plates:{document,materials:[{id:'default',texture:{tileset:'plates'}}]},
    stops:{document:stops,materials:[{id:'default',color:0xe8b773}]}}};
json('original.json',scene);
write('paint.png',paint);

const selection=T.select(document,{domain:'faces'}), clearance=.04;
const cases=[
  ['original','Original','Both plates start short of their stops.'],
  ['individual','Push individually','Each plate stops at its own rail.'],
  ['assembly','Push as an assembly','A stops the assembly. B keeps its spacing.']
];
const view={w:156,h:99,px:1,raw:true,ortho:true}, commands=[];
function run(args, stdout) {
  commands.push('ink-studio '+args.join(' ')+' > '+(stdout ?? '/dev/null'));
  const output=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  if (stdout) write(stdout,output);
}
for (const [id] of cases) {
  if (id!=='original') {
    json(id+'-request.json',{selection,space:'world',
      operation:{kind:'push',mode:id,direction:[0,0,1],maxDistance:1.4,clearance,target:{object:'stops'}}});
    const args=['mesh-topology','transform','original.json',id+'-request.json','--object','plates'];
    run(args,id+'-preview.json');
    run([...args,'--out',id+'.json','--report',id+'-receipt.json']);
    const evidence=read(id+'-receipt.json').transform;
    assert.deepEqual(evidence,read(id+'-preview.json').report);
    const expected=id==='assembly' ? [.58] : [.58,.97];
    assert.equal(evidence.operation.groups.length,expected.length);
    for (const [i,row] of evidence.operation.groups.entries()) {
      assert(Math.abs(row.distance-expected[i])<1e-8);
      assert.equal(row.contact.source.domain,'faces');
      assert.equal(row.contact.target.id,runners[i].id+'-stop');
    }
  }
  run(['render',id+'.json','--w',view.w,'--h',view.h,'--px','1','--ortho','--raw','--out',id+'-1x.png']);
}

let camera,focal;
render(ink.createSceneEditor(scene).build(),{...view,...cameraCapture(null,(raster,sample)=>{
  if (raster.width===view.w && raster.height===view.h) { camera=raster; focal=sample.focal; }
})});
assert(camera?.ortho);
const pose=kit.CameraLens.fromView(camera.view), zoom=2, W=1008,H=445;
const slots=cases.map((_,i)=>[20+328*i,112]);
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#18252e'),label('INK STUDIO / MESH TRANSFORMS',20,16,2,muted),
  label('Fit painted plates to staggered stops',20,46,3),
  ...cases.flatMap(([,title,note],i)=>{
    const [x,y]=slots[i];
    return [label(title,x,y-21,2),rect(x-1,y-1,view.w*zoom+2,view.h*zoom+2,'#4d6870'),
      label(note,x,y+view.h*zoom+10,1,muted)];
  }),
  label('GOLD / STOP RAILS',20,428,1,gold),
  label('TRACKS / POSITION ALONG THE PUSH DIRECTION',348,428,1,muted)
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
  const mesh=read(id+'.json').topologyMeshes.plates.document, track=x+30, scale=175;
  for (const [j,runner] of runners.entries()) {
    const mid=(runner.x[0]+runner.x[1])/2, roof=project([mid,1.13,runner.stop]).map(Math.round);
    marks.push(line([roof,project([mid,.98,runner.stop])],gold,2),rect(roof[0]-3,roof[1]-2,7,4,gold));
    const depth=mesh.vertices.find(row=>row.id===runner.id+'/0').position[2], dy=y+view.h*zoom+42+j*28;
    const previous=Math.round(track+scale*runner.z), now=Math.round(track+scale*depth), stop=Math.round(track+scale*runner.stop);
    marks.push(label(runner.id.toUpperCase(),x,dy-3,1,runner.marker),rect(track,dy,231,1,'#4d6870'),
      rect(previous,dy-3,1,7,muted),rect(previous,dy-1,Math.max(1,now-previous+1),3,runner.marker),
      rect(stop,dy-5,1,11,gold),rect(now-2,dy-3,4,7,runner.marker),
      label('+'+(depth-runner.z).toFixed(2),x+264,dy-3,1,runner.marker));
  }
}
const overlay=art.render({width:W,height:H,edges:'hard',commands:marks}).data;
for (let i=0;i<overlay.length;i+=4) if (overlay[i+3]) board.data.set(overlay.subarray(i,i+4),i);
write('Mesh-push.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Fit painted plates to staggered stops

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH to regenerate
the three native-resolution renders and the previews and receipts.

Each narrow stop rail is inside the width of its plate, between
the paths of the plate's corner vertices. The swept face catches
the rail and stops with 0.04 world units of clearance. In individual
mode each plate travels to its own stop. In assembly mode the first
stop limits both plates. The tracks measure distance along the push
axis, with the gold ticks marking the stop rails.
`);
