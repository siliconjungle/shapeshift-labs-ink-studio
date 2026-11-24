const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const Cleanup = require('../src/pixel-cleanup.js');

const swatches = ['ink','rust','sky'], colors = [0x142839,0xc65126,0x6899aa];

function raster(lines,coverage) {
  const width = lines[0].length, height = lines.length;
  const slots = lines.flatMap(line=>[...line].map(value=>value === '.' ? -1 : value === '-' ? -2 : Number(value)));
  const alpha = new Uint8Array(slots.length).fill(255);
  for (const [x,y,a] of coverage ?? []) alpha[y*width+x] = a;
  return { width,height,slots,alpha,swatches,colors };
}

function select(source,points) {
  const mask = new Uint8Array(source.width*source.height);
  for (const [x,y] of points) mask[y*source.width+x] = 1;
  return mask;
}

function report(source,points,settings) {
  return Cleanup.plan(source,select(source,points),settings);
}

const stair = raster([
  '.........',
  '.0.......',
  '..00000..',
  '.......0.',
  '.........'
],[[2,2,110],[6,2,82]]);
const all = ({ width,height })=>Array.from({ length:width*height },(_,p)=>[p%width,Math.floor(p/width)]);

test('stair cleanup keeps endpoints and coverage and reports the exact four changes', () => {
  const { changes } = report(stair,all(stair),{ kind:'stair',maxChanges:4 });
  assert.deepEqual(changes.map(change=>[change.at,change.before.rgba?.[3],change.after.rgba?.[3]]),
    [[[2,1],undefined,110],[[2,2],110,undefined],[[6,2],82,undefined],[[6,3],undefined,82]]);
  assert.throws(()=>report(stair,all(stair),{ kind:'stair',maxChanges:3 }),/3 pixel budget/);
  const justInk = all(stair).filter(([x,y])=>stair.slots[y*stair.width+x] >= 0);
  assert.throws(()=>report(stair,justInk,{ kind:'stair' }),/Extend the selection/);
  const occupied = { ...stair,slots:stair.slots.slice() };
  occupied.slots[11] = -2;
  assert.throws(()=>report(occupied,all(stair),{ kind:'stair' }),/overwrite an authored cell/);
});

test('fragment cleanup preserves alpha and resolves ambiguous donors explicitly', () => {
  const source = raster([
    '.......',
    '.00122.',
    '.00.22.',
    '.......'
  ],[[3,1,96]]);
  const which = [[3,1]];
  assert.throws(()=>report(source,which,{ kind:'fragment' }),/Choose a swatch/);
  const { changes } = report(source,which,{ kind:'fragment',swatch:'sky' });
  assert.deepEqual(changes,[{ at:[3,1],before:{ state:'paint',swatch:'rust',rgba:[198,81,38,96] },
    after:{ state:'paint',swatch:'sky',rgba:[104,153,170,96] } }]);
  assert.throws(()=>report(source,which,{ kind:'fragment',at:[4,1] }),/seed pixel inside/);
});

test('outline cleanup only removes a doubled stepping corner and keeps its two arms', () => {
  const source = raster(['.........','.........','.......0.','......0..','....00...','....0....','...0.....','.........']);
  const { changes } = report(source,[[4,4],[5,4]],{ kind:'outline' });
  assert.deepEqual(changes.map(row=>[row.at,row.after.state]),[[[4,4],'clear']]);
  assert.throws(()=>report(source,[[5,4]],{ kind:'outline' }),/Select a doubled inside corner/);
});

test('cluster growth respects the selection and shrinking keeps a narrow bridge', () => {
  const source = raster(['........','.00..00.','.000000.','.00..00.','........']);
  const { changes } = report(source,[[2,1],[2,0],[2,2]],{ kind:'cluster',mode:'grow' });
  assert.deepEqual(changes.map(row=>[row.at,row.after.swatch]),[[[2,0],'ink']]);
  const trim = report(source,[[1,1],[3,2]],{ kind:'cluster',mode:'shrink' });
  assert.deepEqual(trim.changes.map(row=>row.at),[[1,1]]);
  const separate = raster(['.......','.00.00.','.00.00.','.......']);
  assert.deepEqual(report(separate,[[2,1],[3,1]],{ kind:'cluster',mode:'grow' }).changes,[]);
});

