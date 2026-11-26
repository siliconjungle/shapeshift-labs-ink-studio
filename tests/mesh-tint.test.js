'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), K = ink.load().KIT, T = K.meshTopology;
const PNG = require('../cli/png.js'), cli = path.resolve(__dirname,'../cli/ink-studio.js');

function fixture() {
  const vertices = [[-1.6,0,0],[0,0,0],[1.6,0,0],[-1.6,1.4,0],[0,1.4,0],[1.6,1.4,0]]
    .map((position,i)=>({id:'v'+i,position}));
  const faces = [['west',[0,1,4,3]],['east',[1,2,5,4]]].map(([id,verts])=>({id,material:'tile',
    corners:verts.map((n,i)=>({id:id+'/'+i,vertex:'v'+n,uv:[[0,1],[1,1],[1,0],[0,0]][i],
      attributes:{'uv/1':[[0,1],[1,1],[1,0],[0,0]][i],stamp:2}}))}));
  return {id:'painted-wing',vertices,faces};
}

const plain = T.create(fixture());
const warm = [.9,.42,.33], cool = [.32,.65,.92];
const plan = (doc,request)=>T.planTint(doc,request);
const tint = (doc,corner)=>doc.faces.flatMap(face=>face.corners).find(row=>row.id===corner)?.attributes?.tint;
const view = {w:100,h:64,px:1,raw:true};

function scene() {
  const tileset = ink.createBlankTileset({width:3,height:3,background:'#dce7ce'});
  const data = Buffer.from(tileset.data,'base64');
  data[4*4+3] = 0;
  const rev = T.revision(plain);
  return {id:'tint-workshop',style:'slate',solids:[],camera:{target:[0,.7,0],dist:5,yaw:0,pitch:0,projection:'orthographic'},
    tilesets:{paint:{...tileset,data:data.toString('base64')}},
    topologyMeshes:{wing:{part:'panel',document:plain,materials:[{id:'tile',texture:{tileset:'paint'}}],
      bindings:[{id:'corner',domain:'corners',element:'west/1'}],
      bakes:[{id:'finish',material:'tile',maps:{roughness:.45}}],
      shapeKeys:{format:'ink-studio/mesh-shape-keys',version:1,mesh:plain.id,restRevision:rev,keys:[]},
      attachments:T.attachments.create(plain,[])}}};
}

test('paint a single seam corner, expand a vertex to incident corners, and sample and clear exact authored values',()=>{
  const one = plan(plain,{tool:'paint',corner:'west/1',color:warm});
  assert.equal(one.report.changedCorners,1);
  assert.deepEqual(tint(one.document,'west/1'),warm);
  assert.equal(tint(one.document,'east/0'),undefined);
  assert.deepEqual(one.document.faces[0].corners[1].attributes['uv/1'],[1,1]);
  assert.deepEqual(T.uv.select(one.document,{domain:'faces',tint:{color:warm}}).faces,['west']);
  const vertex = plan(one.document,{tool:'paint',vertex:'v4',color:cool});
  assert.deepEqual(vertex.report.changes.map(row=>row.corner),['west/2','east/3']);
  const sample = plan(vertex.document,{tool:'eyedropper',vertex:'v4'});
  assert.deepEqual(sample.report.samples.map(row=>row.color),[cool,cool]);
  assert.equal(sample.document,vertex.document);
  const cleared = plan(vertex.document,{tool:'erase',corner:'west/2'});
  const read = plan(cleared.document,{tool:'eyedropper',corner:'west/2'}).report.samples[0];
  assert.deepEqual(read,{face:'west',corner:'west/2',vertex:'v4',tint:null,color:[1,1,1]});
  assert.deepEqual(tint(cleared.document,'east/3'),cool);
  assert.equal(plan(cleared.document,{tool:'erase',corner:'west/2'}).report.changedCorners,0);
  assert.throws(()=>plan(plain,{tool:'paint',color:[2,0,0],face:'west'}),/normalized RGB/);

  const split = T.subdivide(one.document);
  assert(split.faces.some(face=>face.corners.some(corner=>corner.attributes?.tint?.[1]===.71)));
  assert.deepEqual(T.triangulate(plain).indices,T.triangulate(one.document).indices);

  const legacy = T.edit(plain,{faces:[{...plain.faces[0],corners:plain.faces[0].corners.map(row=>
    ({...row,attributes:{...row.attributes,tint:[.2,.3]}}))}]});
  assert.throws(()=>plan(legacy,{tool:'paint',face:'west',color:warm}),/generic attribute/);
  assert.equal(plan(legacy,{tool:'erase',face:'west'}).document,legacy);
});

