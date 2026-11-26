'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..'), PNG = require('../cli/png.js');
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const width=38,height=21;
const view = {w:180,h:96};
const stroke = {at:[97,49],object:'east',face:'plate',rgba:[239,143,83,255],view};

function fixture(indexed=false) {
  const scene = {id:'paint-face',style:'slate',solids:[],
    camera:{target:[0,.75,0],dist:8,yaw:0,pitch:0,projection:'orthographic'},
    tilesets:{enamel:indexed ?
      {version:1,width,height,encoding:'indexed8',data:Buffer.alloc(width*height).toString('base64'),palette:[0x476959]} :
      ink.createBlankTileset({width,height,background:'#476959'})}};
  const editor = ink.createSceneEditor(scene);
  const crop = x=>ink.pickTilesetRectangle(scene,'enamel',{x,y:3,width:15,height:15});
  for (const [object,x,selection,paint] of [
    ['west',-2.65,crop(3)],['east',-.75,crop(3),{rotation:90,flipX:true}],['spare',1.15,crop(20)]])
    editor.placeTilesetFace({object,face:'plate',selection,origin:[x,0,0],texelsPerUnit:10,paint});
  return JSON.parse(JSON.stringify(editor.snapshot()));
}

test('paint through the sampled oriented texel and preview other placements, including a prefab off camera',()=>{
  const scene = fixture();
  scene.prefabs = {relay:{revision:1,solids:{},topologyMeshes:{lamp:scene.topologyMeshes.west},usesTilesets:['enamel']}};
  scene.instances = {offscreen:{prefab:'relay',transform:{translation:[25,0,0]}}};
  const editor = ink.createSceneEditor(scene), {report,images} = ink.paintTilesetFace(editor,stroke);
  assert(report.canCommit,JSON.stringify(report.conflicts));
  assert.deepEqual(report.source.at,[9,6]);
  assert.equal(report.source.material,'tileset/enamel');
  assert.equal(report.changedTexels,1);
  assert.deepEqual(report.uses.map(row=>row.object).sort(),['east','offscreen.lamp','west']);
  assert.equal(report.uses.find(row=>row.object==='offscreen.lamp').visiblePixels,0);
  assert(report.uses.filter(row=>row.visiblePixels).every(row=>row.changedPixels>0));
  assert.deepEqual(report.prefabDependencies[0].instances,['offscreen']);
  assert.equal(images.diff.rgb.filter((n,i)=>i%3===0 && n).length,report.changedPixels);
  assert.deepEqual(editor.snapshot(),scene);

  const result = ink.paintTilesetFace(editor,stroke,{apply:true,expect:report.previewRevision});
  assert.deepEqual(result.report,report);
  const painted = editor.snapshot();
  const expected = Buffer.from(scene.tilesets.enamel.data,'base64');
  expected.set(stroke.rgba,(6*width+9)*4);
  assert.deepEqual(Buffer.from(painted.tilesets.enamel.data,'base64'),expected);
  assert.deepEqual(painted.topologyMeshes,scene.topologyMeshes);
  assert.equal(ink.paintTilesetFace(editor,stroke,{apply:true,expect:report.previewRevision}).report.conflicts[0].code,'stale-preview');
  assert.equal(ink.paintTilesetFace(editor,stroke).report.changedTexels,0);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),painted);
});

