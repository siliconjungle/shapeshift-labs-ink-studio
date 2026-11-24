const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const palette = { blue:'#0000ff',red:'#ff0000',white:'#ffffff',green:'#00ff00' };
const cel = (slots,marks = [])=>({ slots,marks });
const document = {
  format:'ink-studio/pixel-art',version:2,width:3,height:1,pixelAspect:[1,1],palette,
  layers:[
    { id:'back' },{ id:'group',kind:'group',opacity:.5 },
    { id:'under',parent:'group' },{ id:'coat',kind:'paint',parent:'group' },
    { id:'cut',kind:'mask',parent:'group' },{ id:'white',parent:'group',clip:'cut' },
    { id:'guide',kind:'reference' }
  ],
  frames:[{ id:'front',durationMs:125,cels:{
    back:cel(['blue','blue','blue']),under:cel(['white',null,null]),coat:cel(['red',null,null]),
    cut:cel([null,'white',null],[{ alpha:128,runs:[[0,1,1]] }]),
    white:cel([null,'white',null]),guide:cel([null,null,'green'])
  } }]
};
const request = (editor,operation,id = operation.type)=>({
  id,destination:'layers',revision:editor.describe().revision,operation
});
const edit = (editor,operation)=>editor.apply(request(editor,operation));
const rgba = (editor,frame)=>[...PNG.raster(editor.png({ frame,colorMode:'rgba' })).data];

test('groups isolate opacity, masks clip by coverage, and references stay in working views', () => {
  const editor = ink.createPixelEditor(document);
  assert.deepEqual(rgba(editor),[128,0,127,255, 64,64,255,255, 0,0,255,255]);
  assert.equal(editor.sample([0,0]).layer,'coat');
  assert.equal(editor.sample([1,0],{ mode:'layer',layer:'cut' }).alpha,128);
  assert.equal(editor.sample([1,0],{ mode:'layer',layer:'white' }).clipped,false);
  assert.equal(editor.sample([2,0]).swatch,'blue');
  const working = editor.stamp({ references:true });
  assert.equal(working.swatchIds[working.slots[2]],'green');

  const hide = request(editor,{ type:'update',layer:'cut',changes:{ visible:false } });
  const preview = editor.previewEdit(hide);
  assert.equal(preview.targets[0].after.find(row=>row.id === 'cut').visible,false);
  assert.equal(preview.pixelCount,1);
  assert.equal(editor.snapshot().layers[4].visible,undefined);
  editor.apply(hide);
  assert.deepEqual(rgba(editor).slice(4,8),[0,0,255,255]);
  assert.equal(editor.sample([1,0],{ mode:'layer',layer:'white' }).clipped,true);
  editor.undo();
  assert.deepEqual(editor.snapshot(),document);
});

test('blend modes use straight alpha and the backdrop color', () => {
  const art = { ...document,palette:{ a:'#804020',b:'#4080ff' },
    layers:[{ id:'rear' },{ id:'front' }],frames:[{ id:'paint',durationMs:100,
      cels:{ rear:cel(['a',null,null]),front:cel(['b','b',null]) } }] };
  const editor = ink.createPixelEditor(art);
  for (const [blend,expected] of Object.entries({
    normal:[64,128,255],multiply:[32,32,32],screen:[160,160,255],overlay:[65,64,64],add:[192,192,255]
  })) {
    edit(editor,{ type:'update',layer:'front',changes:{ blend,opacity:.5 } });
    const composited = rgba(editor);
    assert.deepEqual(composited.slice(0,4),expected.map((v,i)=>Math.round((v*128+[128,64,32][i]*127)/255)).concat(255));
    assert.deepEqual(composited.slice(4,8),[64,128,255,128]);
  }
});

test('stack transactions edit metadata and static reference cels, and respect inherited locks', () => {
  const editor = ink.createPixelEditor(document);
  edit(editor,{ type:'add',layer:{ id:'detail',kind:'paint',parent:'group' } });
  edit(editor,{ type:'set-cel',frame:'front',layer:'detail',cel:cel(['red',null,null]) });
  const checkpoint = editor.snapshot();
  edit(editor,{ type:'update',layer:'group',changes:{ locked:true } });
  const draw = { id:'paint-detail',frame:'front',revision:editor.describe().revision,
    operation:{ tool:'pencil',layer:'detail',points:[[1,0]],swatch:'green' } };
  assert.equal(editor.previewEdit(draw).conflicts[0].code,'locked-layer');
  assert.equal(editor.sample([0,0],{ mode:'layer',layer:'detail' }).locked,true);
  assert.equal(editor.previewEdit({ ...draw,operation:{ ...draw.operation,layer:'guide' } }).conflicts[0].code,'locked-layer');
  assert.equal(editor.previewEdit(request(editor,{ type:'remove',layer:'group' })).valid,false);
  editor.undo();
  assert.deepEqual(editor.snapshot(),checkpoint);
  const changed = edit(editor,{ type:'set-cel',frame:'front',layer:'guide',cel:cel([null,'red','green']) });
  assert.equal(changed.frames[0].cels.guide.slots[1],'red');
  const order = ['back','group','coat','under','cut','white','detail','guide'];
  edit(editor,{ type:'reorder',order });
  assert.deepEqual(editor.describe().identities.layers.map(row=>row.id),order);
  assert.equal(editor.previewEdit(request(editor,{ type:'reorder',order:['back','coat','group',...order.slice(3)] })).valid,false);
});