test('accept saved UV-corner and component selections and keep scene attachments, bakes, coverage and atlas registered',()=>{
  const original = scene(), editor = ink.createSceneEditor(original);
  const before = ink.render(editor.build(),{...view,passes:['depth']});
  const selection = T.select(plain,{domain:'faces',ids:['east']});
  const operation = {tool:'paint',selection,color:'#7bd6ff'};
  const review = editor.planMeshTint('wing',operation,{part:'panel'});
  assert.equal(review.report.changedCorners,4);
  assert.deepEqual(editor.editMeshTint('wing',operation,{part:'panel'}),review.report);
  const after = editor.snapshot();
  assert.deepEqual(after.tilesets,original.tilesets);
  for (const key of ['materials','bindings','bakes']) assert.deepEqual(after.topologyMeshes.wing[key],original.topologyMeshes.wing[key]);
  assert.equal(after.topologyMeshes.wing.attachments.revision,review.report.afterRevision);
  assert.equal(after.topologyMeshes.wing.shapeKeys.restRevision,review.report.afterRevision);
  const painted = ink.render(editor.build(),{...view,passes:['depth']});
  assert.notDeepEqual(before.rgb,painted.rgb);
  assert.deepEqual(before.passes.depth,painted.passes.depth);
  assert.throws(()=>editor.planMeshTint('wing',operation),/topology revision/);
  const corners = T.uv.select(review.document,{domain:'corners',ids:['east/1','east/3']});
  const erase = editor.editMeshTint('wing',{tool:'erase',selection:corners},{part:'panel'});
  assert.deepEqual(erase.changes.map(row=>row.corner),['east/1','east/3']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),after);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),original);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('preview and commit tint with exact native PNGs and reject a stale CLI receipt',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-mesh-tint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at = file=>path.join(dir,file);
  const save = (file,value)=>fs.writeFileSync(at(file),JSON.stringify(value));
  const base = ['mesh-topology','tint','source.json','request.json','--object','wing','--part','panel'];
  const invoke = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...base,...args],{cwd:dir,encoding:'utf8'}));
  save('source.json',scene());
  save('request.json',{tool:'paint',color:'#ff8762'});
  save('corners.json',T.uv.select(plain,{domain:'corners',ids:['west/0']}));
  const preview = invoke('--selection','corners.json','--preview','review');
  assert.equal(preview.changedCorners,1);
  assert(preview.native.changedPixels>0);
  const [before,after,diff] = preview.native.files.map(file=>PNG.raster(at('review/'+file)));
  assert.notDeepEqual(before.data,after.data);
  assert.equal(diff.data.filter((value,i)=>i%4===0 && value===250).length,preview.native.changedPixels);
  save('receipt.json',preview);
  assert.deepEqual(invoke('--selection','corners.json','--expect','receipt.json','--out','painted.json').changes,preview.changes);
  save('request.json',{tool:'erase',corner:'west/0'});
  const stale=spawnSync(process.execPath,[cli,...base,'--expect','receipt.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(stale.status,1);
  assert.equal(JSON.parse(stale.stdout).conflicts[0].code,'stale-preview');
  assert(!fs.existsSync(at('stale.json')));
});

