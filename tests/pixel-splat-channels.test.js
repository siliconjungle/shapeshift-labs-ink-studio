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
  const carved=fit({footprint:{shape:'mask',mask:{width:2,height:2,alpha:[0,0,0,0]},softness:0}});
  assert.ok(!carved.passes.objectId.includes(plate));
  assert.ok(carved.passes.surfaceKind.some((value,i)=>value===sdf && carved.passes.objectId[i]===post));
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

test('footprint trim and carve keep existing holes and survive preview, replay and undo',()=>{
  const world=sampleWorld(), source=ids(world).idAt(1);
  const doc={format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{rose:'#f35c81'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:world.id,object:'plate'}],
    destinations:[{id:'footprint',kind:'splat-attributes',binding:'plate'}]};
  const editor=ink.createPixelEditor(doc);
  const render=extra=>ink.render(world,{...options,...editor.renderOptions(world.id),raw:true,
    passes:[...options.passes,'sourceSplat'],...extra});
  const context={world:()=>world,captureSelection:render};
  const targets=()=>editor.targets('footprint',context);
  const patch=(id,operation)=>({id,destination:'footprint',frame:'front',revision:editor.describe().revision,
    sourceRevision:targets().sourceRevision,operation});
  const stencil=inside=>({width:16,height:16,alpha:Array.from({length:256},(_,i)=>inside(i%16,i>>4)?255:0)});
  const ring=stencil((x,y)=>!(x>=6 && x<=9 && y>=6 && y<=9));
  const initial=render();
  assert.equal(initial.passes.pigment[center],red+1);
  const mask=patch('mask',{splats:[{splat:source,footprint:{shape:'mask',mask:ring,softness:0}}]});
  editor.apply(mask,context);
  const ringRender=render();
  assert.equal(ringRender.passes.pigment[center],blue+1);
  assert.ok(ringRender.passes.depth[center]>initial.passes.depth[center]);
  assert.deepEqual(targets().splats[0].footprint.mask,ring);
  const trim=stencil(x=>x>=4);
  const carve=stencil((x,y)=>x>=10 && x<=13 && y>=2 && y<=5);
  const change=patch('trim-and-turn',{splats:[{splat:source,pigment:'rose'}],
    footprint:{trim,carve,rotation:Math.PI/2,stretch:[.85,1],softness:0}});
  const preview=editor.previewEdit(change,context);
  assert.equal(preview.valid,true);
  const hit=preview.targets[0].footprintHits[0];
  assert.equal(hit.footprint.before.mask.filledTexels,240);
  assert.equal(hit.footprint.after.mask.filledTexels,160);
  assert.deepEqual(render().rgb,ringRender.rgb);

  const edited=editor.apply(change,context);
  const receipt=editor.receipts().at(-1);
  assert.deepEqual(receipt.affectedTargets[0].splats,[hit]);
  assert.equal(edited.attributes[0][1].pigment,rose);
  const profile=targets().splats[0].footprint;
  assert.equal(profile.rotation,Math.PI/2);
  assert.deepEqual(profile.stretch,[.85,1]);
  assert.deepEqual(profile.mask.alpha,ring.alpha.map((n,i)=>n && trim.alpha[i] && !carve.alpha[i] ? 255 : 0));
  const shaped=render();
  assert.equal(shaped.passes.pigment[center],blue+1);
  assert.notDeepEqual(shaped.passes.coverage,ringRender.passes.coverage);
  assert(shaped.passes.pigment.some(n=>n===rose+1));

  const oldSlot=ringRender.passes.splatSources.findIndex(row=>row?.id===source);
  const oldPixel=Math.floor(ringRender.passes.sourceSplat.indexOf(oldSlot)/4);
  assert(oldSlot>0 && oldPixel>=0);
  const oldQuery=editor.targets('footprint',{world:()=>world,renderFrame:ringRender,
    query:{footprint:{at:[oldPixel%65,Math.floor(oldPixel/65)]}}});
  assert.equal(oldQuery.count,0);
  assert.equal(oldQuery.selection.footprint.staleIds,1);

  editor.undo();
  assert.deepEqual(render().rgb,ringRender.rgb);
  assert.deepEqual(editor.replay(receipt,context),edited);
  assert.deepEqual(render().rgb,shaped.rgb);
  editor.undo();
  assert.equal(editor.redo(),true);
  assert.deepEqual(render().rgb,shaped.rgb);
  const reset=editor.apply(patch('reset',{splats:[{splat:source,footprint:null}]}),context);
  assert.deepEqual(reset.attributes,[[source,{pigment:rose}]]);
  assert.equal(render().passes.pigment[center],rose+1);
});

