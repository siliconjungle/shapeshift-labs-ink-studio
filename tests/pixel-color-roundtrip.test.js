const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const stamps = require('../src/pixel-stamps.js');

const document = {
  format:'ink-studio/pixel-art',version:2,width:6,height:1,pixelAspect:[1,1],
  palette:{ brass:'#cb4519',accent:'#cb4519',shadow:'#212831' },layers:[{ id:'ink' }],
  frames:[{ id:'main',durationMs:100,cels:{ ink:{ id:'image',
    slots:['brass','accent','brass',null,null,'shadow'],marks:[
      { alpha:3,runs:[[0,2,1]] },{ alpha:0,runs:[[0,5,1]] },{ swatch:null,at:[4,0] }
    ] } } }],
  selections:[{ id:'pair',pixels:[[0,0],[1,0]] }]
};

test('indexed and RGBA PNGs carry duplicate swatches, alpha variants, hidden pigment and knockouts', () => {
  const editor = ink.createPixelEditor(document), paint = editor.stamp({ layer:'ink' });
  assert.deepEqual(paint.swatchIds,['brass','accent','shadow']);
  assert.deepEqual(paint.slots,[0,1,0,null,null,2]);
  assert.deepEqual(paint.alpha,[255,255,3,255,255,0]);
  assert.deepEqual(paint.knockouts,[4]);
  const expected = [...stamps.image(paint,{ preserveHidden:true }).rgba], { selections,...pixels } = paint;
  for (const colorMode of ['indexed','rgba','auto']) {
    const png = editor.png({ layer:'ink',colorMode });
    assert.equal(png[25],colorMode === 'rgba' ? 6 : 3);
    assert.deepEqual([...PNG.raster(png).data],expected);
    assert.deepEqual(PNG.paintRaster(png),pixels);
    const restored = ink.createPixelEditor(ink.pixelDocumentFromPNG(png));
    assert.deepEqual(restored.stamp({ layer:'image' }),PNG.paintRaster(png));
    assert.equal(restored.sample([5,0],{ mode:'layer',layer:'image' }).alpha,0);
  }
  const indexed = PNG.indexedRaster(editor.png({ layer:'ink',colorMode:'indexed' }));
  assert.deepEqual([...indexed.value.data],[0,1,3,4,4,2]);
  assert.deepEqual([...indexed.alpha.data],[255,255,3,0,0,0]);
});

test('exact RGBA edits keep existing aliases, support named colors and replay without changing the palette order', () => {
  const editor = ink.createPixelEditor(document);
  const request = (pixels) => ({ id:'color',cel:'image',revision:editor.describe().revision,
    operation:{ tool:'rgba',pixels } });
  const patch = request([
    { at:[1,0],rgba:[203,69,25,17] },
    { at:[3,0],rgba:[203,69,25,0],swatch:'glaze' },
    { at:[2,0],rgba:null },
    { at:[4,0],rgba:[12,34,56,200] }
  ]);
  const preview = editor.previewEdit(patch);
  assert.deepEqual(preview.targets[0].addedSwatches,['glaze','rgb-0c2238']);
  const changed = editor.apply(patch);
  const raw = p=>editor.sample([p,0],{ mode:'layer',cel:'image' });
  assert.deepEqual([raw(1).swatch,raw(1).alpha],['accent',17]);
  assert.deepEqual([raw(3).swatch,raw(3).alpha],['glaze',0]);
  assert.deepEqual([raw(2).swatch,raw(2).knockout],[null,false]);
  assert.equal(raw(4).color,'#0c2238');
  assert.equal(editor.previewEdit(request([{ at:[1,0],rgba:[0,0,0,255],swatch:'accent' }])).valid,false);
  assert.deepEqual(ink.createPixelEditor(document).replay(editor.receipts()[0]),changed);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),document);
});

test('portable indexed selections preserve RGB aliases and composite blends have their own identity', () => {
  const source = ink.createPixelEditor(document);
  const clipboard = source.copySelection({ selection:'pair',layer:'ink' });
  const targetDocument = { ...document,palette:{ base:'#cb4519' },layers:[{ id:'ink' }],
    frames:[{ id:'main',durationMs:100,cels:{} }] };
  const target = ink.createPixelEditor(targetDocument);
  target.apply({ id:'paste',frame:'main',revision:target.describe().revision,
    operation:{ tool:'paste',layer:'ink',clipboard,transform:{ at:[0,0] } } });
  assert.deepEqual(target.stamp().swatchIds,['base','brass','accent']);
  assert.deepEqual(target.stamp().slots.slice(0,2),[1,2]);
  const legacy = ink.createPixelEditor(targetDocument);
  legacy.apply({ id:'paste',frame:'main',revision:legacy.describe().revision,
    operation:{ tool:'paste',layer:'ink',clipboard:{ ...clipboard,version:1 },transform:{ at:[0,0] } } });
  assert.deepEqual(legacy.stamp().slots.slice(0,2),[0,0]);

  const layered = ink.createPixelEditor({ ...document,palette:{ red:'#ff0000',blue:'#0000ff',purple:'#80007f' },
    layers:[{ id:'rear' },{ id:'front' }],frames:[{ id:'main',durationMs:100,cels:{
      rear:{ slots:['blue','purple',null,null,null,null],marks:[] },
      front:{ slots:['red',null,null,null,null,null],marks:[{ alpha:128,runs:[[0,0,1]] }] }
    } }] });
  const flattened = layered.stamp();
  assert.deepEqual(flattened.palette,['#ff0000','#0000ff','#80007f','#80007f']);
  assert.deepEqual(flattened.swatchIds,['red','blue','purple','blend-80007f']);
  assert.deepEqual(flattened.slots.slice(0,2),[3,2]);
  assert.equal(layered.stamp({ layer:'front' }).slots[0],0);
});

test('foreign PNGs keep palette order and straight RGB even at very low or zero alpha', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-color-import-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const indexed = path.join(directory,'indexed.png');
  PNG.writeIndexed(indexed,3,1,[1,0,null],[[51,34,17],[51,34,17]]);
  const indexedPaint = PNG.paintRaster(indexed);
  assert.deepEqual(indexedPaint.palette,['#332211','#332211','#000000']);
  assert.deepEqual(indexedPaint.slots,[1,0,2]);
  assert.deepEqual(indexedPaint.alpha,[255,255,0]);

  const foreign = Uint8Array.of(13,151,243,1,99,37,23,0,0,0,0,0);
  const rgba = path.join(directory,'rgba.png');
  fs.writeFileSync(rgba,PNG.encode(3,1,foreign,4));
  const design = path.join(directory,'image.json'), art = path.join(directory,'art.png');
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..') });
  cli('import',rgba,'--out',design);
  cli('draw',design,'--layer','image','--color-mode','indexed','--out',directory);
  assert.deepEqual([...PNG.raster(art).data],[...foreign]);

  const overloaded = { width:257,height:1,palette:['#112233','#445566'],
    slots:[...Array(256).fill(0),null],alpha:[...Array.from({ length:256 },(_,i)=>i),255] };
  assert.throws(()=>PNG.encodePaint(overloaded,'indexed'),/256 color\/alpha entries/);
  const auto = PNG.encodePaint(overloaded);
  assert.equal(auto[25],6);
  assert.deepEqual(PNG.paintRaster(auto).alpha,overloaded.alpha);
});