test('never paint through a foreground blocker or a filtered sample',()=>{
  const scene = fixture(true), editor = ink.createSceneEditor(scene);
  const minified = structuredClone(scene);
  minified.topologyMeshes.west.materials[0].mipmaps = true;
  const filteredEditor = ink.createSceneEditor(minified);
  const minimum = {at:[13,16],object:'west',face:'plate',rgba:stroke.rgba,view:{w:48,h:32}};
  const filtered = ink.paintTilesetFace(filteredEditor,minimum,{apply:true}).report;
  assert.equal(filtered.conflicts[0]?.code,'filtered-hit',JSON.stringify(filtered));
  assert.equal(filtered.front.paint.mode,'mip');
  assert.deepEqual(filteredEditor.snapshot(),minified);
  assert.equal(ink.paintTilesetFace(editor,{...stroke,at:[0,0],object:undefined,face:undefined}).report.conflicts[0].code,'no-visible-hit');
  const cover = structuredClone(scene.topologyMeshes.east);
  cover.document.vertices.forEach(row=>{row.position[2] += .5;});
  cover.materials = [{id:'tileset/enamel',color:0x344552}];
  cover.bindings = [];
  scene.topologyMeshes.cover = cover;
  const blocked = ink.createSceneEditor(scene);
  const result = ink.paintTilesetFace(blocked,stroke,{apply:true}).report;
  assert.equal(result.conflicts[0].code,'target-not-visible',JSON.stringify(result));
  assert.equal(result.front.object,'cover');
  assert.equal(ink.paintTilesetFace(blocked,{...stroke,object:undefined}).report.conflicts[0].code,'no-registered-tileset-hit');
  assert.deepEqual(blocked.snapshot(),scene);
});