test('softness changes a translucent splat edge and retained planes keep their original frames',()=>{
  const B=makeBuilder(4,[0,red]);
  B.disc(0,0,0,[0,0,1],.38,.018,B.P[1],.8);
  B.describeSplats(0,1,{object:'plate'});
  B.describeFootprint(0,1,{shape:'square',softness:.22,depth:'plane'},[.45,0,.1,0,.45,0]);
  const world=B.finish({id:'planar-test',cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true}});
  const splat=ids(world).idAt(0);
  const doc={format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{rose:'#f35c81'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:world.id,object:'plate'}],
    destinations:[{id:'profile',kind:'splat-attributes',binding:'plate'}]};
  const editor=ink.createPixelEditor(doc), context={world:()=>world};
  const patch=(id,footprint)=>({id,destination:'profile',frame:'front',revision:editor.describe().revision,
    operation:{splats:[{splat,footprint}]}});
  const config={...options,raw:true};
  const original=ink.render(world,config);
  const asset=editor.apply(patch('sharp',{softness:0}),context);
  assert.throws(()=>editor.apply(patch('discard-frame',false),context),/retained plane/);
  const compiled=Fit.prepare(world,asset);
  assert.deepEqual(compiled.footprints.frames,world.splatFootprints.frames);
  assert.equal(Fit.footprintAt(compiled.footprints,0).depth,'plane');
  const sharp=ink.render(world,{...config,splatFit:asset});
  assert.equal(sharp.alpha[center],original.alpha[center]);
  assert(sharp.alpha.some((a,i)=>a===0 && original.alpha[i]>0));
  assert.deepEqual(ink.render(world,{...config,splatFit:asset,splatFootprints:false}).alpha,
    ink.render(world,{...config,splatFootprints:false}).alpha);
});

test('replacing the last use of a footprint profile frees its slot for the edited shape',()=>{
  const B=makeBuilder(3,[red]);
  for (let i=0; i<=64; i++) {
    B.iso(i,0,0,.25,B.P[0],3,{splatId:'chip-'+i});
    B.describeFootprint(i,i+1,{shape:'circle',rotation:(i%64)/128});
  }
  const world=B.finish();
  const asset={format:Fit.format,version:1,rows:world.count,signature:signature(world),edits:[]};
  const replaced=Fit.prepare(world,{...asset,attributes:[[1,{footprint:'wedge'}]]});
  assert.equal(replaced.footprints.styles.length,64);
  assert.equal(Fit.footprintAt(replaced.footprints,1).shape,'wedge');
  assert.deepEqual(Fit.footprintAt(replaced.footprints,64),Fit.footprintAt(world.splatFootprints,64));
  assert.throws(()=>Fit.prepare(world,{...asset,attributes:[[0,{footprint:'wedge'}]]}),/footprint style budget/);
});

