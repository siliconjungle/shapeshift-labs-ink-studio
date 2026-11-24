const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');

const design = {
  format:'ink-studio/pixel-art',version:2,width:4,height:1,pixelAspect:[1,1],
  palette:{ dark:{ color:'#263442',label:'Shadow',locked:true },mid:'#49606f',glint:'#eeeecc',alias:'#49606f' },
  ramps:[{ id:'steel',label:'Brushed steel',swatches:['dark','mid','glint'] }],
  layers:[{ id:'ink' }],
  frames:[
    { id:'front',durationMs:100,cels:{ ink:{ slots:['dark','mid','alias',null],marks:[
      { alpha:7,runs:[[0,1,1]] },{ at:[3,0],swatch:null }
    ] } } },
    { id:'back',durationMs:130,cels:{ ink:{ marks:[{ swatch:'mid',steps:{ from:[0,0],axis:'x',direction:[1,1],lengths:[2] } }] } } }
  ]
};
const patch = (editor,operation) => ({
  id:'palette-edit',destination:'palette',revision:editor.describe().revision,operation
});

test('palette locks govern recolor and remap while named ramps preserve their independent order', () => {
  const editor = ink.createPixelEditor(design);
  const recolor = patch(editor,{ type:'swatch',swatch:{ id:'dark',color:'#132431',locked:false } });
  assert.equal(editor.previewEdit(recolor).conflicts[0].code,'locked-swatch');
  assert.throws(()=>editor.apply(recolor),/locked/);
  assert.equal(editor.previewEdit(patch(editor,{ type:'remap',map:{ dark:'alias' } })).conflicts[0].code,'locked-swatch');
  editor.apply(patch(editor,{ type:'swatch',swatch:{ id:'dark',label:'Cold shadow' } }));
  const original = editor.stamp({ layer:'ink' });
  const reorganized = editor.apply(patch(editor,{ type:'reorder',order:['glint','alias','mid','dark'] }));
  assert.deepEqual(reorganized.frames,design.frames);
  assert.deepEqual(reorganized.ramps,design.ramps);
  assert.deepEqual(editor.stamp({ layer:'ink' }).slots,[3,2,1,null]);
  assert.deepEqual(editor.stamp({ layer:'ink' }).alpha,original.alpha);
  assert.equal(editor.palette().swatches[3].label,'Cold shadow');

  const brush = editor.captureBrush({ rect:[0,0,1,1],layer:'ink' });
  editor.apply({ id:'highlight',revision:editor.describe().revision,frame:'front',
    operation:{ tool:'brush',layer:'ink',brush,at:[0,0],shading:{ mode:'ramp',ramp:'steel',step:1 } } });
  assert.equal(editor.sample([0,0]).swatch,'mid');
  editor.apply(patch(editor,{ type:'ramp',ramp:{ id:'steel',label:'Reversed',swatches:['glint','mid','dark'] } }));
  editor.apply({ id:'shade',revision:editor.describe().revision,frame:'front',
    operation:{ tool:'brush',layer:'ink',brush,at:[0,0],shading:{ mode:'ramp',ramp:'steel',step:1 } } });
  assert.equal(editor.sample([0,0]).swatch,'dark');
});

test('remap rewrites every cel simultaneously, retains authored marks and makes a replayable receipt', () => {
  const editor = ink.createPixelEditor(design);
  const operation = { type:'remap',map:{ mid:'alias' },removeSources:true };
  const preview = editor.previewEdit(patch(editor,operation));
  assert.equal(preview.valid,true);
  assert.deepEqual(preview.targets[0].removed,['mid']);
  assert.equal(preview.targets[0].remappedCels,2);
  assert.equal(editor.sample([1,0]).swatch,'mid');
  const updated = editor.apply(patch(editor,operation)), [receipt] = editor.receipts();
  assert.equal(receipt.command.frame,null);
  assert.deepEqual(updated.ramps[0].swatches,['dark','alias','glint']);
  assert.deepEqual(updated.frames[1].cels.ink.marks[0],{ ...design.frames[1].cels.ink.marks[0],swatch:'alias' });
  assert.equal(editor.sample([1,0],{ mode:'layer',layer:'ink' }).alpha,7);
  assert.equal(editor.sample([3,0],{ mode:'layer',layer:'ink' }).knockout,true);
  assert.deepEqual(ink.createPixelEditor(design).replay(receipt),updated);
  for (const colorMode of ['indexed','rgba']) {
    const reopened = ink.createPixelEditor(ink.pixelDocumentFromPNG(editor.png({ layer:'ink',colorMode })));
    assert.deepEqual(reopened.palette(),editor.palette());
  }
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),design);
});

test('CLI palette extraction and exchange reuse editable IDs, preserve labels and refuse color conflicts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-editing-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  const editor = ink.createPixelEditor(design);
  write('source.json',design);
  cli('palette','export',file('source.json'),'--out',file('palette.json'));
  assert.deepEqual(read('palette.json'),editor.palette());
  const target = { ...design,palette:{ black:'#000000' },ramps:undefined,
    frames:[{ id:'blank',durationMs:100,cels:{} }] };
  write('target.json',target);
  const receipt = JSON.parse(cli('palette','import',file('target.json'),file('palette.json'),'--out',file('imported.json')));
  assert.deepEqual(read('imported.json').ramps,design.ramps);
  assert.deepEqual(read('imported.json').palette.dark,design.palette.dark);
  write('receipt.json',receipt);
  cli('replay',file('target.json'),file('receipt.json'),'--out',file('replayed.json'));
  assert.deepEqual(read('replayed.json'),read('imported.json'));
  const conflict = { ...read('palette.json'),swatches:[{ id:'dark',color:'#101020' }],ramps:[] };
  const blocked = editor.previewEdit(patch(editor,{ type:'import',palette:conflict }));
  assert.equal(blocked.conflicts[0].code,'locked-swatch');

  PNG.writeIndexed(file('reference.png'),4,1,[0,1,1,null],[[211,77,18],[211,77,18]]);
  cli('palette','extract',file('reference.png'),'--out',file('reference.json'));
  assert.deepEqual(read('reference.json').swatches,[
    { id:'extracted-d34d12-slot-0',color:'#d34d12' },{ id:'extracted-d34d12-slot-1',color:'#d34d12' }
  ]);
  cli('palette','extract',file('source.json'),'--frame','front','--alpha','opaque','--out',file('extracted.json'));
  assert.deepEqual(read('extracted.json'),editor.extractPalette({ frame:'front',alpha:'opaque' }));
});
