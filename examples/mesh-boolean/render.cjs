'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..');
const PNG=require('../../cli/png.js');
const R=require('../../cli/render.js');
const {gauge}=require('./fixture.js');

const directory=path.resolve(process.argv[2] ?? 'studio/out/mesh-boolean');
const out=name=>path.join(directory,name);
fs.mkdirSync(directory,{recursive:true});
const write=(name,value)=>fs.writeFileSync(out(name),JSON.stringify(value,null,2)+'\n');
const {target,cutter}=gauge(), {meshTopology:api}=ink.load().KIT;
write('gauge.json',target);
write('cutter.json',cutter);
write('view.json',{w:152,h:104,camera:{target:[-.05,-.01,0],dist:5.35,yaw:.389,pitch:.32,ortho:true},materials:[
  {id:'celadon',color:0x529982},{id:'celadon-side',color:0x35685f},{id:'celadon-light',color:0x8abd9c},
  {id:'brass',color:0xe1b56a},{id:'brass-side',color:0xae7949},{id:'coral',color:0xd58167},{id:'coral-side',color:0x965c57},
  {id:'metal',color:0x687f9b},{id:'fresh-copper',color:0xe2a373}
]});
const stages=[
  {id:'union',operation:'union'},
  {id:'difference',operation:'difference',cutMaterial:'fresh-copper'},
  {id:'intersection',operation:'intersection'},
  {id:'fallback',operation:'difference',cutMaterial:'fresh-copper',solver:{kind:'sdf',cell:.19,probes:[
    {id:'right-fin',origin:[1.32,0,-1.8],direction:[0,0,1],distance:3.6},
    {id:'engraving-plate',origin:[-.95,.68,-1.8],direction:[0,0,1],distance:3.6},
    {id:'window-walls',origin:[-2.6,-.17,.13],direction:[1,0,0],distance:5.2}
  ]}}
];
for (const stage of stages) {
  const {id}=stage;
  write(id+'-request.json',{...stage,revision:api.revision(target),operand:{revision:api.revision(cutter)}});
  execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'mesh-topology','boolean',
    out('gauge.json'),out(id+'-request.json'),'--operand',out('cutter.json'),'--view',out('view.json'),
    '--preview',out(id),'--out',out(id+'-mesh.json'),'--report',out(id+'-report.json')],{stdio:'inherit'});
}
const read=name=>PNG.read(out(name+'.png'));
const views=['union/before','union/result','intersection/result','difference/result','fallback/result','fallback/difference'].map(read);
const comparison=R.grid(views,3,['01','02','03','04','05','06']);
PNG.write(out('comparison.png'),comparison.w,comparison.h,comparison.rgb);