test('source attributes preview coverage and depth and retain IDs through a move and undo',()=>{
  const world=sampleWorld(), splat=ids(world).idAt(1), source=world.data.slice();
  const doc={format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{rose:'#f35c81'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:world.id,object:'plate'}],
    destinations:[{id:'attributes',kind:'splat-attributes',binding:'plate'}]};
  const editor=ink.createPixelEditor(doc);
  const render=extra=>ink.render(world,{...options,...editor.renderOptions(world.id),raw:true,
    passes:[...options.passes,'sourceSplat'],...extra});
  const context={world:()=>world,captureSelection:render};
  const targets=query=>editor.targets('attributes',{...context,query});
  const patch=(id,operation)=>({id,destination:'attributes',frame:'front',revision:editor.describe().revision,
    sourceRevision:targets().sourceRevision,operation});
  const before=render();
  const change=patch('move-turn',{attributes:{opacity:.6,scale:[2,1,1]},
    splats:[{splat,position:[.67,.22,.88],orientation:[0,0,1,1]}]});
  const preview=editor.previewEdit(change,{...context,limit:7,time:.125});
  assert.equal(preview.valid,true,JSON.stringify(preview.conflicts));
  const {attributeHits,render:review}=preview.targets[0];
  assert.equal(attributeHits[0].id,splat);
  assert.deepEqual(attributeHits[0].attributes.before.position,[0,0,source[18]]);
  assert.deepEqual(attributeHits[0].attributes.after.position,[.67,.22,.88]);
  assert.deepEqual(review.grid,[65,65]);
  assert.equal(review.time,.125);
  assert(review.coverageChanged>7 && review.depthChanged>7);
  assert(review.truncated && review.pixels.length===7);
  assert.deepEqual(editor.renderOptions(world.id),{});
  assert.deepEqual(world.data,source);

  const applied=editor.apply(change,context);
  const after=render();
  assert.notDeepEqual(after.passes.coverage,before.passes.coverage);
  assert.notDeepEqual(after.passes.depth,before.passes.depth);
  assert(after.passes.splatSources.some(row=>row?.id===splat));
  const current=targets({region:{min:[.6,.2,.8],max:[.7,.3,.9]}}).splats[0];
  assert.equal(current.id,splat);
  assert.equal(current.attributes.opacity,.6);
  assert.deepEqual(current.at,[.67,.22,.88]);
  assert.deepEqual(current.attributes.scale,[2,1,1]);
  const transformed=Fit.renderWorld(world,Fit.prepare(world,applied));
  assert(transformed.data[24]>transformed.data[20]*3);
  assert.deepEqual(transformed.data.subarray(0,16),source.subarray(0,16));
  const stale=editor.targets('attributes',{world:()=>world,renderFrame:before,query:{footprint:{at:[32,32]}}});
  assert.equal(stale.count,0);
  assert.equal(stale.selection.footprint.staleIds,1);
  assert.equal(editor.undo(),true);
  assert.deepEqual(render().rgb,before.rgb);
  assert.equal(editor.redo(),true);
  assert.deepEqual(render().passes.depth,after.passes.depth);

  const reset=patch('restore',{splats:[{splat,opacity:null,position:null,scale:null,orientation:null}]});
  assert.deepEqual(editor.apply(reset,context).attributes,undefined);
  assert.deepEqual(render().rgb,before.rgb);
  assert.throws(()=>editor.apply(patch('bad-scale',{splats:[{splat,scale:[0,1,1]}]}),context),/Invalid splat scale/);
  assert.deepEqual(world.data,source);
});

test('an open transaction previews opacity on its bound scene and SDF assist leaves the edited body hidden',()=>{
  const authored=scene(), sceneEditor=ink.createSceneEditor(authored), world=sceneEditor.build();
  const doc={format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{rose:'#f35c81'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:'panel',object:'plate'}],
    destinations:[{id:'alpha',kind:'splat-attributes',binding:'plate'}]};
  const editor=ink.createPixelEditor(doc,{sceneEditor,sceneRef:'panel'});
  const selected=editor.targets('alpha',{limit:4096});
  assert(selected.count>1 && selected.splats.length===selected.count);
  const patch={id:'hide-plate',destination:'alpha',frame:'front',revision:editor.describe().revision,
    sourceRevision:selected.sourceRevision,operation:{attributes:{opacity:0},splats:selected.splats.map(row=>({splat:row.id}))}};
  editor.begin('Hide plate');
  editor.apply(patch);
  const review=editor.previewChanges({limit:1});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert(review.targets[0].render.changedPixels>1);
  assert(review.targets[0].render.pixels[0].before.sceneCoverage>review.targets[0].render.pixels[0].after.sceneCoverage);
  const base=ink.render(world,options), draft=ink.render(world,{...options,...editor.renderOptions('panel')});
  assert(base.passes.objectId.includes(base.passes.objects.indexOf('plate')));
  assert(!draft.passes.objectId.includes(draft.passes.objects.indexOf('plate')));
  const sdf=draft.passes.surfaceKinds.indexOf('sdf'), post=draft.passes.objects.indexOf('post');
  assert(draft.passes.surfaceKind.some((n,i)=>n===sdf && draft.passes.objectId[i]===post));
  editor.cancel();
  assert.deepEqual(editor.renderOptions('panel'),{});
});

