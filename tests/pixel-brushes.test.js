const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const brushes = require('../src/pixel-brushes.js');

const source = { format:'ink-studio/pixel-art',version:2,width:10,height:9,pixelAspect:[1,1],
  palette:{ red:'#cc382d',blue:'#1d6294',gold:'#e4bd42' },layers:[{ id:'ink' },{ id:'light' }],
  frames:[{ id:'front',durationMs:100,cels:{
    ink:{ id:'drawing',marks:[{ swatch:'red',at:[1,1] },{ swatch:'blue',at:[3,1] },
      { swatch:'red',at:[1,2] },{ swatch:'gold',at:[2,1] }] },
    light:{ marks:[{ swatch:'gold',at:[1,1] }] }
  } },{ id:'rear',durationMs:100,cels:{} }],
  selections:[{ id:'badge',frame:'front',pixels:[[3,1],[1,2],[1,1]] }] };
const target = { ...source,palette:{ red:'#668888',base:'#273034' },layers:[{ id:'ink' }],
  frames:[{ id:'front',durationMs:100,cels:{ ink:{ marks:[{ swatch:'base',at:[5,6] }] } } }],selections:[] };
const pathFor = (editor,id,brush,placement,extra = {}) => ({
  id,frame:'front',revision:editor.describe().revision,
  operation:{ tool:'brush',layer:'ink',brush,...placement,...extra }
});

test('brush capture keeps selected shape, art-layer colors, transparent gaps and native anchors', () => {
  const editor = ink.createPixelEditor(source);
  const brush = editor.captureBrush({ selection:'badge',cel:'drawing',anchor:[0,0],settings:{ angle:90 } });
  assert.deepEqual([brush.width,brush.height,brush.anchor],[3,2,[0,0]]);
  assert.deepEqual(brush.palette,[{ id:'red',color:'#cc382d' },{ id:'blue',color:'#1d6294' }]);
  assert.deepEqual(brush.slots,[0,null,1,0,null,null]);
  assert.deepEqual(brush.settings,{ angle:90,size:[3,2],swatch:{ mode:'original' } });
  assert.deepEqual(brushes.footprint(brush),[[-1,0,0],[0,0,0],[0,2,1]]);
  const composite = editor.captureBrush({ selection:'badge' });
  assert.equal(composite.palette[0].id,'gold');
  assert.throws(()=>editor.captureBrush({ selection:'badge',frame:'rear' }),/belongs to frame/);
  assert.throws(()=>editor.captureBrush({ rect:[8,8,2,1] }),/painted indexed shape/);
  assert.throws(()=>editor.captureBrush({ selection:'badge',anchor:[3,0] }),/native anchor/);
  const large = { ...brush,settings:{ ...brush.settings,angle:0,size:[6,2] } };
  assert.equal(brushes.footprint(large).length,6);
  const oblique = { ...brush,settings:{ ...brush.settings,angle:32,size:[6,4] } };
  assert.deepEqual(brushes.footprint(JSON.parse(JSON.stringify(oblique))),brushes.footprint(oblique));
});

test('a brush paints its saved colors into another palette and the edit replays and undoes completely', () => {
  const brush = ink.createPixelEditor(source).captureBrush({ selection:'badge',layer:'ink',anchor:[0,0],settings:{ angle:90 } });
  const editor = ink.createPixelEditor(target), patch = pathFor(editor,'stamp-badge',brush,{ at:[5,5] });
  const preview = editor.previewEdit(patch);
  assert.deepEqual(preview.targets[0].addedSwatches,['brush-cc382d','blue']);
  assert.equal(preview.pixelCount,3);
  const painted = editor.apply(patch), [receipt] = editor.receipts();
  assert.deepEqual(receipt.command.patch.operation.brush,brush);
  assert.equal(editor.sample([4,5]).color,'#cc382d');
  assert.equal(editor.sample([5,7]).color,'#1d6294');
  assert.equal(editor.sample([5,6]).swatch,'base');
  assert.deepEqual(ink.createPixelEditor(target).replay(receipt),painted);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),target);
  assert.equal(editor.redo(),true);
  assert.deepEqual(editor.snapshot(),painted);

  const tinted = { ...brush,settings:{ ...brush.settings,swatch:{ mode:'tint',color:'#ffaa22' } } };
  const clean = ink.createPixelEditor(target);
  clean.apply(pathFor(clean,'tinted',tinted,{ points:[[0,0],[2,0]] }));
  assert.equal(clean.sample([0,0]).color,'#ffaa22');
  assert.equal(clean.sample([2,2]).color,'#ffaa22');
  const guarded = ink.createPixelEditor({ ...target,protectedDetails:[{ id:'hold',pixels:[[5,7]] }] });
  assert.throws(()=>guarded.apply(pathFor(guarded,'blocked',brush,{ at:[5,5] })),
    error=>error.receipt?.conflicts[0].code === 'protected-pixel');
  assert.deepEqual(Object.keys(guarded.snapshot().palette),['red','base']);
});

test('CLI brush capture, reuse and replay preserve saved anchor, angle, size and tint', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-brushes-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name => path.join(dir,name+'.json');
  fs.writeFileSync(file('source'),JSON.stringify(source));
  fs.writeFileSync(file('target'),JSON.stringify(target));
  const cli = (...args) => execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  cli('brush',file('source'),'--selection','badge','--cel','drawing','--anchor','0,1','--angle','90',
    '--size','4,3','--tint','gold','--out',file('brush'));
  const brush = JSON.parse(fs.readFileSync(file('brush'),'utf8'));
  assert.deepEqual(brush.anchor,[0,1]);
  assert.deepEqual(brush.settings,{ angle:90,size:[4,3],swatch:{ mode:'tint',id:'gold',color:'#e4bd42' } });
  fs.writeFileSync(file('patch'),JSON.stringify(pathFor(ink.createPixelEditor(target),'place',brush,{ at:[4,4] })));
  fs.writeFileSync(file('receipt'),cli('edit',file('target'),file('patch'),'--out',file('edited')));
  assert.equal(cli('replay',file('target'),file('receipt'),'--out',file('replayed')),fs.readFileSync(file('receipt'),'utf8'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('replayed'),'utf8'));
});
