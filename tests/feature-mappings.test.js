'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..');
const Pixel=require('../cli/pixel-art.js');
const Features=require('../cli/feature-mappings.js');
const {buildDemo,worldFor,capture,featureMapping,center}=require('../examples/feature-mappings.cjs');
const {KIT}=ink.load();
const close=(a,b)=>a.forEach((n,i)=>assert(Math.abs(n-b[i])<1e-6));

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-feature-rebind-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  buildDemo(directory);
  const file=name=>path.join(directory,name);
  const json=name=>JSON.parse(fs.readFileSync(file(name+'.json'),'utf8'));
  const write=(name,value)=>fs.writeFileSync(file(name),typeof value==='string' ? value : JSON.stringify(value));
  return {file,json,write,design:json('source-document'),graph:json('source-hierarchy'),decals:json('source-decals')};
}

test('named patches survive rebuilt face IDs, traced SDF, retained groups, stations and directly sampled cards',t=>{
  const f=fixture(t), document=f.json('rebound-document');
  for (const [site,kind] of [['rebuilt','mesh'],['sdf','sdf'],['splats','splat'],['curve','curve'],['card','sprite']]) {
    const report=f.json('review-'+site);
    assert(report.passed);
    assert.equal(report.rows.filter(row=>row.kind==='paint').length,4);
    assert(report.rows.every(row=>row.mapping.fromSite==='original'&&row.mapping.toSite===site&&row.mapping.to===kind));
    assert.equal(report.tracking.samples[0].examples[0].source.face,'feature-face-0');
    assert(report.tracking.samples[1].examples.every(row=>row.mapping.distance<=.095));
    const protection=document.protectedDetails.find(row=>row.id==='glint-'+site);
    assert.equal(protection.frame,site);
    const [at]=protection.pixels;
    const compiled=Pixel.compile(document,site,undefined,true);
    assert.equal(compiled.swatches[compiled.layerSources.get('approval').slots[at[1]*document.width+at[0]]],'laser-glint');
    assert(compiled.locks[at[1]*document.width+at[0]]);
    const g=KIT.sceneGraph.create(f.json('hierarchy-'+site));
    close(g.frame({node:'plate',socket:'probe'}).position,KIT.V.add(center[site],[.23,.14,.02]));
    close(g.frame('probe').position,KIT.V.add(center[site],[.23,.25,.02]));
    const rebaked=f.json('decals-'+site).decals[0];
    close(rebaked.anchor.at,KIT.V.add(center[site],[-.26,.024,.017]));
    assert.deepEqual(rebaked.image,f.decals.decals[0].image);
    const binding=document.sceneBindings.find(row=>row.id==='pilot-'+site);
    assert.equal(binding.frame,site);
    assert.equal(binding.featureMapping.id,featureMapping.id);
  }
  assert.deepEqual(document.frames[0],f.design.frames[0]);
});

test('selection refuses nearby substitutes, conflicting sites and filled protected gaps',t=>{
  const f=fixture(t), plan=f.json('plan-rebuilt');
  const source=capture(worldFor('original'),'reference',0), destination=capture(worldFor('rebuilt'),'replacement',1);
  const sourceAt=plan.paint.pixels[1], grid=[f.design.width,f.design.height];
  const sameReference=ink.rebindPixelFeature(f.design,plan,{graph:f.graph,decals:f.decals,render:()=>source});
  assert.equal(sameReference.document,undefined);
  assert(sameReference.report.problems.every(row=>row.reason==='no-named-feature-correspondence'));
  assert.equal(sameReference.graph,undefined);
  assert.equal(sameReference.decals,undefined);

  const duplicate=structuredClone(featureMapping);
  duplicate.features[0].sites.push({...duplicate.features[0].sites[0],id:'another-site'});
  const check=Features.identify(Features.compile(duplicate),{kind:'mesh',asset:'indicator-original',face:'feature-face-0'},
    center.original,null);
  assert.equal(check.reason,'ambiguous-named-feature');

  const rim=[[-1,0],[1,0]].map(delta=>sourceAt.map((n,i)=>n+delta[i]));
  const binding=f.design.sceneBindings[0], views=plan.views;
  const tracked=ink.trackPixelSelection({binding,selection:{id:'gap',pixels:rim},documentGrid:grid,
    revision:'fixture',views,feature:plan,render:(_sample,i)=>i ? destination : source});
  const points=tracked.report.samples[1].examples.map(row=>row.at);
  const target=points[0].map((n,i)=>(n+points[1][i])/2);
  assert(target.every(Number.isInteger));
  assert.equal(Math.abs(points[1][0]-points[0][0]),2);
  const design=structuredClone(f.design);
  design.frames[0].cels={};
  design.protectedDetails=[{id:'clearance',kind:'gap',frame:'original',pixels:[sourceAt]}];
  const {paint,sockets,decals,...base}=plan;
  const clearance={...base,details:[{from:'clearance',id:'rebuilt-clearance',
    gaps:[{at:sourceAt,anchors:rim}]}]};
  const patchCoverage=(pair,at,value)=>{
    const coverage=pair.full.passes.coverage.slice();
    coverage[at[1]*grid[0]+at[0]]=value;
    return {...pair,full:{...pair.full,passes:{...pair.full.passes,coverage}}};
  };
  const clearSource=patchCoverage(source,sourceAt,0);
  const blocked=ink.rebindPixelFeature(design,clearance,{render:(_r,i)=>i ? destination : clearSource});
  assert.equal(blocked.document,undefined);
  assert.equal(blocked.report.problems[0].reason,'replacement-gap-covered');
  const clear=ink.rebindPixelFeature(design,clearance,{render:(_r,i)=>i ? patchCoverage(destination,target,0) : clearSource});
  assert.deepEqual(clear.document.protectedDetails.at(-1).pixels,[target]);
});

test('CLI transfers scoped artifacts between two independently generated scene files',t=>{
  const f=fixture(t), demo=path.resolve(__dirname,'../examples/feature-mappings.cjs');
  for (const kind of ['original','rebuilt']) f.write(kind+'.js',
    `module.exports=()=>({id:${JSON.stringify('feature-'+kind)},name:'Feature',build:()=>require(${JSON.stringify(demo)}).worldFor(${JSON.stringify(kind)})});`);
  const doc=f.design;
  doc.sceneBindings[0].scene=f.file('original.js');
  f.write('work.json',doc);
  const run=(replacement,out,report)=>spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'pixel-art','feature-rebind',f.file('work.json'),f.file('plan-rebuilt.json'),'--scene',f.file('original.js'),
    '--replacement',f.file(replacement),'--graph',f.file('source-hierarchy.json'),'--decals',f.file('source-decals.json'),
    '--out',f.file(out),'--report',f.file(report)],{encoding:'utf8'});
  const accepted=run('rebuilt.js','bundle.json','review.json');
  assert.equal(accepted.status,0,accepted.stderr);
  const bundle=f.json('bundle');
  assert(bundle.report.passed);
  assert.equal(bundle.document.sceneBindings.at(-1).scene,f.file('rebuilt.js'));
  assert(bundle.decals&&bundle.graph);
  const denied=run('original.js','refused.json','mismatch.json');
  assert.equal(denied.status,2,denied.stderr);
  assert(!fs.existsSync(f.file('refused.json')));
  assert.equal(f.json('mismatch').passed,false);
});