test('WebGL uploads a tinted face between untinted draws and interpolates a single corner', {skip:!process.env.INK_TEST_CHROME},()=>{
  const result = require('../cli/look-webgl.js')({},fixture,(kit,mesh,backend)=>{
    const api = kit.KIT.meshTopology, doc=api.create(mesh());
    const world = source=>kit.makeBuilder(19,[0x112233]).finish({meshes:[api.toSceneMesh(source,{
      materials:[{id:'tile',color:0xdce7ce}]} )],radius:5,dither:0,cam:{target:[0,.7,0],dist:5,yaw:0,pitch:0,ortho:true}});
    const original=world(doc), tinted=world(api.planTint(doc,{tool:'paint',corner:'west/0',color:[1,.15,.12]}).document);
    const renderer=backend(100,64,{raw:true,dither:0}), coords={inside:[34,41],higher:[34,23],neighbor:[64,36]};
    try {
      const draw = scene=>{renderer.draw(scene); return renderer.sample(coords);};
      return {before:draw(original),after:draw(tinted),reset:draw(original)};
    } finally { renderer.close(); }
  });
  assert.deepEqual(result.before,result.reset);
  assert.deepEqual(result.before.neighbor,result.after.neighbor);
  assert(result.before.inside[1]>result.after.inside[1]+25,JSON.stringify(result));
  assert(result.after.higher[1]>result.after.inside[1]+15,JSON.stringify(result));
});

const blendPaint = {tool:'paint',face:'west',color:'#f04824',opacity:.25};
const mode = (doc,mode)=>plan(doc,{tool:'blend',mode}).document;
function blendCases() {
  const painted=plan(plain,blendPaint).document;
  const midpoint = color=>mode(plan(plain,{tool:'paint',face:'west',color}).document,'midpoint');
  return {
    plain,replace:mode(painted,'replace'),alpha:mode(painted,'alpha-blend'),
    transparent:mode(plan(plain,{...blendPaint,opacity:0}).document,'alpha-blend'),
    low:midpoint([.25,.25,.25]),neutral:midpoint([.5,.5,.5]),high:midpoint([.75,.75,.75]),
    gradient:mode(plan(plain,{tool:'paint',color:[1,1,1],corner:'west/0'}).document,'midpoint')
  };
}

function blendFixture(kit,documents) {
  const {KIT,makeBuilder}=kit;
  return Object.fromEntries(Object.entries(documents).map(([id,document])=>[id,
    makeBuilder(19,[0x112233]).finish({meshes:[KIT.meshTopology.toSceneMesh(document,{
      materials:[{id:'tile',color:0x6084b4}]
    })],radius:5,dither:0,cam:{target:[0,.7,0],dist:5,yaw:0,pitch:0,ortho:true}})]));
}

function checkBlendColors(samples) {
  const expected = {plain:[96,132,180],replace:[240,72,36],alpha:[132,117,144],transparent:[96,132,180],
    low:[48,66,90],neutral:[96,132,180],high:[176,194,218]};
  for (const [id,colors] of Object.entries(samples)) {
    assert.deepEqual(colors.neighbor.slice(0,3),expected.plain,id);
    if (id==='gradient') {
      assert(colors.inside[0]>colors.higher[0]+15,JSON.stringify(colors));
      assert(colors.higher[0]>=96,JSON.stringify(colors));
    } else colors.inside.slice(0,3).forEach((n,i)=>assert(Math.abs(n-expected[id][i])<=1,JSON.stringify({id,colors})));
  }
}

test('tint blend modes apply exact pigment math and retain cutout visibility',()=>{
  const documents=blendCases(), samples={};
  const worlds=blendFixture(ink.load(),documents), positions={inside:[34,41],higher:[34,23],neighbor:[64,36]};
  const original=ink.render(worlds.plain,{...view,passes:['depth']});
  for (const [id,world] of Object.entries(worlds)) {
    const frame=ink.render(world,{...view,passes:['depth']});
    assert.deepEqual(frame.passes.depth,original.passes.depth);
    samples[id]=Object.fromEntries(Object.entries(positions).map(([key,[x,y]])=>{
      const at=(y*view.w+x)*3;
      return [key,Array.from(frame.rgb.subarray(at,at+3))];
    }));
  }
  checkBlendColors(samples);
  assert.deepEqual(tint(documents.alpha,'west/0'),[240/255,72/255,36/255,.25]);
  assert.deepEqual(documents.alpha.faces,documents.replace.faces);
  assert.equal(mode(documents.alpha,'multiply').tintBlend,'multiply');
  assert.throws(()=>plan(plain,{...blendPaint,opacity:-.1}),/opacity/);
  assert.throws(()=>plan(plain,{tool:'blend',mode:'screen'}),/midpoint/);

  const editor=ink.createSceneEditor(scene());
  const before=editor.snapshot();
  const request={tool:'blend',mode:'alpha-blend'};
  const review=editor.planMeshTint('wing',request).report;
  assert.deepEqual(editor.editMeshTint('wing',request),review);
  const after=editor.snapshot(), row=after.topologyMeshes.wing;
  assert.equal(row.document.tintBlend,'alpha-blend');
  assert.equal(row.attachments.revision,review.afterRevision);
  assert.deepEqual(row.bakes,before.topologyMeshes.wing.bakes);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),before);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
  editor.editMeshTint('wing',{tool:'blend',mode:'multiply'});
  assert.equal(editor.meshTopology('wing').document.tintBlend,'multiply');
});

