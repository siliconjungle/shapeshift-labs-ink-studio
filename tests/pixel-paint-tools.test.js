const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');

const design = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
  palette:{ base:'#13272f',mint:'#a7ceaa',gold:'#ffd55e',other:'#a7ceaa' },
  layers:[{ id:'floor' },{ id:'ink' },{ id:'light' }],
  frames:[{ id:'front',durationMs:100,cels:{
    floor:{ marks:[{ swatch:'base',shape:{ type:'rect',rect:[0,0,8,6] } }] },
    ink:{ id:'active-ink', marks:[
      { swatch:'mint',shape:{ type:'rect',rect:[1,1,2,2] } },
      { swatch:'other',at:[3,1] },{ swatch:'mint',at:[3,3] },
      { swatch:null,at:[7,4] }
    ] },
    light:{ marks:[{ swatch:'gold',at:[1,1] }] }
  } },{ id:'side',durationMs:100,cels:{} }]
};
const makePatch = (editor,id,operation,extra = {}) => ({
  id,revision:editor.describe().revision,frame:'front',operation,...extra
});

test('eyedropper reads exact swatch identity and the chosen cel below the visible composite', () => {
  const editor = ink.createPixelEditor(design);
  const composite = editor.sample([1,1]);
  const active = editor.sample([1,1],{ mode:'layer',cel:'active-ink' });
  assert.deepEqual([composite.layer,composite.swatch,composite.color],['light','gold','#ffd55e']);
  assert.deepEqual([active.layer,active.cel,active.swatch,active.color],['ink','active-ink','mint','#a7ceaa']);
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,'other');
  assert.equal(editor.sample([7,4],{ mode:'layer',layer:'ink' }).knockout,true);
  assert.equal(editor.sample([7,5],{ mode:'layer',layer:'ink' }).knockout,false);
  assert.throws(()=>editor.sample([0,0],{ mode:'layer' }),/layer or cel/);
});

test('pencil, eraser and fill edit the source cel, with coherent retained marks and replay', () => {
  const editor = ink.createPixelEditor(design);
  const fill = makePatch(editor,'bucket',{ tool:'fill',at:[1,1],swatch:'base' },{ cel:'active-ink' });
  const preview = editor.previewEdit(fill);
  assert.equal(preview.targets[0].pixelCount,4);
  assert.equal(preview.pixelCount,3);
  editor.begin('Paint the texture');
  editor.apply(fill);
  const [receipt] = editor.receipts();
  assert.deepEqual(receipt.affectedTargets[0].runs,[[1,1,2],[2,1,2]]);
  assert.deepEqual(editor.previewChanges(),preview);
  editor.commit();
  assert.equal(editor.sample([1,1]).swatch,'gold');
  assert.equal(editor.sample([1,1],{ mode:'layer',layer:'ink' }).swatch,'base');
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,'other');
  assert.equal(editor.sample([3,3],{ mode:'layer',layer:'ink' }).swatch,'mint');
  assert.equal(editor.undo(),true);
  assert.equal(editor.sample([2,2]).swatch,'mint');
  assert.equal(editor.redo(),true);
  assert.deepEqual(ink.createPixelEditor(design).replay(receipt),editor.snapshot());

  editor.apply(makePatch(editor,'erase',{ tool:'eraser',layer:'ink',points:[[3,1],[3,3]] }));
  assert.equal(editor.sample([3,1]).swatch,'base');
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,null);
  editor.apply(makePatch(editor,'remove-cut',{ tool:'eraser',layer:'ink',points:[[7,4]] }));
  assert.equal(editor.sample([7,4]).swatch,'base');
  assert.equal(editor.sample([7,4],{ mode:'layer',layer:'ink' }).knockout,false);
  editor.apply(makePatch(editor,'line',{ tool:'pencil',layer:'ink',points:[[4,1],[4,4]],swatch:'gold' }));
  assert.equal(editor.sample([4,3]).swatch,'gold');
  assert.deepEqual(editor.snapshot().frames[0].cels.ink.marks.slice(0,4),design.frames[0].cels.ink.marks);
});

