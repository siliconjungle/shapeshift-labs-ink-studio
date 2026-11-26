'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'), path=require('node:path');
const ink=require('../..'), PNG=require('../../cli/png.js'), {drawing2d}=ink.load().KIT.procedural;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color='#efdfbc')=>({type:'text',text,at:[x,y],scale,color});
const art=(width,height,commands)=>drawing2d.render({width,height,edges:'hard',commands});
const encode=image=>PNG.encode(image.width,image.height,image.data,4);

const brick=art(36,20,[
  rect(0,0,36,20,'#4d3e3d'),
  ...[[0,0,12,8,'#9f6550'],[13,0,10,8,'#b07957'],[24,0,12,8,'#846253'],
    [0,9,6,9,'#855d4c'],[7,9,18,9,'#9c6e52'],[26,9,10,9,'#a0634e']]
    .flatMap(([x,y,w,h,color])=>[rect(x,y,w,h,color),rect(x,y,w,1,'#c18c68'),rect(x,y+h-1,w,1,'#76544a')]),
  rect(3,3,4,1,'#ba8063'),rect(16,13,4,1,'#bd8664'),rect(29,5,4,1,'#6d514a')
]);
const pipe=art(10,32,[
  rect(0,0,10,32,'#243238'),rect(1,0,8,32,'#426367'),rect(2,0,1,32,'#91a99c'),
  rect(4,0,3,32,'#638680'),rect(7,0,1,32,'#325254'),
  ...[3,25].flatMap(y=>[rect(0,y,10,4,'#243238'),rect(0,y,10,1,'#a8b6a0'),rect(2,y+1,6,1,'#6b867b')])
]);
const lintel=art(8,6,[
  rect(0,0,8,6,'#415358'),rect(0,0,8,1,'#a6aa87'),rect(0,1,8,1,'#737d65'),rect(0,5,8,1,'#283c45')
]);
const scene={id:'pump-roof',style:'slate',solids:[],camera:{target:[0,0,0],dist:8,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:Object.fromEntries([['brick',brick],['pipe',pipe],['coping',lintel]].map(([id,image])=>[id,ink.readTilesetImage(encode(image))]))};
const editor=ink.createSceneEditor(scene);
function stamp(object,face,tile,origin,worldSize,part) {
  const {width,height}=scene.tilesets[tile];
  editor.placeTilesetFace({object,face,part,origin,worldSize,selection:ink.pickTilesetRectangle(scene,tile,{x:0,y:0,width,height})});
}
stamp('cistern-wall','straight-run','brick',[-3.45,-1.42,0],[6.9,2.84],'masonry');
editor.applyTilesetWrap({object:'cistern-wall',face:'straight-run',wrap:{u:'repeat',v:'repeat',repeats:[5,2]}});
stamp('ledge','top','coping',[-3.57,1.38,.05],[7.14,.23]);
stamp('ledge','base','coping',[-3.57,-1.60,.05],[7.14,.23]);
stamp('water-pipe','front','pipe',[.42,-1.65,.24],[.40,3.3]);

const artwork={
  stain:art(32,32,[rect(8,0,16,3,'#575747'),rect(6,3,20,8,'#655547'),rect(7,11,14,11,'#6a5147'),
    rect(11,22,8,6,'#554f46'),rect(12,27,4,5,'#6b5e45'),rect(20,13,4,7,'#605746'),rect(10,8,8,5,'#565b47')]),
  repair:art(22,19,[rect(2,0,18,19,'#493d37'),rect(0,2,22,14,'#493d37'),rect(2,2,18,15,'#878374'),
    rect(2,2,18,2,'#aca18a'),rect(7,5,2,9,'#6f6b61'),rect(10,11,8,1,'#5d5e56'),rect(3,15,15,1,'#71695f')]),
  sign:art(56,24,[
    rect(1,0,54,24,'#343333'),rect(0,1,56,22,'#343333'),rect(2,2,52,20,'#bd9355'),
    rect(3,3,50,1,'#ead392'),rect(3,5,50,15,'#263b43'),rect(4,18,48,1,'#4e5e56'),
    text('PUMP 04',8,7,1,'#f1daa2'),rect(8,16,35,1,'#a77f52'),rect(5,6,1,1,'#efd693'),rect(49,17,1,1,'#efd693')
  ]),
  contact:art(17,12,[rect(0,0,17,12,'#995c43'),rect(1,1,15,10,'#bb7955')])
};

const out=path.resolve(process.argv[2] ?? 'wrapped-surface-decals-demo'), cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const file=name=>path.join(out,name), write=(name,data)=>fs.writeFileSync(file(name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n'), commands=[];
const view={w:224,h:114,t:1,raw:true};
fs.mkdirSync(out,{recursive:true});
json('wall.json',editor.snapshot());
json('view.json',view);
function run(args,receipt) {
  commands.push('ink-studio '+args.join(' ')+(receipt ? ' > '+receipt : ''));
  const stdout=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  if (receipt) {
    write(receipt,stdout);
    return JSON.parse(stdout);
  }
}
function place(source,id,kind,at,size,bias,opacity=1) {
  const destination=id+'.json';
  const anchor={object:'cistern-wall',part:'masonry',face:'straight-run',at,normal:[0,0,1],size,depth:.12,bias};
  json(id+'-request.json',{id,kind,anchor,grid:[24,16],opacity});
  write(id+'-ink.png',encode(artwork[id]));
  const args=['tileset','decal',id+'-request.json','--scene',source,'--image',id+'-ink.png'];
  const review=run([...args,'--preview',id+'-review','--view','view.json'],id+'-receipt.json');
  assert(review.canCommit && review.native.counts.projected>0);
  if (id==='sign') assert(review.native.blockers.some(row=>row.object==='water-pipe' && row.occluded>0));
  if (id==='contact') assert(review.native.counts.nearCoplanar>0 && review.native.counts.visible===0);
  run([...args,'--expect',id+'-receipt.json','--out',destination],id+'-commit.json');
  return destination;
}
const stained=place('wall.json','stain','scuff',[-1.37,.02,0],[1.88,2.65],.004,.6);
const repaired=place(stained,'repair','paint',[-2.40,-.5,0],[1.05,.8],.008);
const signed=place(repaired,'sign','lettering',[-.24,.35,0],[2.76,1.12],.014);
place(signed,'contact','scuff',[-.42,.34,0],[.82,.51],.014);

write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md','# Named decals over repeated bricks\n\nRun `sh COMMANDS.sh` with Ink Studio on your PATH.\n\n'+
  'Stain, repair and lettering are separate layers on straight-run.\n'+
  'Orange identifies the foreground pipe. Gold marks the deliberate depth tie.\n');

const w=989,h=245, xs=[20,258,496,734], titles=['WALL','LAYERED DECALS','FOREGROUND DEPTH','SAME-DEPTH TEST'];
const contact=art(w,h,[rect(0,0,w,h,'#182b33'),text('INK STUDIO / RETAINED DECALS',20,14,2,'#a0c1ab'),
  text('Pump house',20,41,3),...titles.map((label,i)=>text(label,xs[i],84,2)),
  rect(497,226,8,8,'#ed8357'),text('OCCLUDED BY PIPE',510,226,1,'#ed8357'),
  rect(735,226,8,8,'#efcd72'),text('COPLANAR WITH LABEL',748,226,1,'#efcd72')]);
const names=['stain-review/before.png','sign-review/after.png','sign-review/depth-conflicts.png','contact-review/depth-conflicts.png'];
for(const [i,name] of names.entries()){
  const frame=PNG.raster(file(name));
  assert.deepEqual([frame.w,frame.h],[view.w,view.h]);
  for(let y=0;y<frame.h;y++)for(let x=0;x<frame.w;x++){
    const at=4*(y*frame.w+x);
    contact.data.set(frame.data.subarray(at,at+4),4*((105+y)*w+xs[i]+x));
  }
}
write('Wrapped-surface-decals.png',encode(contact));
