const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const { KIT } = ink.load();
const { raster } = KIT.pixelShapes;
const size = 20;
const coverage = shape => raster(size,size,shape);
const on = (mask,x,y) => mask[y*size+x];
const points = mask => Array.from(mask.keys()).filter(i=>mask[i]).map(i=>[i%size,Math.floor(i/size)]);

test('native lines and both Bézier curves include their endpoints with stable one-pixel coverage', () => {
  assert.deepEqual(points(coverage({ type:'line',from:[2,3],to:[5,6] })),[[2,3],[3,4],[4,5],[5,6]]);
  assert.equal(points(coverage({ type:'line',from:[0,0],to:[0,0],width:2 })).length,4);
  const quadratic = coverage({ type:'curve',points:[[2,8],[8,0],[14,8]] });
  const cubic = coverage({ type:'curve',points:[[2,10],[2,2],[14,2],[14,10]] });
  for (const [mask,y] of [[quadratic,8],[cubic,10]]) {
    assert.equal(on(mask,2,y),1);
    assert.equal(on(mask,14,y),1);
    assert.equal(on(mask,8,4),1);
    assert.equal(on(mask,8,8),0);
  }
  assert.throws(()=>coverage({ type:'curve',points:[[1,2],[2,4]] }),/in-bounds integer points/);
});

test('rectangles, ellipses and concave polygons distinguish their outline from their filled interior', () => {
  const rect = { type:'rect',rect:[2,3,6,5] };
  assert.equal(points(coverage(rect)).length,30);
  const box = coverage({ ...rect,fill:false });
  assert.equal(points(box).length,18);
  assert.equal(on(box,7,7),1);
  assert.equal(on(box,4,5),0);
  const ellipse = { type:'ellipse',rect:[4,5,8,6] };
  const filled = coverage(ellipse), ring = coverage({ ...ellipse,fill:false });
  assert.equal(on(ring,7,7),0);
  assert.equal(on(filled,7,7),1);
  assert.equal(on(filled,4,5),0);
  assert.equal(on(ring,7,5),1);
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) {
    assert.equal(on(ring,x,y),on(ring,15-x,y));
    assert.equal(on(filled,x,y),on(filled,x,15-y));
    if (on(ring,x,y)) assert.equal(on(filled,x,y),1);
  }
  const polygon = { type:'polygon',points:[[2,2],[8,2],[8,4],[5,4],[5,8],[2,8]] };
  assert.equal(on(coverage(polygon),3,6),1);
  assert.equal(on(coverage(polygon),7,6),0);
  assert.equal(on(coverage({ ...polygon,fill:false }),3,6),0);
  assert.equal(on(coverage({ ...polygon,fill:false }),5,8),1);
});

test('text uses Ink bitmap glyphs and authored staircase runs meet at diagonal corners', () => {
  const text = 'INK\n2', at = [1,2], settings = { scale:1, tracking:1, leading:1 };
  const mask = coverage({ type:'text',at,text,...settings });
  const { value } = KIT.procedural.drawing2d.text(text,settings);
  const glyphPixels = [];
  for (let y = 0; y < value.height; y++) for (let x = 0; x < value.width && x+at[0] < size; x++)
    if (value.data[(y*value.width+x)*4+3]) glyphPixels.push([x+at[0],y+at[1]]);
  assert(glyphPixels.length > 0);
  assert.deepEqual(points(mask),glyphPixels);
  assert.equal(points(coverage({ type:'text',at:[19,19],text:'I',scale:2 })).length <= 1,true);
  const staircase = { type:'staircase',from:[7,2],axis:'x',direction:[-1,1],lengths:[3,2,1] };
  assert.deepEqual(points(coverage(staircase)),[[5,2],[6,2],[7,2],[3,3],[4,3],[2,4]]);
  assert.throws(()=>coverage({ ...staircase,from:[2,2],lengths:[5] }),/leaves the native grid/);
  const { type,...steps } = staircase;
  const legacy = { format:'ink-studio/pixel-art',version:1,width:size,height:size,palette:{ ink:'#cfdda2' },
    layers:[{ id:'ink',marks:[{ swatch:'ink',steps }] }] };
  assert.deepEqual(ink.createPixelEditor(legacy).stamp().slots.map(slot=>Number(slot !== null)),Array.from(coverage(staircase)));
});

test('document shapes preview, respect protected pixels, undo and replay from the CLI', t => {
  const spec = { format:'ink-studio/pixel-art',version:2,width:size,height:size,pixelAspect:[1,1],
    palette:{ ink:'#cfdda2' },layers:[{ id:'ink' }],frames:[{ id:'front',durationMs:100,cels:{} }],
    protectedDetails:[{ id:'keep-window',pixels:[[6,6]] }] };
  const editor = ink.createPixelEditor(spec);
  const patch = { id:'window',revision:editor.describe().revision,frame:'front',
    operation:{ layer:'ink',tool:'shape',swatch:'ink',shape:{ type:'rect',rect:[4,4,5,5],fill:false } } };
  assert.equal(editor.previewEdit(patch).targets[0].pixelCount,16);
  assert.throws(()=>editor.apply({ ...patch,operation:{ ...patch.operation,shape:{ ...patch.operation.shape,fill:true } } }),
    error=>error.receipt?.conflicts[0].code === 'protected-pixel');
  assert.equal(editor.describe().revision,patch.revision);
  editor.apply(patch);
  const [receipt] = editor.receipts();
  assert.equal(receipt.affectedTargets[0].shape,'rect');
  assert.deepEqual(receipt.command.patch.operation.shape,patch.operation.shape);
  assert.equal(editor.sample([6,6]).swatch,null);
  assert.equal(editor.sample([8,8]).swatch,'ink');
  assert.equal(editor.undo(),true);
  assert.equal(editor.sample([8,8]).swatch,null);
  assert.equal(editor.redo(),true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-shapes-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name => path.join(dir,name+'.json');
  fs.writeFileSync(file('spec'),JSON.stringify(spec));
  fs.writeFileSync(file('patch'),JSON.stringify(patch));
  const cli = (...args) => execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  const written = cli('edit',file('spec'),file('patch'),'--out',file('edited'));
  fs.writeFileSync(file('receipt'),written);
  assert.equal(cli('replay',file('spec'),file('receipt'),'--out',file('replayed')),written);
  assert.equal(fs.readFileSync(file('replayed'),'utf8'),fs.readFileSync(file('edited'),'utf8'));
});