test('merges bake appearance across frames, preserve target identity and replay', () => {
  const base = { ...document,layers:[{ id:'lower' },{ id:'upper',opacity:.5 }],frames:['one','two'].map(id=>({
    id,durationMs:100,cels:{ lower:{ ...cel(['blue',null,null]),id:id+'-base' },
      upper:cel(id === 'one' ? ['red','red',null] : ['white',null,null]) }
  })) };
  const editor = ink.createPixelEditor(base), before = base.frames.map(row=>rgba(editor,row.id));
  const op = request(editor,{ type:'merge-down',layer:'upper' });
  const preview = editor.previewEdit(op);
  assert.equal(preview.valid,true);
  assert.equal(preview.pixelCount,3);
  const updated = editor.apply(op), receipt = editor.receipts()[0];
  assert.deepEqual(updated.layers,[{ id:'lower' }]);
  assert.equal(updated.frames[0].cels.lower.id,'one-base');
  assert.deepEqual(base.frames.map(row=>rgba(editor,row.id)),before);
  assert.deepEqual(ink.createPixelEditor(base).replay(receipt),updated);
  editor.undo();
  assert.deepEqual(editor.snapshot(),base);

  const clippedGroup = ink.createPixelEditor({ ...document,layers:[...document.layers,{ id:'later',clip:'group' }] });
  assert.match(clippedGroup.previewEdit(request(clippedGroup,{ type:'flatten-group',layer:'group' })).conflicts[0].message,/clipping source/);
  const grouped = ink.createPixelEditor(document), visible = rgba(grouped);
  const flattened = edit(grouped,{ type:'flatten-group',layer:'group' });
  assert.deepEqual(flattened.layers,[{ id:'back' },{ id:'group',kind:'paint',opacity:.5 },{ id:'guide',kind:'reference' }]);
  assert.deepEqual(rgba(grouped),visible);
  edit(grouped,{ type:'flatten',layer:'flattened' });
  assert.deepEqual(rgba(grouped),visible);
  const dependency = ink.createPixelEditor({ ...base,layers:[...base.layers,{ id:'later',clip:'lower' }] });
  assert.match(dependency.previewEdit(request(dependency,{ type:'merge-down',layer:'upper' })).conflicts[0].message,/clipping source/);
});

test('surface layers address a real material chart through native pixel and UV edits', () => {
  const source = { id:'gate',style:'slate',solids:[
    { id:'wall',kind:'box',at:[0,0,0],half:[1,1,.25],res:.12,mat:'stone',
      surfaceState:{ charts:{ front:{ origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0] } } } }
  ] };
  const data = { ...document,width:2,height:2,layers:[{ id:'coat',kind:'surface',destination:'wear' }],
    frames:[{ id:'front',durationMs:100,cels:{} }],
    sceneBindings:[{ id:'wall',scene:'gate',object:'wall',layer:'coat',frame:'front',
      canvas:{ size:[4,4],offset:[1,1],scale:[1,1] } }],
    destinations:[{ id:'wear',kind:'surface-channel',binding:'wall',chart:'front',channel:'wear' }]
  };
  const scene = ink.createSceneEditor(source), editor = ink.createPixelEditor(data,{ sceneEditor:scene,sceneRef:'gate' });
  const read = point=>editor.sample(point,{ mode:'source',destination:'layer:coat' });
  assert.deepEqual(read([0,0]).uv,[.375,.625]);
  const patch = { id:'grade',frame:'front',destination:'layer:coat',revision:editor.describe().revision,
    sourceRevision:read([0,0]).sourceRevision,operation:{ pixel:[0,0],value:.75 } };
  assert.equal(editor.previewEdit(patch).targets[0].layer,'coat');
  assert.equal(read([0,0]).value,0);
  editor.apply(patch);
  const stamps = scene.snapshot().solids[0].surfaceState.charts.front.stamps;
  assert.deepEqual(stamps[0].brush,{ kind:'rect',min:[.25,.5],max:[.5,.75] });
  assert.equal(read([0,0]).value,.75);
  assert.equal(read([1,0]).value,0);
  const replay = ink.createPixelEditor(data,{ sceneEditor:ink.createSceneEditor(source),sceneRef:'gate' });
  assert.deepEqual(replay.replay(editor.receipts()[0]),scene.snapshot());
  editor.undo();
  assert.equal(read([0,0]).value,0);
  edit(editor,{ type:'update',layer:'coat',changes:{ locked:true } });
  assert.equal(editor.previewEdit({ ...patch,revision:editor.describe().revision }).conflicts[0].code,'locked-layer');
});

test('layer decks round-trip across the SDK and CLI', t => {
  const editor = ink.createPixelEditor(document);
  const deck = editor.layerDeck();
  assert.equal(deck.format,'ink-studio/pixel-layer-deck');
  assert.deepEqual(deck.frames[0].cels.cut.slots,[null,2,null]);
  assert.deepEqual(deck.frames[0].cels.cut.alpha,[255,128,255]);
  const reopened = ink.createPixelEditor(ink.pixelDocumentFromLayerDeck(deck));
  assert.deepEqual(reopened.layerDeck(),deck);
  assert.deepEqual(rgba(reopened),rgba(editor));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-layer-stack-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json');
  const command = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','stack',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  fs.writeFileSync(file('source'),JSON.stringify(document));
  command('export',file('source'),'--out',file('deck'));
  command('import',file('deck'),'--out',file('restored'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('deck'),'utf8')),deck);
  assert.deepEqual(rgba(ink.createPixelEditor(fs.readFileSync(file('restored'),'utf8'))),rgba(editor));
});