test('geometry attributes carry retained footprint axes and shading normals with the covariance',()=>{
  const B=makeBuilder(4,[0,red]);
  B.disc(0,0,0,[0,0,1],.38,.018,B.P[1],3);
  B.describeSplats(0,1,{object:'plate'});
  B.describeFootprint(0,1,{shape:'square',softness:0,depth:'plane'},[.45,0,0,0,.45,0]);
  const world=B.finish({id:'tilt-test',cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true}});
  const angle=Math.PI/6;
  const asset={format:Fit.format,version:1,rows:world.count,signature:signature(world),edits:[],
    attributes:[[0,{scale:[2,1,1],orientation:[Math.sin(angle),0,0,Math.cos(angle)]}]]};
  const fitted=Fit.renderWorld(world,Fit.prepare(world,asset));
  assert.equal(Fit.footprintAt(fitted.splatFootprints,0).depth,'plane');
  assert(Math.abs(fitted.splatFootprints.frames[0]-.9)<1e-6);
  assert(fitted.splatFootprints.frames[5]>.38);
  assert(fitted.renderMetadata.normals[1]<-.85);
  const a=ink.render(world,{...options,raw:true}), b=ink.render(world,{...options,raw:true,splatFit:asset});
  assert.notDeepEqual(a.passes.depth,b.passes.depth);
  assert(world.splatFootprints.frames[5]===0);
});

test('add, clone and retire preserve source lineage, paint and ordered batch replay',()=>{
  const world=sampleWorld(), original=world.data.slice(), source=ids(world).idAt(1);
  const doc={format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{rose:'#f35c81',ink:'#224766'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:world.id,object:'plate'}],
    destinations:[{id:'splats',kind:'splat-attributes',binding:'plate'}]};
  const editor=ink.createPixelEditor(doc);
  const render=()=>ink.render(world,{...options,...editor.renderOptions(world.id),raw:true,
    passes:[...options.passes,'sourceSplat']});
  const context={world:()=>world,captureSelection:render};
  const targets=query=>editor.targets('splats',{...context,query});
  const patch=(id,operation)=>({id,destination:'splats',frame:'front',revision:editor.describe().revision,
    sourceRevision:targets().sourceRevision,operation});
  editor.apply(patch('paint-source',{splats:[{splat:source,pigment:'rose',scale:[1.2,.9,1]}]}),context);
  const before=render();
  const topology=patch('repair',{topology:[
    {op:'add',id:'infill',position:[-.62,.2,.42],radius:[.19,.16,.04],pigment:'ink',opacity:.85,part:'rim'},
    {op:'clone',from:source,id:'rim-a',offset:[.58,-.1,.06]},
    {op:'clone',from:'rim-a',id:'rim-b',position:[.95,-.3,.42]},
    {op:'retire',splat:source,reason:'Redundant center'}
  ]});
  const review=editor.previewEdit(topology,{...context,limit:2});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.targets[0].topologyHits.map(hit=>hit.topology.op),['add','clone','clone','retire']);
  assert(review.targets[0].render.coverageChanged>2);
  assert.deepEqual(render().rgb,before.rgb);
  const asset=editor.apply(topology,context);
  const receipt=editor.receipts().at(-1);
  assert.deepEqual(receipt.affectedTargets[0].splats,review.targets[0].topologyHits);
  assert.equal(asset.version,2);
  const fitted=Fit.prepare(world,asset), grown=Fit.renderWorld(world,fitted);
  assert.equal(grown.count,5);
  assert.equal(ids(grown).rowOf(source),1);
  assert.equal(ids(grown).rowOf('infill'),2);
  assert.equal(ids(grown).rowOf('rim-a'),3);
  assert.equal(ids(grown).rowOf('rim-b'),4);
  const reordered=KIT.procedural.splatProvenance.subset(world,[1,0]);
  const reorderedFit=Fit.prepare(reordered,asset);
  const rebuilt=Fit.renderWorld(reordered,reorderedFit);
  assert.equal(ids(rebuilt).rowOf(source),0);
  assert.equal(reorderedFit[0],0);
  assert.equal(Fit.lifecycle(rebuilt,3).created.from,source);
  assert.deepEqual(world.data,original);
  assert.deepEqual(grown.data.subarray(0,16),original.subarray(0,16));
  assert.deepEqual(targets().splats.map(row=>row.id),['infill','rim-a','rim-b']);
  const added=targets({part:'rim'}).splats[0];
  assert.equal(added.id,'infill');
  assert.equal(added.attributes.opacity,.85);
  const all=targets({includeRetired:true}).splats;
  const retired=all.find(row=>row.id===source);
  assert.deepEqual(retired.retired,{edit:'repair',reason:'Redundant center'});
  assert.equal(retired.paintable,false);
  const first=all.find(row=>row.id==='rim-a'), second=all.find(row=>row.id==='rim-b');
  assert.deepEqual(first.provenance,{op:'clone',edit:'repair',from:source});
  assert.deepEqual(second.provenance,{op:'clone',edit:'repair',from:'rim-a'});
  assert.equal(second.pigment,'#f35c81');
  assert.deepEqual(second.attributes.scale,[1.2,.9,1]);
  assert.deepEqual(second.footprint,first.footprint);
  const after=render();
  assert(!after.passes.splatSources.some(row=>row?.id===source));
  assert(after.passes.splatSources.some(row=>row?.id==='rim-a'));
  assert(after.passes.splatSources.some(row=>row?.id==='infill'));

  const stale=editor.targets('splats',{world:()=>world,renderFrame:before,query:{footprint:{at:[32,32]}}});
  assert.equal(stale.count,0);
  assert.equal(stale.selection.footprint.staleIds,1);
  assert.throws(()=>editor.apply(patch('cannot-edit',{splats:[{splat:source,opacity:.5}]}),context),/retired splat/);
  assert.throws(()=>editor.apply(patch('cannot-reuse',{topology:[{op:'clone',from:'rim-a',id:'rim-b',offset:[1,0,0]}]}),context),/reserved or already exists/);
  assert.throws(()=>editor.apply(patch('out-of-scope',{topology:[
    {op:'retire',splat:'infill'},{op:'clone',from:ids(world).idAt(0),id:'other',offset:[1,0,0]}
  ]}),context),/out-of-scope/);
  assert.deepEqual(editor.renderOptions(world.id).splatFit,asset);
  editor.undo();
  assert.deepEqual(render().rgb,before.rgb);
  assert.deepEqual(editor.replay(receipt,context),asset);
  assert.deepEqual(render().rgb,after.rgb);
  editor.undo();
  editor.redo();
  assert.deepEqual(render().rgb,after.rgb);
  editor.apply(patch('paint-clone',{splats:[{splat:'rim-b',pigment:'ink'}]}),context);
  assert.equal(targets().splats.find(row=>row.id==='rim-b').pigment,'#224766');
  assert.equal(targets().splats.find(row=>row.id==='rim-a').pigment,'#f35c81');
});