test('fill covers a large grid and respects clipping and protected boundaries', () => {
  const blank = { ...design,width:100,height:80,frames:[{ id:'front',durationMs:100,cels:{} }] };
  const editor = ink.createPixelEditor(blank);
  editor.apply(makePatch(editor,'fill-blank',{ layer:'ink',tool:'fill',at:[0,0],swatch:'gold' }));
  const target = editor.receipts()[0].affectedTargets[0];
  assert.equal(target.pixelCount,8000);
  assert.equal(target.runs.length,80);
  assert.equal(editor.sample([99,79]).swatch,'gold');

  const clipped = structuredClone(design);
  clipped.layers[1].clip = 'floor';
  clipped.frames[0].cels.floor.marks[0].shape.rect = [0,0,4,6];
  clipped.protectedDetails = [{ id:'border',pixels:[[2,1],[2,2]] }];
  const guarded = ink.createPixelEditor(clipped);
  guarded.apply(makePatch(guarded,'safe-fill',{ layer:'ink',tool:'fill',at:[1,1],swatch:'base' }));
  assert.equal(guarded.receipts()[0].affectedTargets[0].pixelCount,2);
  assert.equal(guarded.sample([2,1],{ mode:'layer',layer:'ink' }).swatch,'mint');
  assert.equal(guarded.sample([7,4],{ mode:'layer',layer:'ink' }).clipped,true);
  const revision = guarded.describe().revision;
  assert.throws(()=>guarded.apply(makePatch(guarded,'bad-line',
    { layer:'ink',tool:'pencil',points:[[1,1],[3,1]],swatch:'gold' })),
    error => error.receipt.conflicts[0].code === 'protected-pixel');
  assert.equal(guarded.describe().revision,revision);
});

test('material eyedropper reads retained color, coverage and scalar values in rest UV', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-sample-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const rect = { kind:'rect',min:[0,.5],max:[1,1] };
  const scene = { id:'wall',style:'slate',solids:[{ id:'brick',kind:'box',at:[0,0,0],half:[1,1,.25],res:.1,mat:'stone',
    surfaceState:{ charts:{ face:{ origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0],stamps:[
      { channel:'paint',brush:rect,value:'#a7ceaa',strength:.5 },
      { channel:'heat',brush:rect,value:45 }
    ] } } } }] };
  const scenePath = path.join(directory,'wall.json'), input = path.join(directory,'art.json');
  const spec = { ...design,sceneBindings:[{ id:'wall-projection',scene:scenePath,object:'brick',frame:'front' }],
    destinations:[{ id:'pigment',kind:'surface-channel',binding:'wall-projection',chart:'face',channel:'paint' },
      { id:'temperature',kind:'surface-channel',binding:'wall-projection',chart:'face',channel:'heat' }] };
  const editor = ink.createPixelEditor(spec,{ sceneRef:scenePath,sceneEditor:ink.createSceneEditor(scene) });
  const paint = editor.sample([0,0],{ mode:'source',destination:'pigment' });
  assert.deepEqual(paint.uv,[.0625,1-.5/6]);
  assert.deepEqual(paint.value,{ color:[167/255,206/255,170/255],coverage:.5 });
  assert.match(paint.sourceRevision,/^[a-f0-9]{64}$/);
  assert.equal(editor.sample([0,5],{ mode:'source',destination:'pigment' }).value,null);
  assert.throws(()=>editor.sample([0,0],{ mode:'source',frame:'side',destination:'pigment' }),/bound to frame/);
  const scalar = editor.sample(undefined,{ mode:'source',destination:'temperature',uv:[.25,.75] });
  assert.deepEqual([scalar.value,scalar.type,scalar.units,scalar.object,scalar.chart],[45,'number','degC','brick','face']);
  fs.writeFileSync(scenePath,JSON.stringify(scene));
  fs.writeFileSync(input,JSON.stringify(spec));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  assert.deepEqual(cli('sample',input,'--mode','source','--destination','temperature','--scene',scenePath,'--uv','.25,.75'),scalar);
  const patch = path.join(directory,'patch.json'), out = path.join(directory,'filled.json');
  fs.writeFileSync(patch,JSON.stringify(makePatch(editor,'region',{ layer:'ink',tool:'fill',at:[1,1],swatch:'base' })));
  assert.equal(cli('edit',input,patch,'--out',out).affectedTargets[0].pixelCount,4);
  assert.equal(cli('sample',out,'--mode','layer','--layer','ink','--at','1,1').swatch,'base');
});
