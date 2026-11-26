const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const test=require('node:test');
const ink=require('..');
const PNG=require('../cli/png.js');
const {KIT:K}=ink.load(), T=K.meshTopology;

const palette={format:'ink-studio/pixel-palette',version:1,swatches:[
  {id:'rust',color:'#a3553b'},{id:'ink',color:'#1c3038'},{id:'signal',color:'#f0ce81',locked:true}
]};
const points=[[-1,0,0],[0,0,0],[1,0,0],[-1,1,0],[0,1,0],[1,1,0]];
function receiver(two=true) {
  const faces=[[0,1,4,3],...(two?[[1,2,5,4]]:[])];
  return T.create({id:'frame',vertices:points.map((position,i)=>({id:'p'+i,position})),
    faces:faces.map((face,i)=>({id:['west','east'][i],material:['copper','slate'][i],
      corners:face.map((vertex,k)=>({id:'c'+i+'-'+k,vertex:'p'+vertex,uv:[[.10,.88],[.90,.88],[.90,.12],[.10,.12]][k],
        ...(i===0&&k===0&&{uvPinned:true})}))}))});
}
function source() {
  return {points:points.map(([x,y])=>[x,y,.08]),faces:[[0,1,4,3],[1,2,5,4]],faceParts:['body','body'],
    faceMaterials:[0,1],materials:[{name:'rust',color:[.6,.10,.02],roughness:.24},{name:'ink',color:[.01,.025,.045],roughness:.63}]};
}

test('registered part batches fit cages, keep native UV texels and palette slots, and diagnose physical page seams',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-registered-parts-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=name=>path.join(directory,name);
  const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'material-bake',...args],{cwd:directory,encoding:'utf8'}));
  save('high.json',source());
  const doc=receiver(), small=receiver(false);
  save('body.json',doc);
  save('body-far.json',small);
  save('tiles.json',{format:'ink-studio/uv-tile-layout',version:1,mesh:doc.id,revision:T.revision(doc),uvSet:0,
    tiles:[{at:[0,0],material:'copper',size:[48,32],faces:['west']},{at:[1,0],material:'slate',size:[32,32],faces:['east']}]});
  const preset=run('preset','indexed','--out','preset.json');
  assert(preset.paletteRequired);
  const a={id:'body-near',part:'body',lod:0,receiver:'body.json',revision:T.revision(doc),source:{file:'high.json'},
    layout:'tiles.json',sampling:{cage:{search:.23,margin:.025},maxWork:100000},
    pins:[{id:'mark',tile:[0,0],uv:[.44,.5],swatch:'signal'}]};
  const b={...a,id:'body-far',lod:1,receiver:'body-far.json',revision:T.revision(small),layout:undefined,
    sampling:{size:32,cage:{front:.16,back:.02},maxWork:100000,channels:['pigment','normal']},
    pins:[{id:'mark',uv:[.44,.5],swatch:'signal'}]};
  const plan={format:'ink-studio/registered-part-batch',version:1,preset:'preset.json',palette,targets:[a,b]};
  save('plan.json',plan);
  const preview=run('inspect','plan.json');
  assert.equal(preview.targets[0].cage.mode,'automatic');
  assert(Math.abs(preview.targets[0].cage.front-.105)<1e-8);
  assert.deepEqual(preview.targets[0].pages.map(row=>row.size),[64,32]);
  assert.deepEqual(preview.targets[0].pages[0].pins[0].texel,[.1*47,.88*31]);
  assert.equal(preview.targets[1].cage.mode,'explicit');
  const result=run('run','plan.json','--out','out');
  const near=result.targets[0], far=result.targets[1], marker=read('out/latest.json');
  assert.equal(marker.revision,result.revision);
  assert.equal(near.samplingTotals.misses,0);
  assert(near.samplingTotals.hits>0 && far.samplingTotals.hits>0);
  assert.equal(near.seamSummary.edges,1);
  assert.equal(near.seamSummary.flagged,1);
  assert.equal(near.seamSummary.missing,0);
  const nearReport=JSON.parse(fs.readFileSync(path.join(result.directory,near.seams)));
  assert(nearReport.seams[0].reasons.includes('pigment-jump'));
  assert(nearReport.seams[0].maxNormalDegrees<2);
  for(const target of result.targets) {
    const registered=path.join(result.directory,target.materialBake), manifest=JSON.parse(fs.readFileSync(registered));
    const page=manifest.meshes[0], decoded=PNG.raster(path.join(path.dirname(registered),page.palette.indexed.file));
    const [{at:[x,y],slot,swatch}]=page.palette.pins;
    assert.equal(slot,2);
    assert.equal(swatch,'signal');
    assert.deepEqual(Array.from(decoded.data.slice((y*decoded.w+x)*4,(y*decoded.w+x)*4+4)),[240,206,129,255]);
    assert.equal(fs.readFileSync(path.join(result.directory,target.model)).toString('ascii',0,4),'glTF');
  }
  assert.deepEqual(read('body.json'),doc);
  save('broken.json',{...plan,targets:[{...a,pins:[{id:'outside',at:[63,63],tile:[0,0],swatch:'signal'}]}]});
  const failure=spawnSync(process.execPath,[cli,'material-bake','run','broken.json','--out','out'],{cwd:directory,encoding:'utf8'});
  assert.notEqual(failure.status,0);
  assert.match(failure.stderr,/pins need covered receiver texels/);
  assert.deepEqual(read('out/latest.json'),marker);
});

test('protected receiver pigment survives a cage transfer while neighboring faces use the detailed source',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-protected-bake-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const src=source(), doc=receiver();
  const mesh=K.model.fromTopology(doc,{materials:[{id:'copper',color:[0,1,0]},{id:'slate',color:[0,0,1]}]});
  const split=mesh.faceIds.map(id=>id==='west');
  mesh.uvs=mesh.uvs.map((row,i)=>row.map(([u,v])=>[.5*u+(split[i]?0:.5),v]));
  ink.exportGlb(mesh,{out:path.join(directory,'view.glb'),bakeDir:directory,registeredPages:[{size:64,padding:0}],
    cageBake:{format:'ink-studio/material-cage-bake',version:1,receivers:[{mesh:0,front:.12,back:0,part:'body',
      protectPigment:['west'],source:{kind:'mesh',model:src}}]}});
  const report=JSON.parse(fs.readFileSync(path.join(directory,'material-bake.json'))).meshes[0];
  assert(report.cageBake.protectedPigment.texels>0);
  const {w,data}=PNG.raster(path.join(directory,report.maps.pigment.file));
  const sample=x=>Array.from(data.slice((32*w+x)*4,(32*w+x)*4+4));
  assert.deepEqual(sample(16),[0,255,0,255]);
  assert.notDeepEqual(sample(48),[0,0,255,255]);
});
