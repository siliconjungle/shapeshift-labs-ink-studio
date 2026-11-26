'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..'), Render = require('../cli/render.js');
const cli = path.join(__dirname,'../cli/ink-studio.js');

const palette = {format:'ink-studio/pixel-palette',version:1,swatches:[
  {id:'glaze',label:'Jade glaze',color:'#47877d',locked:true},
  {id:'shadow',label:'Pool shadow',color:'#243847'},
  {id:'glaze-alias',label:'Glaze variant',color:'#47877d'},
  {id:'faded',label:'Faded glaze',color:'#47877d'},
  {id:'signal',label:'Signal amber',color:'#e6ae65'}
],ramps:[{id:'finish',label:'Glaze ramp',swatches:['shadow','glaze-alias','signal']}]};
const asset = {version:1,width:4,height:2,encoding:'indexed8',data:Buffer.from([0,1,2,3,3,2,1,0]).toString('base64'),
  palette:[0x243847,0x47877d,0x47877d,0x47877d],alpha:[255,255,255,152]};
const scene = {id:'enamel-palette',style:'slate',solids:[],tilesets:{enamel:asset},
  camera:{target:[0,.55,0],yaw:0,pitch:0,dist:5,projection:'orthographic'}};
const importPalette = {type:'import',palette};
const view = {w:100,h:60,px:1};
const inspect = editor=>ink.inspectTilesetPalette(editor,'enamel');
const edit = (editor,operation,options)=>ink.editTilesetPalette(editor,'enamel',operation,options);

function placed() {
  const editor = ink.createSceneEditor(scene);
  const selection = ink.pickTilesetRectangle(scene,'enamel',{x:0,y:0,width:4,height:2});
  editor.placeTilesetFace({object:'wall',face:'sign',selection,origin:[-1,0,0],worldSize:[2,1]});
  const placed = structuredClone(editor.snapshot()), material = placed.topologyMeshes.wall.materials[0].id;
  placed.topologyMeshes.wall.bakes = [{id:'finish',material,maps:{roughness:.43}}];
  return placed;
}

test('adopt named palette colors, reorder indices and consolidate exact aliases without changing bakes or rendered paint',()=>{
  const before = placed(), editor = ink.createSceneEditor(before);
  const rgb = Render.render(editor.build(),view).rgb;
  const preview = edit(editor,importPalette);
  assert(preview.canCommit,JSON.stringify(preview));
  assert.deepEqual(preview.added,['signal']);
  assert.deepEqual(preview.slots.map(row=>[row.to,row.swatch]),[[1,'shadow'],[0,'glaze'],[2,'glaze-alias'],[3,'faded']]);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(edit(editor,importPalette,{apply:true,expect:preview.previewRevision}),preview);
  const named = inspect(editor);
  assert.deepEqual(named.swatches.map(row=>[row.id,row.texels,row.alpha]),
    [['glaze',2,255],['shadow',2,255],['glaze-alias',2,255],['faded',2,152],['signal',0,255]]);
  assert.deepEqual(named.ramps,palette.ramps);
  assert.deepEqual(named.duplicates,[{rgba:'#47877dff',ids:['glaze','glaze-alias']}]);
  assert.deepEqual(named.alphaVariants,[{color:'#47877d',variants:[
    {alpha:255,ids:['glaze','glaze-alias']},{alpha:152,ids:['faded']}
  ]}]);
  assert.throws(()=>edit(editor,{type:'consolidate',map:{faded:'glaze'}},{apply:true}),/differ in RGB or alpha/);
  assert.throws(()=>edit(editor,{type:'consolidate',map:{glaze:'glaze-alias'}},{apply:true}),/locked/);

  const reorder = {type:'reorder',order:['signal','faded','glaze-alias','shadow','glaze']};
  const reordered = edit(editor,reorder,{apply:true});
  assert(reordered.canCommit);
  assert.equal(reordered.changedIndices,6);
  assert.deepEqual(inspect(editor).swatches.map(row=>row.id),reorder.order);
  const intermediate = editor.snapshot();
  const merge = {type:'consolidate',map:{'glaze-alias':'glaze'}};
  const review = edit(editor,merge);
  assert.deepEqual(review.removed,['glaze-alias']);
  assert.deepEqual(edit(editor,merge,{apply:true,expect:reordered.previewRevision}).blockers,[{reason:'stale-preview'}]);
  assert.deepEqual(edit(editor,merge,{apply:true,expect:review.previewRevision}),review);
  assert.deepEqual(inspect(editor).swatches.map(row=>[row.id,row.texels,row.alpha]),
    [['signal',0,255],['faded',2,152],['shadow',2,255],['glaze',4,255]]);
  assert.deepEqual(inspect(editor).ramps[0].swatches,['shadow','glaze','signal']);
  assert.equal(inspect(editor).duplicates.length,0);
  assert.deepEqual(editor.snapshot().topologyMeshes,before.topologyMeshes);
  assert.deepEqual(Render.render(editor.build(),view).rgb,rgb);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),intermediate);
  assert(editor.redo());
  assert.deepEqual(Render.render(editor.build(),view).rgb,rgb);
});

