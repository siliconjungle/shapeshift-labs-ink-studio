const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const adjustments = require('../src/pixel-adjustments.js');
const colors = require('../src/pixel-raster-colors.js');

const swatches = {
  red:'#ff0000', black:'#000000', grey:'#808080', white:'#ffffff', alias:'#ff0000'
};
const entries = Object.entries(swatches).map(([id,color])=>({ id,color }));
const apply = (width,height,source,operation,mask) => {
  const editor = colors.paletteEditor(entries);
  const writes = adjustments.prepare(operation,editor).apply(width,height,source,mask);
  return [...writes].map(([p,{ slot,alpha }])=>[p,editor.palette[slot].id,editor.palette[slot].color,alpha]);
};

test('curves, hue, saturation and simultaneous replacement use exact indexed paint', () => {
  const source = { slots:[0,4,null,1],alpha:[35,0,255,255] };
  const invert = { type:'curves',curve:{ stops:[[0,1],[1,0]] } };
  assert.deepEqual(apply(4,1,source,invert),[
    [0,'rgb-00ffff','#00ffff',35],[1,'rgb-00ffff','#00ffff',0],[3,'white','#ffffff',255]
  ]);
  assert.deepEqual(apply(4,1,source,{ type:'curves',channels:{ red:{ stops:[[0,0],[1,.5]] } } }).map(row=>row[2]),
    ['#800000','#800000']);
  assert.deepEqual(apply(4,1,source,{ type:'hue-saturation',degrees:120 }).map(row=>row[2]),['#00ff00','#00ff00']);
  assert.deepEqual(apply(4,1,source,{ type:'hue-saturation',saturation:0 }).map(row=>row[2]),['#4d4d4d','#4d4d4d']);
  assert.deepEqual(apply(4,1,source,{ type:'hue-saturation',degrees:360 }),[]);
  assert.deepEqual(apply(4,1,source,{ type:'replace',map:{ red:'alias',alias:'red' } }),[
    [0,'alias','#ff0000',35],[1,'red','#ff0000',0]
  ]);
});

test('gradient anchors, palette matching, dither ranks and outlines respect the native grid', () => {
  const paint = { slots:[0,0,0,0],alpha:[255,9,0,255] }, mask = Uint8Array.of(0,1,1,1);
  const gradient = { type:'gradient',stops:[[0,'alias'],[1,'white']] };
  assert.deepEqual(apply(4,1,paint,gradient,mask),[
    [1,'alias','#ff0000',9],[2,'rgb-ff8080','#ff8080',0],[3,'white','#ffffff',255]
  ]);
  assert.deepEqual(apply(4,1,paint,{ ...gradient,match:'palette' },mask).map(row=>row[1]),['alias','grey','white']);
  assert.deepEqual(apply(4,1,paint,{ ...gradient,from:[3,0],to:[0,0],interpolation:'step' }).map(row=>row[1]),
    ['white','alias','alias','alias']);
  const half = { slots:Array(16).fill(2) };
  for (const pattern of ['checker','bayer']) {
    const dither = apply(4,4,half,{ type:'dither',dark:'black',light:'white',pattern });
    assert.equal(dither.filter(row=>row[1] === 'white').length,8);
    assert.deepEqual(dither.slice(0,4).map(row=>row[1]),['white','black','white','black']);
  }

  const slots = Array(12).fill(null), alpha = Array(12).fill(255);
  slots[5] = slots[4] = 0;
  slots[6] = -2;
  alpha[5] = 111;
  alpha[4] = 0;
  const boundary = { type:'outline',swatch:'black',radius:1 };
  const outlined = apply(4,3,{ slots,alpha },{ ...boundary,side:'both' });
  assert.deepEqual(outlined,[[1,'black','#000000',255],[5,'black','#000000',111],[9,'black','#000000',255]]);
  assert.deepEqual(apply(4,3,{ slots,alpha },boundary,Uint8Array.from(slots,(_,i)=>Number(i === 9))),
    [[9,'black','#000000',255]]);
});

const drawing = {
  format:'ink-studio/pixel-art',version:2,width:3,height:2,pixelAspect:[1,1],palette:swatches,
  layers:[{ id:'base' },{ id:'ink' }],
  frames:['intro','turn','outro'].map(id=>({ id,durationMs:125,cels:{
    base:{ slots:['black',null,null,null,null,null],marks:[] },
    ink:{ id:id+'-figure',slots:['red','red','alias',null,null,null],marks:[
      { alpha:64,runs:[[0,0,1]] },{ alpha:0,runs:[[0,1,1]] }
    ] }
  } })),
  selections:[{ id:'partial',pixels:[[0,0],[1,0]] },{ id:'single',frame:'intro',pixels:[[0,0]] }]
};
const patch = (editor,scope,adjustment,id = 'adjust') => ({
  id,destination:'adjustments',revision:editor.describe().revision,operation:{ scope,adjustment }
});