test('retirement survives SDF assist and retains signed legacy fit rows',()=>{
  const world=KIT.diorama.build(scene()), labels=require('../src/target-selectors.js').index(world).row;
  const source=Array.from({length:world.count},(_,i)=>i).filter(i=>labels(i).object==='plate' && Fit.topologyEditable(world,i));
  const idsAt=ids(world);
  const asset={format:Fit.format,version:1,rows:world.count,signature:signature(world),edits:[],
    attributes:[[world.count,{pigment:rose}]],
    topology:[{op:'clone',target:{object:'plate'},edit:'repair',id:'side-tack',from:idsAt.idAt(source[0]),position:[0,.9,.12]},
      ...source.map(i=>({op:'retire',target:{object:'plate'},edit:'repair',id:idsAt.idAt(i)}))]};
  const a=ink.render(world,{...options,raw:true});
  const b=ink.render(world,{...options,raw:true,splatFit:asset,passes:[...options.passes,'sourceSplat']});
  const plate=a.passes.objects.indexOf('plate'), post=a.passes.objects.indexOf('post'), sdf=a.passes.surfaceKinds.indexOf('sdf');
  assert(a.passes.surfaceKind.some((n,i)=>n===sdf && a.passes.objectId[i]===plate));
  assert(!b.passes.surfaceKind.some((n,i)=>n===sdf && b.passes.objectId[i]===plate));
  assert(b.passes.surfaceKind.some((n,i)=>n===sdf && b.passes.objectId[i]===post));
  assert(b.passes.splatSources.some(row=>row?.id==='side-tack'));
  assert(b.passes.pigment.some(color=>color===rose+1));
});
