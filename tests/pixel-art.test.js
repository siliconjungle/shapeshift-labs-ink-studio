const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compile, edit, review, stamp } = require('../cli/pixel-art.js');
const PixelStamps = require('../src/pixel-stamps.js');
const PNG = require('../cli/png.js');
const draft = require('../examples/pixel-art-tooling/relay.json');
const patch = require('../examples/pixel-art-tooling/relay-cleanup.json');
const rect = (x,y,w,h) => ({ type:'rect', rect:[x,y,w,h] });

const fixture = {
  format:'ink-studio/pixel-art', version:1, width:8, height:6,
  palette:{ ink:'#010102', tint:'#687a7f', light:'#fcf9dd' },
  layers:[
    {id:'body',marks:[{swatch:'ink',shape:rect(1,1,6,4)}]},
    {id:'rim',clip:'body',marks:[{swatch:'tint',steps:{from:[0,1],axis:'x',direction:[1,1],lengths:[2,2,2]}}]},
    {id:'opening',clip:'body',protect:true,marks:[{swatch:null,at:[3,3]}]},
    {id:'eye',clip:'body',protect:true,marks:[{swatch:'light',at:[5,3]}]}
  ]
};

test('explicit step runs stay connected diagonally and respect the silhouette clip', () => {
  const frame = compile(fixture);
  const pixels = [...frame.slots].map((slot,p)=>slot === 1 ? [p%8, Math.floor(p/8)] : null).filter(Boolean);
  assert.deepEqual(pixels, [[1,1],[2,2],[3,2],[4,3]]);
  assert.equal(frame.slots[3*8+3],-1);
  assert.equal(frame.locks[3*8+3],1);
  assert.equal(frame.slots[3*8+5],2);
  // Exact transparency keeps a deliberately near-black border in the analysis.
  assert.equal(review(frame).report.metrics.content,23);
  assert.throws(()=>compile({...fixture,layers:[...fixture.layers,{
    id:'cover',marks:[{swatch:'ink',at:[3,3]}]
  }]}),/protected pixel at 3,3/);
});

test('exact edits require the expected revision, owner and color and leave protected marks intact', () => {
  const frame = compile(draft);
  const clean = compile(edit(draft,frame,patch));
  assert.equal(review(frame).report.findings.orphan.count - review(clean).report.findings.orphan.count,7);
  assert.equal(review(clean).report.protectedMarks.orphan,3);
  assert.throws(()=>edit(draft,frame,{...patch,revision:'stale'}),/observed revision/);
  assert.throws(()=>edit(draft,frame,{...patch,edits:[{at:[13,22],layer:'shell',from:'yellow',to:'ink'}]}),/no longer applies/);
  assert.throws(()=>edit(draft,frame,{...patch,edits:[{at:[23,28],layer:'approved-accents',from:'spark',to:'ink'}]}),/no longer applies/);
  for (let p = 0; p < frame.slots.length; p++) if (frame.locks[p]) assert.equal(frame.slots[p],clean.slots[p]);
  assert.deepEqual(stamp(clean).slots.map(n=>n===null?-1:n),[...clean.slots]);
});

test('CLI output can be inspected and round-trips through the existing pixel stamp path', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-art-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const cwd = path.resolve(__dirname,'..');
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{cwd,encoding:'utf8'});
  const file = 'examples/pixel-art-tooling/relay.json';
  const mark = JSON.parse(cli('inspect',file,'--at','13,22'));
  assert.deepEqual([mark.layer,mark.swatch,mark.protected],['freckles','yellow',false]);
  assert.deepEqual(mark.underneath,{ layer:'ceramic-masses', swatch:'ceramic-light' });
  const saved = path.join(out,'edit.json');
  cli('edit',file,'examples/pixel-art-tooling/relay-cleanup.json','--out',saved);
  cli('draw',saved,'--out',out);
  const indexed = JSON.parse(fs.readFileSync(path.join(out,'stamp.json')));
  const rendered = PixelStamps.image(indexed);
  const decoded = PNG.raster(path.join(out,'art.png'));
  assert.deepEqual([...rendered.rgba],[...decoded.data]);
});

test('a named object can be traced on its native grid and redrawn as an indexed layer', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-art-trace-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const cwd = path.resolve(__dirname,'..');
  execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','trace','examples/sdf-gatehouse.js',
    '--subject','gatehouse','--w','64','--h','40','--out',directory],{cwd});
  const traced = JSON.parse(fs.readFileSync(path.join(directory,'design.json')));
  const frame = compile(traced);
  assert.deepEqual([frame.width,frame.height],[64,40]);
  assert.equal(frame.layerIds[1],'projection');
  assert(frame.slots.some(slot=>slot>=0));
  assert(frame.slots.includes(-1));
  assert.deepEqual([...PixelStamps.image(stamp(frame)).rgba],
    [...PNG.raster(path.join(directory,'art.png')).data]);
});