test('preview an indexed write with matched PNGs and commit from its receipt through the CLI',t=>{
  const scene = fixture(true), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-face-paint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run = args=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'}));
  write('scene.json',scene);
  write('stroke.json',stroke);
  const args = ['tileset','paint','face','stroke.json','--scene','scene.json'];
  const preview = run([...args,'--preview','review']);
  assert(preview.canCommit,JSON.stringify(preview));
  assert.deepEqual(preview.samples,[{at:[9,6],before:0,after:1}]);
  assert.equal(preview.paletteAdded,1);
  const images = preview.files.map(name=>PNG.raster(file('review/'+name)));
  assert(images.every(({w,h})=>w===view.w && h===view.h));
  assert.notDeepEqual(images[0].data,images[1].data);
  write('receipt.json',preview);
  assert.deepEqual(run([...args,'--expect','receipt.json','--out','painted.json']).samples,preview.samples);
  const result = JSON.parse(fs.readFileSync(file('painted.json')));
  assert.deepEqual(result.tilesets.enamel.palette,[0x476959,0xef8f53]);
  const slots = Buffer.from(result.tilesets.enamel.data,'base64');
  assert.equal(slots[6*width+9],1);
  assert.equal(slots.filter(Boolean).length,1);
  write('stroke.json',{...stroke,rgba:[11,22,33,255]});
  const rejected = spawnSync(process.execPath,[cli,...args,'--expect','receipt.json','--out','stale.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).conflicts[0].code,'stale-preview');
  assert(!fs.existsSync(file('stale.json')));
});

test('paint a local indexed variant on one face while retaining same-mesh neighbors and undo',()=>{
  const base = fixture(true), setup = ink.createSceneEditor(base);
  setup.placeTilesetFace({object:'east',face:'nearby',
    selection:ink.pickTilesetRectangle(base,'enamel',{x:3,y:3,width:15,height:15}),
    origin:[1.15,0,.2],texelsPerUnit:10});
  const scene = structuredClone(setup.snapshot()), editor = ink.createSceneEditor(scene);
  const local = {...stroke,sharing:'make-local-variant',variant:'weathered-enamel'};
  const {report,images} = ink.paintTilesetFace(editor,local);
  assert(report.canCommit,JSON.stringify(report.conflicts));
  assert.deepEqual(report.uses.map(row=>[row.object,row.face]),[['east','plate']]);
  assert.deepEqual(report.sharedPaintUses.map(row=>[row.object,row.face]).sort(),[['east','nearby'],['west','plate']]);
  assert(report.sharedPaintUses.every(row=>row.changedPixels===0));
  assert.deepEqual(report.destination.at,[9,6]);
  assert.equal(report.changedTexels,1);
  assert.notDeepEqual(images.before.rgb,images.after.rgb);
  assert.deepEqual(editor.snapshot(),scene);

  const {report:shared} = ink.paintTilesetFace(editor,{...stroke,sharing:'edit-every-instance'});
  assert.deepEqual(shared.uses.map(row=>[row.object,row.face]).sort(),[['east','nearby'],['east','plate'],['west','plate']]);
  assert(shared.changedPixels>report.changedPixels);
  const blocked = ink.paintTilesetFace(editor,local,{apply:true,expect:shared.previewRevision});
  assert.equal(blocked.report.conflicts[0].code,'stale-preview');
  assert.deepEqual(ink.paintTilesetFace(editor,local,{apply:true,expect:report.previewRevision}).report,report);
  const after = editor.snapshot(), original = scene.topologyMeshes.east, edited = after.topologyMeshes.east;
  assert.deepEqual(after.tilesets.enamel,scene.tilesets.enamel);
  assert.deepEqual(after.tilesets['weathered-enamel'].palette,[0x476959,0xef8f53]);
  assert.deepEqual(edited.document.vertices,original.document.vertices);
  assert.deepEqual(edited.document.faces[0].corners,original.document.faces[0].corners);
  assert.deepEqual(edited.document.faces[1],original.document.faces[1]);
  assert.deepEqual(edited.bindings[0].data,{...original.bindings[0].data,
    selection:{...original.bindings[0].data.selection,tileset:'weathered-enamel'}});
  assert.deepEqual(edited.bindings[1],original.bindings[1]);
  assert.equal(ink.paintTilesetFace(editor,local).report.conflicts[0].reason,'variant-id-in-use');
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('isolate prefab instance paint and carry active finishes without revising the prefab',()=>{
  const scene = fixture(), mesh = scene.topologyMeshes.east;
  delete scene.topologyMeshes.east;
  mesh.bakes = [{id:'finish',material:mesh.materials[0].id,maps:{roughness:.35,texture:{tileset:'enamel'}}}];
  scene.prefabs = {relay:{revision:3,solids:{},topologyMeshes:{panel:mesh},usesTilesets:['enamel']}};
  scene.instances = {picked:{prefab:'relay'},twin:{prefab:'relay',transform:{translation:[30,0,0]}}};
  const editor = ink.createSceneEditor(scene);
  const request = {...stroke,object:'picked.panel',sharing:'make-local-variant',variant:'relay-local'};
  const {report} = ink.paintTilesetFace(editor,request,{apply:true});
  assert(report.canCommit,JSON.stringify(report.variantEdit));
  assert.deepEqual(report.variantEdit.prefab,{instance:'picked',member:'panel',id:'relay',revision:3});
  assert.equal(report.variantEdit.copiedFinish,'finish');
  assert(report.sharedPaintUses.some(row=>row.object==='twin.panel' && row.visiblePixels===0));
  const after = editor.snapshot(), override = after.instances.picked.meshOverrides.panel;
  assert.equal(override.revision,3);
  assert.deepEqual(override.mesh.bakes,mesh.bakes);
  assert.equal(override.mesh.materials.at(-1).roughness,.35);
  assert.deepEqual(after.prefabs,scene.prefabs);
  assert.deepEqual(after.instances.twin,scene.instances.twin);
  assert.deepEqual(after.tilesets.enamel,scene.tilesets.enamel);
  assert.deepEqual(editor.tilesetDependencies('relay-local').sheets[0].faces.map(row=>row.object),['picked.panel']);
  assert.equal(editor.planTilesetRevision({type:'remove',id:'relay-local'}).blockers[0].reason,'tileset-in-use');
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);

  const identical = ink.paintTilesetFace(editor,{...request,rgba:[71,105,89,255]},{apply:true}).report;
  assert(identical.canCommit,JSON.stringify(identical.conflicts));
  assert.equal(identical.changedTexels,0);
  assert.equal(identical.changedPixels,0);
  const dedup = editor.editTilesetRevision({type:'deduplicate',id:'relay-local',keepId:'enamel'});
  assert(dedup.canCommit);
  assert.equal(editor.snapshot().instances.picked.meshOverrides.panel.mesh.materials.at(-1).texture.tileset,'enamel');
  assert.equal(editor.snapshot().tilesets['relay-local'],undefined);
});

test('reject an instance-local paint slot that a modifier would duplicate',()=>{
  const scene = fixture();
  scene.topologyMeshes.east.modifiers = [{kind:'array',id:'repeat',count:2,step:[30,0,0]}];
  const editor = ink.createSceneEditor(scene);
  const {report} = ink.paintTilesetFace(editor,{...stroke,sharing:'make-local-variant',variant:'unique-sign'},{apply:true});
  assert.equal(report.conflicts[0]?.reason,'variant-affects-derived-faces',JSON.stringify(report.variantEdit));
  assert(report.variantEdit.faces.length>=2);
  assert.deepEqual(editor.snapshot(),scene);
});

test('use bound pencil, eraser, and pigment eyedropper with independent alpha and exact indexed slots',()=>{
  const scene = fixture(true), image = scene.tilesets.enamel, i = 6*width+9;
  const indices = Buffer.from(image.data,'base64');
  indices[i] = indices[i+1] = 1;
  Object.assign(image,{data:indices.toString('base64'),palette:[0x476959,0x476959,0x224466],alpha:[219,219,0]});
  scene.topologyMeshes.east.materials[0].color = 0x888888;
  const editor = ink.createSceneEditor(scene), {rgba,...target} = stroke;
  const run = (op,options)=>ink.paintTilesetFace(editor,{...target,...op},options).report;
  const color = run({tool:'eyedropper',sample:'color'});
  assert.equal(color.sampled,true);
  assert.equal(color.canCommit,false);
  assert.deepEqual(color.sample,{mode:'color',at:[9,6],uv:color.source.uv,units:'rgb-hex',value:'#476959',
    rgba:[71,105,89,219],paletteSlot:1,provenance:{kind:'tileset',id:'enamel'}});
  assert.equal(run({tool:'eyedropper',sample:'alpha'}).sample.value,219);
  assert.deepEqual(run({tool:'eyedropper',sample:'source',channel:'pigment'}).sample.value,[71,105,89,219]);
  assert.throws(()=>run({tool:'eyedropper',sample:'color'},{apply:true}),/reads a source/);
  assert.deepEqual(editor.snapshot(),scene);

  const pigment = run({tool:'pencil',color:'#B35B2E'});
  assert.deepEqual(pigment.rgba,[179,91,46,219]);
  assert.equal(run({tool:'pencil',color:'#b35b2e'},{apply:true,expect:pigment.previewRevision}).changedTexels,1);
  assert.equal(run({tool:'eyedropper',sample:'alpha'}).sample.value,219);
  const opacity = run({tool:'pencil',alpha:151},{apply:true});
  assert.deepEqual(opacity.rgba,[179,91,46,151]);
  assert.equal(run({tool:'eyedropper',sample:'color'}).sample.value,'#b35b2e');
  assert.equal(run({tool:'eyedropper',sample:'alpha'}).sample.value,151);
  assert(editor.undo());
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);

  const exact = run({tool:'pencil',slot:0},{apply:true});
  assert.equal(exact.changedPixels,0);
  assert.deepEqual(exact.samples,[{at:[9,6],before:1,after:0}]);
  assert.equal(run({tool:'eyedropper',sample:'color'}).sample.paletteSlot,0);
  assert.equal(run({tool:'pencil',slot:3}).conflicts[0].code,'palette-slot-unavailable');
  assert(editor.undo());

  const transparentBlack = run({tool:'pencil',color:'#000000',alpha:0},{apply:true});
  assert.equal(transparentBlack.paletteAdded,1);
  assert.deepEqual(transparentBlack.samples,[{at:[9,6],before:1,after:3}]);
  assert.equal(editor.snapshot().tilesets.enamel.palette[3],0);
  assert.equal(editor.snapshot().tilesets.enamel.alpha[3],0);
  assert(editor.undo());

  const eraser = {tool:'eraser',sharing:'make-local-variant',variant:'east-cutout'};
  const preview = run(eraser);
  assert.equal(preview.tool,'eraser');
  assert(preview.changedPixels>0);
  assert.deepEqual(preview.uses.map(row=>row.object),['east']);
  assert.deepEqual(preview.samples,[{at:[9,6],before:1,after:2}]);
  assert.equal(preview.paletteAdded,0);
  assert.equal(run({...eraser,variant:'other-cutout'},{apply:true,expect:preview.previewRevision}).conflicts[0].code,'stale-preview');
  assert.deepEqual(run(eraser,{apply:true,expect:preview.previewRevision}),preview);
  const after = editor.snapshot(), copy = after.tilesets['east-cutout'];
  assert.deepEqual(after.tilesets.enamel,image);
  assert.deepEqual([...Buffer.from(copy.data,'base64').subarray(i,i+2)],[2,1]);
  assert.deepEqual(copy.alpha,image.alpha);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
});

test('read registered source channels by their own UV sets and report a missing map',()=>{
  const scene = fixture(), row = scene.topologyMeshes.east;
  const {id:material} = row.materials[0];
  row.document.uvBindings = {normal:2,metallicRoughness:3,emission:4};
  for (const corner of row.document.faces[0].corners) corner.attributes =
    {'uv/2':[1,0],'uv/3':[0,1],'uv/4':[.25,.25]};
  const pixels = width*height, normal = Array.from({length:pixels},()=>[128,128,255,255]).flat();
  normal.splice((width-1)*4,4,154,96,230,192);
  const metalness = Array(pixels).fill(0);
  metalness[(height-1)*width] = 178;
  const emission = Array(pixels*3).fill(0);
  emission.splice((5*width+9)*3,3,16,44,71);
  row.materials[0] = {...row.materials[0],normal,metalness,emission};
  row.bakes = [{id:'finish',material,maps:{roughness:.37}}];
  const editor = ink.createSceneEditor(scene), {rgba,...target} = stroke;
  const read = channel=>ink.paintTilesetFace(editor,{...target,tool:'eyedropper',sample:'source',channel}).report;
  const n = read('normal');
  assert(n.sampled,JSON.stringify(n));
  assert.deepEqual(n.source.at,[9,6]);
  assert.equal(n.sample.uvSet,2);
  assert.deepEqual(n.sample.at,[37,0]);
  assert.deepEqual(n.sample.value,[154,96,230,192]);
  const m = read('metalness').sample;
  assert.deepEqual([m.uvSet,m.at,m.byte,m.value],[3,[0,20],178,178/255]);
  const e = read('emission').sample;
  assert.deepEqual([e.uvSet,e.at,e.units,e.value],[4,[9,5],'rgb8',[16,44,71]]);
  const r = read('roughness').sample;
  assert.deepEqual([r.value,r.units,r.provenance],[.37,'unit',{kind:'material-bake',bake:'finish'}]);
  assert.deepEqual(editor.snapshot(),scene);

  const missing = ink.paintTilesetFace(ink.createSceneEditor(fixture()),{...target,tool:'eyedropper',sample:'source',channel:'normal'}).report;
  assert.equal(missing.sampled,false);
  assert.equal(missing.conflicts[0].code,'missing-source-channel');
});

test('sample bound color through the CLI and feed it into a different face pencil',t=>{
  const scene = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-bound-tile-tools-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run = args=>execFileSync(process.execPath,[cli,'tileset','paint','face',...args,'--scene','scene.json'],{cwd:dir,encoding:'utf8'});
  write('scene.json',scene);
  const {rgba,...target} = stroke;
  write('pick.json',{...target,tool:'eyedropper',sample:'color'});
  const report = JSON.parse(run(['pick.json']));
  assert.equal(report.sample.value,'#476959');
  write('pencil.json',{...target,object:'west',at:[62,46],tool:'pencil',color:report.sample.value,alpha:175});
  const committed = JSON.parse(run(['pencil.json','--out','painted.json']));
  assert.deepEqual(committed.rgba,[71,105,89,175]);
  assert.equal(committed.changedTexels,1);
  const reject = spawnSync(process.execPath,[cli,'tileset','paint','face','pick.json','--scene','scene.json','--out','blocked.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(reject.status,1);
  assert(!fs.existsSync(file('blocked.json')));
});

function fillFixture() {
  const scene = fixture(true);
  const cells = new Uint8Array(width*height);
  for (const [x,y,slot] of [[8,6,2],[9,6,1],[9,7,1],[10,8,1],[15,13,1],[16,13,2],[18,6,1],[20,6,1],[10,6,3]])
    cells[y*width+x] = slot;
  scene.tilesets.enamel = {...scene.tilesets.enamel,data:Buffer.from(cells).toString('base64'),
    palette:[0x263d49,0x769780,0x769780,0x789881],alpha:[255,255,255,253]};
  const editor = ink.createSceneEditor(scene);
  const mount = (object,x,y)=>editor.placeTilesetFace({object,face:'window',origin:[20,0,0],worldSize:[1,1],
    selection:ink.pickTilesetRectangle(scene,'enamel',{x,y,width:1,height:1})});
  mount('offscreen-match',16,13);
  mount('offscreen-held',15,13);
  return structuredClone(editor.snapshot());
}

test('fill four-connected color through the exact bound tile and reuse the wand tolerance',()=>{
  const scene = fillFixture(), editor = ink.createSceneEditor(scene);
  const {rgba,...hit} = stroke, request = {...hit,tool:'fill',fill:{colors:[{color:'#ffab57'}]}};
  const {report,images} = ink.paintTilesetFace(editor,request);
  assert(report.canCommit,JSON.stringify(report.conflicts));
  assert.deepEqual(report.fill.rect,[3,3,15,15]);
  assert.equal(report.fill.selectedTexels,3);
  assert.deepEqual(report.samples.map(row=>row.at),[[8,6],[9,6],[9,7]]);
  assert.deepEqual(report.uses.map(use=>use.object).sort(),['east','west']);
  assert.equal(images.texels.rgb.filter((n,i)=>i%3===0 && n).length,3);
  assert.deepEqual(editor.snapshot(),scene);
  const close = {...request,fill:{...request.fill,tolerance:2}};
  const expanded = ink.paintTilesetFace(editor,close).report;
  assert.equal(expanded.fill.selectedTexels,4);
  assert.deepEqual(expanded.samples.map(row=>row.at),[[8,6],[9,6],[10,6],[9,7]]);
  assert.equal(ink.paintTilesetFace(editor,close,{apply:true,expect:report.previewRevision}).report.conflicts[0].code,'stale-preview');
  assert.deepEqual(ink.paintTilesetFace(editor,request,{apply:true,expect:report.previewRevision}).report,report);
  const slots = Buffer.from(editor.snapshot().tilesets.enamel.data,'base64');
  assert.equal(slots[8*width+10],1);
  assert.equal(slots[6*width+18],1);
  assert.equal(slots[6*width+20],1);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
});

test('fill disconnected matches with an atlas-aligned checker and trace only the changed footprint',()=>{
  const scene = fillFixture(), editor = ink.createSceneEditor(scene), {rgba,...hit} = stroke;
  const request = {...hit,tool:'fill',fill:{area:'matching-color',pattern:'checker',size:1,
    colors:[{slot:1},{color:'#eb9c57',alpha:192}]}};
  const {report,images} = ink.paintTilesetFace(editor,request);
  assert(report.canCommit,JSON.stringify(report.conflicts));
  assert.equal(report.fill.selectedTexels,6);
  assert.deepEqual(report.samples.map(row=>row.at),[[8,6],[9,6],[16,13]]);
  assert.deepEqual(report.uses.map(row=>row.object).sort(),['east','offscreen-match','west']);
  assert.equal(images.texels.rgb.filter((n,i)=>i%3===0 && n===250).length,3);
  assert.equal(images.texels.rgb.filter((n,i)=>i%3===0 && n===111).length,3);
  assert.equal(report.uses.find(use=>use.object==='offscreen-match').visiblePixels,0);
  const local = {...request,sharing:'make-local-variant',variant:'checker-east'};
  const commit = ink.paintTilesetFace(editor,local,{apply:true}).report;
  assert(commit.canCommit,JSON.stringify(commit.conflicts));
  assert.deepEqual(commit.uses.map(row=>row.object),['east']);
  assert.deepEqual(commit.sharedPaintUses.map(row=>row.object).sort(),['offscreen-match','west']);
  const after = editor.snapshot(), variant = after.tilesets['checker-east'];
  assert.deepEqual(after.tilesets.enamel,scene.tilesets.enamel);
  const slots = Buffer.from(variant.data,'base64');
  assert.deepEqual([[8,6],[9,6],[9,7],[10,8],[15,13],[16,13]].map(([x,y])=>slots[y*width+x]),[1,4,1,1,1,4]);
  assert.equal(variant.alpha[4],192);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
});

test('limit matching fill to a nonrectangular polygon UV footprint',()=>{
  const scene = fixture(), doc = scene.topologyMeshes.east.document, viewFace = doc.faces[0];
  const removed = viewFace.corners.pop().uv.map((n,i)=>Math.round(n*[width-1,height-1][i]));
  delete doc.edges;
  const editor = ink.createSceneEditor(scene), {rgba,...hit} = stroke;
  const {report} = ink.paintTilesetFace(editor,{...hit,tool:'fill',fill:{area:'matching-color',colors:[{color:'#ffab57'}]}},{apply:true});
  assert(report.canCommit,JSON.stringify(report.conflicts));
  assert(report.fill.selectedTexels>0 && report.fill.selectedTexels<15*15);
  const at = (removed[1]*width+removed[0])*4;
  const bytes = Buffer.from(editor.snapshot().tilesets.enamel.data,'base64');
  assert.deepEqual([...bytes.subarray(at,at+4)],[71,105,89,255]);
});

test('leave the atlas and local binding intact if a checker exceeds the indexed palette',()=>{
  const scene = fillFixture(), asset = scene.tilesets.enamel;
  asset.palette.push(...Array.from({length:251},(_,i)=>i));
  const editor = ink.createSceneEditor(scene), {rgba,...hit} = stroke;
  const {report} = ink.paintTilesetFace(editor,{...hit,tool:'fill',sharing:'make-local-variant',variant:'full-checker',
    fill:{pattern:'checker',colors:[{color:'#ea572d'},{color:'#ffa87d'}]}},{apply:true});
  assert.equal(report.conflicts[0].code,'indexed-palette-full');
  assert.deepEqual(editor.snapshot(),scene);
});

test('spray replays its seed and clips the same atlas pattern to the active selection',()=>{
  const scene = fixture(), {rgba,...hit} = stroke, editor = ink.createSceneEditor(scene);
  const op = {...hit,tool:'spray',color:'#f1ab65',spray:{seed:30419,radius:6,density:.9}};
  const selection = {type:'rectangle',rect:[6,4,8,6]};
  const clipped = {...op,selection}, run = options=>ink.paintTilesetFace(editor,clipped,options);
  const first = run(), again = run();
  assert(first.report.canCommit,JSON.stringify(first.report.conflicts));
  assert.equal(first.report.stroke.selectedTexels,48);
  assert.equal(first.report.stroke.spray.seed,30419);
  assert(first.report.changedTexels>0 && first.report.changedTexels<48);
  assert.deepEqual(again.report,first.report);
  assert.deepEqual(again.images.texels.rgb,first.images.texels.rgb);
  const other = {...clipped,spray:{...op.spray,seed:30420}};
  assert.notDeepEqual(ink.paintTilesetFace(editor,other).images.texels.rgb,first.images.texels.rgb);
  assert.equal(ink.paintTilesetFace(editor,other,{apply:true,expect:first.report.previewRevision}).report.conflicts[0].code,'stale-preview');
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(run({apply:true,expect:first.report.previewRevision}).report,first.report);

  const full = ink.createSceneEditor(scene);
  ink.paintTilesetFace(full,op,{apply:true});
  const original = Buffer.from(scene.tilesets.enamel.data,'base64');
  const wide = Buffer.from(full.snapshot().tilesets.enamel.data,'base64');
  const narrow = Buffer.from(editor.snapshot().tilesets.enamel.data,'base64');
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const offset = (y*width+x)*4, inside = x>=6 && x<14 && y>=4 && y<10;
    assert.equal(narrow.readUInt32BE(offset),(inside ? wide : original).readUInt32BE(offset));
  }
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
});

test('dither uses native atlas ranks and carries a seeded blue-noise pattern across a clipped selection',()=>{
  const scene = fixture(true), editor = ink.createSceneEditor(scene), {rgba,...hit} = stroke;
  const colors = [{slot:0},{color:'#ffc968',alpha:230}];
  const bayer = {...hit,tool:'dither',dither:{colors,mix:.5,seed:0},
    selection:{type:'subtract',base:{type:'rectangle',rect:[7,4,4,4]},with:{type:'pixels',pixels:[[8,5]]}}};
  const {report} = ink.paintTilesetFace(editor,bayer,{apply:true});
  assert(report.canCommit,JSON.stringify(report.conflicts));
  assert.equal(report.stroke.selectedTexels,15);
  const {bayerRank} = require('../src/pixel-look.js');
  const bytes = Buffer.from(editor.snapshot().tilesets.enamel.data,'base64');
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const inside = x>=7 && x<11 && y>=4 && y<8 && (x!==8 || y!==5);
    assert.equal(bytes[y*width+x],Number(inside && bayerRank(x,y)<.5));
  }
  assert(editor.undo());
  const blue = {...bayer,sharing:'make-local-variant',variant:'ink-blue-noise',
    dither:{...bayer.dither,pattern:'blue-noise',seed:331},selection:{type:'rectangle',rect:[3,3,15,15]}};
  const first = ink.paintTilesetFace(editor,blue);
  assert(first.report.canCommit,JSON.stringify(first.report.conflicts));
  assert.equal(first.report.stroke.dither.seed,331);
  assert.deepEqual(ink.paintTilesetFace(editor,blue).images.texels.rgb,first.images.texels.rgb);
  const changed = ink.paintTilesetFace(editor,{...blue,dither:{...blue.dither,seed:332}});
  assert.notDeepEqual(changed.images.texels.rgb,first.images.texels.rgb);
  const local = ink.paintTilesetFace(editor,blue,{apply:true,expect:first.report.previewRevision}).report;
  assert.deepEqual(local.uses.map(row=>row.object),['east']);
  assert.deepEqual(editor.snapshot().tilesets.enamel,scene.tilesets.enamel);
  assert.equal(editor.snapshot().tilesets['ink-blue-noise'].alpha[1],230);
});

test('mirror a pencil dab through crop-local saved pixels without painting the excluded corner',t=>{
  const scene = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-bound-mirror-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run = args=>JSON.parse(execFileSync(process.execPath,[cli,'tileset','paint','face','stroke.json','--scene','scene.json',...args],
    {cwd:dir,encoding:'utf8'}));
  write('scene.json',scene);
  write('stroke.json',{...stroke,drawing:{mirrorX:10.5,mirrorY:7}});
  write('selection.json',{grid:[6,5],origin:[8,5],pixels:[[1,1],[4,1],[1,3]]});
  const review = run(['--selection','selection.json','--preview','review']);
  assert(review.canCommit,JSON.stringify(review.conflicts));
  assert.equal(review.stroke.candidateTexels,3);
  assert.deepEqual(review.samples.map(row=>row.at),[[9,6],[12,6],[9,8]]);
  assert.deepEqual(review.files,['before.png','after.png','diff.png','texels.png']);
  write('receipt.json',review);
  assert.equal(run(['--selection','selection.json','--expect','receipt.json','--out','painted.json']).changedTexels,3);
  const painted = JSON.parse(fs.readFileSync(file('painted.json'))), bytes = Buffer.from(painted.tilesets.enamel.data,'base64');
  assert.deepEqual([...bytes.subarray((8*width+12)*4,(8*width+13)*4)],[71,105,89,255]);
});