test('retain sparse replacement coverage when deriving subdivision corners',()=>{
  const sparse=plan(plain,{tool:'paint',color:[.8,.2,.6],opacity:.25,corner:'west/0'}).document;
  const replacement=T.subdivide(mode(sparse,'replace'));
  const replaceCorner=replacement.faces.flatMap(row=>row.corners).find(row=>row.attributes?.tintCoverage===.25);
  assert.equal(replacement.tintBlend,'replace');
  assert.deepEqual(replaceCorner.attributes.tint,[.8,.2,.6,.25]);
  const alpha=T.subdivide(mode(sparse,'alpha-blend'));
  assert(alpha.faces.some(row=>row.corners.some(row=>row.attributes?.tint?.[3]===.0625)));
  const midpoint=T.subdivide(mode(sparse,'midpoint'));
  assert(midpoint.faces.some(row=>row.corners.some(row=>Math.abs(row.attributes?.tint?.[0]-.575)<1e-9)));
});

test('WebGL evaluates each blend mode and neutral midpoint like the headless renderer', {skip:!process.env.INK_TEST_CHROME},()=>{
  const result=require('../cli/look-webgl.js')({},blendFixture,(kit,fixture,backend,documents)=>{
    const render=backend(100,64,{raw:true,dither:0});
    try {
      return {samples:Object.fromEntries(Object.entries(fixture(kit,documents)).map(([id,world])=>{
        render.draw(world);
        return [id,render.sample({inside:[34,41],higher:[34,23],neighbor:[64,36]})];
      }))};
    } finally { render.close(); }
  },blendCases());
  checkBlendColors(result.samples);
});

const sharedTint = '#e5965a', replacementTint = '#449ee6';
function remapScene() {
  const original=scene(), row=original.topologyMeshes.wing;
  const shared=plan(plain,{tool:'paint',face:'west',color:sharedTint,opacity:.55}).document;
  const colored=mode(shared,'alpha-blend');
  const linked={document:colored,materials:row.materials,bakes:row.bakes};
  const revised=T.edit(colored,{faces:[{...colored.faces[0],corners:colored.faces[0].corners.map((corner,i)=>i===0 ?
    {...corner,attributes:{...corner.attributes,tintCoverage:.4}} : corner)}]});
  original.topologyMeshes.wing={...linked,document:revised,part:'panel',bindings:row.bindings,
    attachments:T.attachments.create(revised,[])};
  original.prefabLibrary='library.json';
  original.instances={left:{prefab:'badge',transform:{translation:[-.8,0,.5]}},
    offscreen:{prefab:'badge',transform:{translation:[15,0,0]},meshOverrides:{
      face:{revision:2,base:T.revision(colored),mesh:linked}
    }}};
  return {original,prefabs:{badge:{revision:2,solids:{},usesTilesets:['paint'],topologyMeshes:{face:linked}}}};
}

