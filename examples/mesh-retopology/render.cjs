'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), PNG=require('../../cli/png.js'), R=require('../../cli/render.js');
const fixture=require('./fixture.cjs');

async function run(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const out=name=>path.join(directory,name);
  const write=(name,value)=>fs.writeFileSync(out(name),JSON.stringify(value,null,2)+'\n');
  const {meshTopology:api}=ink.load().KIT;
  const reference=fixture.meshProxy(api);
  const capture=fixture.capture(), scan=await ink.scanToMesh(capture,{meshStride:1,residualLimit:0,name:'Synthetic shoulder scan'});
  write('mesh-reference.json',reference);
  write('scan-input.json',capture);
  write('scan-capture-report.json',scan.report);
  fs.writeFileSync(out('scan-reference.glb'),scan.glb);
  const kinds=['mesh','sdf','scan-proxy'];
  for (const kind of kinds) {
    const source=fixture.rim(kind), request=fixture.request(api,kind,source);
    const materials=[{id:'shell',color:kind==='mesh' ? 0x4c9a8a : kind==='sdf' ? 0xbd7762 : 0x628ab3},
      {id:'belt',color:0x6a5c50},{id:'clasp',color:0xdba763},{id:'reference',color:0x61959b}];
    const camera={target:[0,-.14,fixture.surfaceZ(kind,0,0)-.05],yaw:.32,pitch:.24,dist:3.38,ortho:true};
    write(kind+'-before.json',source);
    write(kind+'-request.json',request);
    write(kind+'-view.json',{w:136,h:104,camera,materials});
    const file=kind==='mesh' ? 'mesh-reference.json' : kind==='scan-proxy' ? 'scan-reference.glb' : undefined;
    const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
    execFileSync(process.execPath,[cli,'mesh-topology','retopology',out(kind+'-before.json'),out(kind+'-request.json'),
      '--view',out(kind+'-view.json'),'--preview',out(kind),'--report',out(kind+'-report.json'),
      '--out',out(kind+'-after.json'),...(file ? ['--surface',out(file)] : [])],{stdio:'inherit'});
  }
  const views=['result','guides'].flatMap(name=>kinds.map(kind=>PNG.read(out(kind+'/'+name+'.png'))));
  const comparison=R.grid(views,3,['01','02','03','04','05','06']);
  PNG.write(out('comparison.png'),comparison.w,comparison.h,comparison.rgb);
}

run(path.resolve(process.argv[2] ?? 'studio/out/mesh-retopology')).catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
