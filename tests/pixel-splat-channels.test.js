const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const Fit = require('../cli/splat-fit-asset.js');
const { signature } = require('../cli/render-row-assets.js');
const { KIT,makeBuilder } = ink.load();
const rose=0xf35c81, red=0x9c402f, blue=0x214b8c;
const rgb = value => [value>>16,value>>8&255,value&255];
const close = (a,b) => Math.abs(a-b)<1e-6;
const options={w:65,h:65,px:1,ortho:true,transparent:true,
  passes:['coverage','surfaceCoverage','depth','normal','pigment','splatId','objectId','materialId','surfaceKind']};
const center = (32*65+32), pixel=frame=>Array.from(frame.rgb.subarray(center*3,center*3+3));
const exactBytes=(left,right)=>left.length===right.length&&left.every((n,i)=>n===right[i]);
const ids = world => KIT.procedural.splatProvenance.identities(world);

function sampleWorld() {
  const B=makeBuilder(47,[0,red,blue,rose]);
  B.pixNext([2],1,null,0,0,1);
  B.disc(0,0,-.32,[0,0,1],.65,.015,B.P[2],3);
  B.describeSplats(0,1,{object:'backing',material:'blue-cloth'});
  B.pixNext([1],1,null,0,0,1);
  B.disc(0,0,.32,[0,0,1],.27,.015,B.P[1],3);
  B.describeSplats(1,2,{object:'plate',material:'enamel'});
  B.describeFootprint(1,2,{shape:'square',softness:0});
  return B.finish({id:'coverage-fixture',cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true},radius:4,dither:0,
    fog:{c:0,start:1,max:0}, look:{pixel:true}});
}

test('native pigment holds byte-exact coverage and depth in both patterned and raw renders',()=>{
  const world=sampleWorld(), original=world.data.slice(), target=ids(world).idAt(1);
  const asset={format:Fit.format,version:2,scene:world.id,target:{object:'plate'},edits:[],
    attributes:[[target,{pigment:rose}]]};
  for (const raw of [false,true]) {
    const config={...options,raw,colored:!raw};
    const before=ink.render(world,config), after=ink.render(world,{...config,splatFit:asset});
    assert.notDeepEqual(pixel(before),pixel(after));
    assert.equal(after.passes.pigment[center],rose+1);
    for (const channel of ['coverage','surfaceCoverage','depth','normal','materialId','splatId'])
      assert.ok(exactBytes(before.passes[channel],after.passes[channel]),channel);
    assert.ok(exactBytes(before.alpha,after.alpha));
  }
  assert.ok(exactBytes(world.data,original));
});

test('coverage scales the resolved footprint and exposes the backing while keeping pigment editable',()=>{
  const world=sampleWorld();
  const paint=(coverage)=>({format:Fit.format,version:1,rows:world.count,signature:signature(world),edits:[],
    attributes:[[1,{pigment:rose,coverage}]]});
  const config={...options,raw:true,pixelSelection:{object:'plate',isolated:true}};
  const opaque=ink.render(world,{...config,splatFit:paint(1)});
  const half=ink.render(world,{...config,splatFit:paint(.5)});
  assert.ok(opaque.passes.coverage[center]>.9);
  assert.ok(close(half.passes.coverage[center],opaque.passes.coverage[center]*.5));
  assert.ok(half.passes.coverage.every((n,i)=>close(n,opaque.passes.coverage[i]*.5)));
  assert.equal(half.passes.depth[center],Infinity);
  for (const splatOrder of ['center','surface','selective']) {
    const settings={...options,colored:true,splatOrder};
    const mixed=ink.render(world,{...settings,splatFit:paint(.5)});
    assert.ok(pixel(mixed)[0]>rgb(blue)[0]&&pixel(mixed)[0]<rgb(rose)[0]);
    assert.ok(mixed.passes.depth[center]>opaque.passes.depth[center]);
    assert.equal(mixed.passes.pigment[center],blue+1);
    const hidden=ink.render(world,{...settings,splatFit:paint(0)});
    assert.deepEqual(pixel(hidden),rgb(blue));
  }
  assert.equal(Fit.pigmentAt(world,1,Fit.prepare(world,paint(0))),rose);
  assert.throws(()=>Fit.prepare(world,paint(1.1)),/coverage needs/);
});

function scene() {
  return {id:'panel',style:'slate',camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    finish:{look:{sdfAssist:true,pixel:true}},
    solids:[{id:'plate',kind:'box',at:[-.6,0,.08],half:[.47,.57,.16],res:.09,mat:'stone'},
      {id:'post',kind:'box',at:[.6,0,.06],half:[.26,.57,.18],res:.09,mat:'stone'}]};
}