function document(source) {
  const { width,height,slots } = source;
  const marks = [];
  for (let p = 0; p < slots.length; p++) if (slots[p] >= 0 && source.alpha[p] !== 255)
    marks.push({ alpha:source.alpha[p],runs:[[Math.floor(p/width),p%width,1]] });
  const cel = { slots:slots.map(slot=>swatches[slot] ?? null),marks };
  return { format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],
    palette:Object.fromEntries(swatches.map((id,i)=>[id,'#'+colors[i].toString(16).padStart(6,'0')])),
    layers:[{ id:'paint' }],frames:[{ id:'front',durationMs:100,cels:{ paint:cel } },
      { id:'side',durationMs:100,cels:{ paint:cel } }],selections:[{ id:'region',frame:'front',pixels:all(source) }] };
}

const request = (editor,operation) => ({
  id:'cleanup-test',revision:editor.describe().revision,frame:'front',operation:{ tool:'cleanup',layer:'paint',...operation }
});

test('cleanup gives complete cel diffs even under other layers and commits only the selected frame', () => {
  const source = document(stair);
  source.layers.push({ id:'cover' });
  source.frames[0].cels.cover = { marks:all(stair).map(at=>({ at,swatch:'sky' })) };
  const editor = ink.createPixelEditor(source);
  const patch = request(editor,{ kind:'stair',selection:'region' });
  const preview = editor.previewEdit(patch,{ limit:0 });
  assert.equal(preview.valid,true);
  assert.equal(preview.pixelCount,0);
  assert.equal(preview.targets[0].pixelCount,4);
  assert.equal(preview.targets[0].changes.length,4);
  assert.deepEqual(editor.snapshot(),source);
  const revised = editor.apply(patch);
  assert.deepEqual(preview.targets[0].changes[0].after.rgba,[20,40,57,110]);
  assert.equal(editor.sample([2,1],{ mode:'layer',layer:'paint' }).alpha,110);
  const [receipt] = editor.receipts();
  assert.deepEqual(preview.targets,receipt.affectedTargets);
  assert.deepEqual(revised.frames[1],source.frames[1]);
  assert.deepEqual(ink.createPixelEditor(source).replay(receipt),revised);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),source);
  assert.equal(editor.redo(),true);
  assert.throws(()=>editor.apply(patch),/observed revision/);
});

test('protected and clipped pixels block the whole repair, including preview and receipt', () => {
  const source = document(stair);
  source.protectedDetails = [{ id:'gap',kind:'gap',frame:'front',pixels:[[6,3]] }];
  const editor = ink.createPixelEditor(source);
  const patch = request(editor,{ kind:'stair',selection:'region' });
  const guard = editor.previewEdit(patch);
  assert.equal(guard.conflicts[0].code,'protected-pixel');
  assert.deepEqual(guard.conflicts[0].at,[6,3]);
  assert.throws(()=>editor.apply(patch),error=>error.receipt?.status === 'rejected');
  assert.deepEqual(editor.snapshot(),source);

  const clipped = document(stair);
  const base = clipped.frames[0].cels.paint;
  const mask = { slots:[...base.slots],marks:[] };
  clipped.layers = [{ id:'hold',kind:'mask' },{ id:'paint',clip:'hold' }];
  clipped.frames[0].cels.hold = mask;
  const guarded = ink.createPixelEditor(clipped);
  const blocked = guarded.previewEdit(request(guarded,{ kind:'stair',selection:'region' }));
  assert.equal(blocked.conflicts[0].code,'clipped-pixel');
});

test('CLI previews, applies and replays the same exact repair', t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-cleanup-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const file = name=>path.join(directory,name+'.json');
  const source = document(stair), editor = ink.createPixelEditor(source);
  fs.writeFileSync(file('source'),JSON.stringify(source));
  fs.writeFileSync(file('patch'),JSON.stringify(request(editor,{ kind:'stair',selection:'region' })));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  const preview = run('preview',file('source'),file('patch'));
  const receipt = run('edit',file('source'),file('patch'),'--out',file('revised'));
  assert.deepEqual(preview.targets,receipt.affectedTargets);
  assert.equal(preview.targets[0].changes.length,4);
  fs.writeFileSync(file('receipt'),JSON.stringify(receipt));
  run('replay',file('source'),file('receipt'),'--out',file('replayed'));
  assert.deepEqual(fs.readFileSync(file('replayed')),fs.readFileSync(file('revised')));
});
