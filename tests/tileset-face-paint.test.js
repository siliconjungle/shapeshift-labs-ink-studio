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