test('coverage-edited bodies use splats while independent SDF surfaces remain traced',()=>{
  const world=KIT.diorama.build(scene()), rows=require('../src/target-selectors.js').index(world).row;
  const splats=Array.from({length:world.count},(_,i)=>i).filter(i=>rows(i).object==='plate' && Fit.eligible(world,i));
  const asset={format:Fit.format,version:1,rows:world.count,signature:signature(world),edits:[]};
  const fit=(paint)=>ink.render(world,{...options,raw:true,splatFit:{...asset,attributes:splats.map(i=>[i,paint])}});
  const a=ink.render(world,{...options,raw:true}), pigment=fit({pigment:rose}), trim=fit({coverage:.25,pigment:rose});
  assert.ok(exactBytes(pigment.passes.coverage,a.passes.coverage));
  assert.ok(exactBytes(pigment.passes.depth,a.passes.depth));
  assert.ok(pigment.passes.pigment.some(n=>n===rose+1));
  const post=a.passes.objects.indexOf('post'), plate=a.passes.objects.indexOf('plate'), sdf=a.passes.surfaceKinds.indexOf('sdf');
  assert.ok(a.passes.surfaceKind.some((value,i)=>value===sdf&&a.passes.objectId[i]===plate));
  assert.ok(a.passes.surfaceKind.some((value,i)=>value===sdf&&a.passes.objectId[i]===post));
  assert.ok(!trim.passes.surfaceKind.some((value,i)=>value===sdf&&trim.passes.objectId[i]===plate));
  assert.ok(trim.passes.coverage.some((n,i)=>a.passes.objectId[i]===plate&&n<a.passes.coverage[i]-.1));
  assert.ok(trim.passes.surfaceKind.some((value,i)=>value===sdf&&trim.passes.objectId[i]===post&&
    trim.passes.coverage[i]===a.passes.coverage[i]));
});

test('CLI and SDK edits retain each other, including zero coverage, restores and compatible legacy assets',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-splat-channels-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    {cwd:path.resolve(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const source=scene(), doc={format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{rose:'#f35c81'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:file('scene.json'),object:'plate'}],
    destinations:[{id:'channels',kind:'splat-attributes',binding:'plate'}]};
  save('scene.json',source);
  save('doc.json',doc);
  const observed=run('targets',file('doc.json'),'--scene',file('scene.json'),'--destination','channels','--limit','1');
  const [{id:splat,pigment:original}]=observed.splats;
  const patch=(id,report,change)=>({id,frame:'front',destination:'channels',revision:report.documentRevision,
    sourceRevision:report.sourceRevision,operation:{splats:[{splat,...change}]}});
  save('patch.json',patch('paint',observed,{pigment:'rose',footprintScale:.75}));
  const receipt=run('edit',file('doc.json'),file('patch.json'),'--scene',file('scene.json'),'--out',file('paint.json'));
  const first=read('paint.json');
  assert.equal(receipt.status,'applied');
  assert.deepEqual(receipt.affectedTargets[0].channels,[{splat,pigment:'rose'}]);
  assert.equal(first.version,2);
  assert.deepEqual(first.attributes,[[splat,{pigment:rose}]]);
  save('scene.json',{...source,finish:{...source.finish,look:{...source.finish.look,splatFit:first}}});
  const painted=run('targets',file('doc.json'),'--scene',file('scene.json'),'--destination','channels','--limit','1');
  assert.equal(painted.splats[0].pigment,'#f35c81');
  assert.equal(painted.splats[0].coverage,1);
  save('patch.json',patch('trim',painted,{coverage:0}));
  const trimReceipt=run('edit',file('doc.json'),file('patch.json'),'--scene',file('scene.json'),'--out',file('trim.json'));
  assert.deepEqual(trimReceipt.affectedTargets[0].channels,[{splat,coverage:0}]);
  const trimmed=read('trim.json');
  assert.deepEqual(trimmed.attributes,[[splat,{pigment:rose,coverage:0}]]);
  assert.deepEqual(trimmed.edits,first.edits);

  const world=KIT.diorama.build(source), row=ids(world).rowOf(splat);
  const legacy={format:Fit.format,version:1,rows:world.count,signature:signature(world),edits:[[row,.75]],
    attributes:[[row,{footprint:'square',pigment:rose,coverage:0}]]};
  const editor=ink.createPixelEditor(doc), context={world:()=>({...world,look:{...world.look,splatFit:legacy}}),limit:1};
  const report=()=>editor.targets('channels',context);
  assert.equal(report().splats[0].coverage,0);
  assert.equal(report().splats[0].pigment,'#f35c81');
  const restored=editor.apply(patch('restore-coverage',report(),{coverage:1}),context);
  assert.deepEqual(restored.attributes,[[row,{footprint:'square',pigment:rose}]]);
  assert.equal(report().splats[0].footprintScale,.75);
  assert.equal(report().splats[0].coverage,1);
  const clear=editor.apply(patch('restore-pigment',report(),{pigment:null}),context);
  assert.deepEqual(clear.attributes,[[row,{footprint:'square'}]]);
  assert.equal(report().splats[0].pigment,original);
  editor.undo();
  assert.equal(report().splats[0].pigment,'#f35c81');
});