test('reuse retained palette labels for crop paint and address a named slot through a bound face',()=>{
  const editor = ink.createSceneEditor(placed());
  edit(editor,importPalette,{apply:true});
  const {document,binding} = ink.openTilesetPaint(editor,{tileset:'enamel'});
  assert.deepEqual(Object.keys(document.palette),palette.swatches.map(row=>row.id));
  assert.deepEqual(document.palette.glaze,{color:'#47877d',label:'Jade glaze',locked:true});
  assert.deepEqual(document.ramps,palette.ramps);
  assert.equal(ink.writeTilesetPaint(editor,binding,document).changedTexels,0);
  const pixels = ink.createPixelEditor(document);
  pixels.apply({id:'paint-signal',frame:'artwork',revision:pixels.describe().revision,
    operation:{tool:'pencil',layer:'image',points:[[0,0]],swatch:'signal'}});
  assert.equal(ink.writeTilesetPaint(editor,binding,pixels.snapshot(),{apply:true}).changedTexels,1);
  assert.equal(inspect(editor).swatches.find(row=>row.id==='signal').texels,1);

  const hit = {at:[50,30],view:{w:100,h:60},object:'wall',face:'sign'};
  const paint = ink.paintTilesetFace(editor,{...hit,slot:'signal'},{apply:true}).report;
  assert(paint.canCommit,JSON.stringify(paint));
  assert.equal(paint.changedTexels,1);
  const sample = ink.paintTilesetFace(editor,{...hit,tool:'eyedropper',sample:'color'}).report;
  assert.equal(sample.sample.swatchId,'signal');
  const rgba = ink.paintTilesetFace(editor,{...hit,rgba:[1,2,3,230]},{apply:true}).report;
  assert(rgba.canCommit,JSON.stringify(rgba));
  assert.equal(inspect(editor).swatches.at(-1).color,'#010203');
  assert.equal(inspect(editor).ramps.length,1);
});

test('CLI round-trips supported formats and guards edits with a palette receipt',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-named-tile-palette-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run = (args,source='original.json')=>JSON.parse(execFileSync(process.execPath,
    [cli,'tileset','palette',...args,'--scene',source,'--id','enamel'],{cwd:dir,encoding:'utf8'}));
  write('original.json',scene);
  write('named.json',palette);
  const preview = run(['import','named.json']);
  write('review.json',preview);
  assert.deepEqual(run(['import','named.json','--expect','review.json','--out','named-scene.json']),preview);
  for (const format of ['json','gpl','pal','hex']) {
    const out = 'export.'+format;
    const result = run(['export','--out',out],'named-scene.json');
    assert(result.losses.includes('alpha'));
    if (format==='json') {
      assert.deepEqual(result.losses,['alpha']);
      assert.deepEqual(JSON.parse(fs.readFileSync(file(out))),palette);
      continue;
    }
    assert.equal(result.losses.includes('labels'),format!=='gpl');
    assert(run(['import',out,'--out','from-'+format+'.json']).canCommit);
    const imported = run(['inspect'],'from-'+format+'.json');
    assert.deepEqual(imported.swatches.map(row=>row.color),palette.swatches.map(row=>row.color));
    if (format==='gpl') assert.deepEqual(imported.swatches.map(row=>row.label),palette.swatches.map(row=>row.label));
  }
  const result = spawnSync(process.execPath,[cli,'tileset','palette','import','named.json','--scene','named-scene.json',
    '--id','enamel','--expect','review.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.equal(JSON.parse(result.stdout).blockers[0].reason,'stale-preview');
  assert(!fs.existsSync(file('stale.json')));
});

test('index an RGBA tileset only when it fits exactly and preserve names through extraction and indexed canvas padding',()=>{
  const raw = Buffer.from([36,56,71,255,71,135,125,255,36,56,71,255,9,16,7,0]);
  const rgba = {version:1,width:2,height:2,encoding:'rgba8',data:raw.toString('base64')};
  const editor = ink.createSceneEditor({...scene,tilesets:{enamel:rgba}});
  const applied = edit(editor,importPalette,{apply:true});
  assert(applied.canCommit,JSON.stringify(applied));
  assert.deepEqual(applied.encoding,{before:'rgba8',after:'indexed8'});
  const registry = spec=>ink.load().KIT.authoring.tilesets.prepare(spec.tilesets,spec.tilesetDefaults);
  assert.deepEqual(Buffer.from(registry(editor.snapshot()).resolve({tileset:'enamel'}).pixels),raw);
  const copy = ink.load().KIT.authoring.tilesets.extract(editor.snapshot(),'enamel','crop',{x:0,y:0,width:1,height:1});
  assert.deepEqual(copy.tilesets.crop.paletteMetadata,editor.snapshot().tilesets.enamel.paletteMetadata);

  const {alpha,...prepared} = editor.snapshot().tilesets.enamel;
  const opaque = {...prepared,data:Buffer.from([0,1,0,1]).toString('base64')};
  const canvas = ink.createSceneEditor({...scene,tilesets:{enamel:opaque}});
  const resized = canvas.transformTilesetCanvas('enamel',{type:'resize',size:[3,3]});
  assert(resized.canCommit);
  assert.deepEqual(inspect(canvas).swatches.slice(0,-1).map(row=>row.id),opaque.paletteMetadata.swatchIds);
  assert.equal(inspect(canvas).swatches.at(-1).alpha,0);

  const many = Buffer.alloc(257*4);
  for (let i=0;i<257;i++) many.writeUInt32BE(i*256+255,i*4);
  const large = {...scene,tilesets:{enamel:{...rgba,width:257,height:1,data:many.toString('base64')}}};
  const limited = ink.createSceneEditor(large);
  assert.equal(inspect(limited).canEdit,false);
  assert.deepEqual(edit(limited,importPalette,{apply:true}).blockers,[{reason:'too-many-exact-colors',limit:256}]);
  assert.deepEqual(limited.snapshot(),large);
});