test('a saved mask and inclusive frame range commit as one edit on the chosen layer', () => {
  const scope = { frames:['intro','turn'],layer:'ink',selection:'partial' };
  const editor = ink.createPixelEditor(drawing), op = patch(editor,scope,{ type:'hue-saturation',degrees:120 });
  const preview = editor.previewEdit(op);
  assert.equal(preview.valid,true);
  assert.deepEqual(preview.targets[0].frames,['intro','turn']);
  assert.equal(preview.targets[0].pixelCount,4);
  assert.deepEqual(preview.targets[0].cels.map(row=>row.cel),['intro-figure','turn-figure']);
  assert.deepEqual(preview.targets[0].cels[0].runs,[[0,0,2]]);
  assert.deepEqual(preview.targets[0].addedSwatches,['rgb-00ff00']);
  assert.deepEqual(editor.snapshot(),drawing);
  const revised = editor.apply(op), receipt = editor.receipts()[0];
  assert.equal(receipt.command.frame,null);
  assert.deepEqual(receipt.affectedTargets[0],preview.targets[0]);
  assert.deepEqual(revised.frames[2],drawing.frames[2]);
  assert.deepEqual(revised.frames[0].cels.base,drawing.frames[0].cels.base);
  const raw = x=>editor.sample([x,0],{ mode:'layer',layer:'ink' });
  assert.deepEqual([raw(0).swatch,raw(0).alpha],['rgb-00ff00',64]);
  assert.deepEqual([raw(1).swatch,raw(1).alpha],['rgb-00ff00',0]);
  assert.equal(raw(2).swatch,'alias');
  assert.deepEqual(ink.createPixelEditor(drawing).replay(receipt),revised);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),drawing);
  assert.equal(editor.redo(),true);
  assert.deepEqual(editor.snapshot(),revised);
});

test('blocked writes leave every frame intact and invalid scopes surface in preview', () => {
  const scope = { frames:['intro','turn'],layer:'ink' }, adjust = { type:'hue-saturation',degrees:120 };
  const locked = { ...drawing, protectedDetails:[{ id:'hold',frame:'turn',pixels:[[0,0]] }] };
  const editor = ink.createPixelEditor(locked), op = patch(editor,scope,adjust);
  assert.deepEqual(editor.previewEdit(op).conflicts[0].at,[0,0]);
  assert.throws(()=>editor.apply(op),error=>error.receipt.conflicts[0].code === 'protected-pixel');
  assert.deepEqual(editor.snapshot(),locked);
  assert.equal(editor.receipts().length,0);
  const clip = ink.createPixelEditor({ ...drawing,layers:[{ id:'base' },{ id:'ink',clip:'base' }] });
  assert.equal(clip.previewEdit(patch(clip,scope,adjust)).conflicts[0].code,'clipped-pixel');
  assert.match(editor.previewEdit(patch(editor,{ ...scope,selection:'single' },adjust)).conflicts[0].message,/belongs to frame intro/);
  assert.match(editor.previewEdit(patch(editor,{ frames:['turn','intro'] },adjust)).conflicts[0].message,/document order/);
  const saturated = Object.fromEntries(Array.from({ length:250 },(_,n)=>['extra-'+n,'#222222']));
  const full = ink.createPixelEditor({ ...drawing,palette:{ ...swatches,...saturated } });
  assert.match(full.previewEdit(patch(full,{ frame:'intro' },adjust)).conflicts[0].message,/255 swatches/);
});

test('CLI previews, replays and reopens an adjustment spanning a layer and two frames', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-adjustments-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json');
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  write('drawing',drawing);
  const editor = ink.createPixelEditor(drawing);
  write('patch',patch(editor,{ frames:['turn','outro'],layer:'ink' },{ type:'replace',map:{ red:'grey' } }));
  assert.equal(cli('preview',file('drawing'),file('patch')).targets[0].pixelCount,4);
  write('receipt',cli('edit',file('drawing'),file('patch'),'--out',file('edited')));
  cli('replay',file('drawing'),file('receipt'),'--out',file('replay'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('replay'),'utf8'));
  const session = path.join(dir,'session');
  cli('session','init',session,file('drawing'));
  cli('session','begin',session);
  cli('session','apply',session,file('patch'));
  assert.deepEqual(cli('session','preview',session).targets[0].frames,['turn','outro']);
  cli('session','commit',session);
  cli('session','export',session,'--out',file('session'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('session'),'utf8'));
});