test('find and remap shared scene tint through editable meshes and prefab placements in one undo',()=>{
  const {original,prefabs}=remapScene();
  const editor=ink.createSceneEditor(original,{env:{prefabs}}), old=editor.snapshot();
  const find=editor.planMeshTintRemap({from:sharedTint});
  assert.equal(find.matchedFaces,3);
  assert.equal(find.matchedCorners,12);
  assert.equal(find.changedCorners,0);
  assert.deepEqual(find.meshes.map(row=>row.object),['left.face','offscreen.face','wing']);
  assert(find.meshes.every(row=>row.faces[0].face==='west'));
  assert.deepEqual(editor.planMeshTintRemap({from:'#e6965a',tolerance:.004}).meshes,find.meshes);
  assert.equal(editor.planMeshTintRemap({from:'#e6965a'}).matchedFaces,0);
  const request={from:sharedTint,to:replacementTint};
  const preview=editor.planMeshTintRemap(request);
  assert.equal(preview.changedFaces,3);
  assert.equal(preview.changedCorners,12);
  assert.deepEqual(editor.snapshot(),old);
  assert.deepEqual(editor.editMeshTintRemap(request),preview);
  const current=editor.snapshot();
  assert.deepEqual(current.tilesets,old.tilesets);
  assert.equal(current.topologyMeshes.wing.document.tintBlend,'alpha-blend');
  assert.deepEqual(current.topologyMeshes.wing.bindings,old.topologyMeshes.wing.bindings);
  assert.equal(current.topologyMeshes.wing.document.faces[0].corners[0].attributes.tintCoverage,.4);
  assert.equal(current.topologyMeshes.wing.attachments.revision,preview.meshes.at(-1).afterRevision);
  const copied=current.instances.left.meshOverrides.face;
  assert.equal(copied.base,T.revision(prefabs.badge.topologyMeshes.face.document));
  assert.equal(copied.revision,2);
  assert.deepEqual(copied.mesh.document.faces[0].corners[0].attributes.tint,[68/255,158/255,230/255,.55]);
  assert.equal(editor.planMeshTintRemap({from:sharedTint}).matchedCorners,0);
  assert.equal(editor.planMeshTintRemap({from:replacementTint,to:replacementTint}).changedFaces,0);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),old);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),current);
  assert.equal(editor.build().topologyMeshes['left.face'].document.tintBlend,'alpha-blend');
});

test('CLI emits exact source pigment and tint views and guards a scene-wide remap receipt',t=>{
  const {original,prefabs}=remapScene(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-tint-remap-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run=(source,request,...args)=>JSON.parse(execFileSync(process.execPath,
    [cli,'mesh-topology','tint-remap',source,request,...args],{cwd:dir,encoding:'utf8'}));
  save('scene.json',original);
  save('library.json',prefabs);
  save('view.json',{w:100,h:64});
  save('request.json',{from:sharedTint,to:replacementTint});
  save('inspect.json',{});
  const report=run('scene.json','request.json','--view','view.json','--preview','review');
  save('receipt.json',report);
  assert.equal(report.changedFaces,3);
  assert(report.native.changedPixels>0);
  assert.deepEqual(report.native.files,['before.png','after.png','diff.png','texture-only.png','tint-before.png','tint-after.png']);
  assert.equal(run('scene.json','request.json','--expect','receipt.json','--out','remapped.json').changedCorners,12);
  const check=run('remapped.json','inspect.json','--view','view.json','--preview','inspected');
  assert.deepEqual(check.native.files,['texture-only.png','tint-only.png']);
  const pixels=name=>PNG.raster(file(name)).data;
  const color=pixels('review/texture-only.png'), tint=pixels('review/tint-before.png'), next=pixels('review/tint-after.png');
  assert.deepEqual(color,pixels('inspected/texture-only.png'));
  assert.deepEqual(next,pixels('inspected/tint-only.png'));
  assert.notDeepEqual(tint,next);
  const covered=[];
  for (let i=0;i<color.length;i+=4) {
    assert.equal(color[i+3],tint[i+3]);
    assert.equal(color[i+3],next[i+3]);
    if (color[i+3]) covered.push(i);
  }
  assert(covered.length>25 && covered.length<color.length/4);
  assert(covered.some(i=>[220,231,206].every((n,k)=>color[i+k]===n)));
  const stale=spawnSync(process.execPath,[cli,'mesh-topology','tint-remap','remapped.json','request.json',
    '--expect','receipt.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(stale.status,1);
  assert.equal(JSON.parse(stale.stdout).conflicts[0].code,'stale-preview');
  assert(!fs.existsSync(file('stale.json')));
});
