const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const Craft = require('../src/pixel-craft.js');

function fixture(lines) {
  const width = lines[0].length, height = lines.length;
  const colors = [0,0x5a5a5a,0xaaaaaa];
  const slots = lines.flatMap(line=>[...line].map(pixel=>pixel === '.' ? null : Number(pixel)));
  return { width,height,colors,slots };
}

const byKind = (lines,kind) => Craft.analyze(fixture(lines)).diagnostics.filter(row=>row.kind === kind);

test('native craft checks retain the actual cells for each of the six finding kinds', () => {
  assert.deepEqual(byKind(['...','.0.','...'],'orphan')[0].runs,[[1,1,1]]);
  const line = ['.........','.........','.......0.','......0..','....00...','....0....','...0.....','.........'];
  assert.deepEqual(byKind(line,'double').map(row=>row.at),[[4,4]]);
  const elbow = ['.........','..0000...','..0......','..0......','..0......','.........'];
  assert.deepEqual(byKind(elbow,'double'),[]);
  const stairs = ['............','.00.........','...0........','....000.....','.......0....','........00..','..........0.'];
  assert.deepEqual(byKind(stairs,'jaggy')[0].runs,[[3,4,3],[4,7,1]]);
  const band = ['........','..012...','..012...','..012...','..012...','........'];
  assert.deepEqual(byKind(band,'band')[0].bounds,[3,1,1,4]);
  const touch = ['......','.00...','.00...','...11.','...11.','......'];
  assert.deepEqual(byKind(touch,'tangent')[0].runs,[[2,2,1],[3,3,1]]);
  const broad = ['......','.0011.','.0011.','......'];
  assert.deepEqual(byKind(broad,'tangent'),[]);
  const pocket = ['.......','.00000.','.00.00.','.00000.','.......'];
  assert.deepEqual(byKind(pocket,'hole')[0].at,[3,2]);
  const open = ['.......','.00.00.','.00.00.','.00000.','.......'];
  const diagonal = ['.......','.000.0.','.00.00.','.00000.','.......'];
  const large = ['........','.000000.','.0....0.','.0....0.','.0....0.','.000000.','........'];
  for (const art of [open,diagonal,large]) assert.deepEqual(byKind(art,'hole'),[]);
});

test('navigation clusters retain exact editable runs and a separate protected footprint',()=>{
  const frame = fixture(['........','..012...','..012...','..012...','..012...','........']);
  const locks = new Uint8Array(frame.width*frame.height);
  locks[19] = 1;
  const { diagnostics } = Craft.analyze({ ...frame,locks });
  const band = diagnostics.find(row=>row.kind === 'band');
  assert.equal(band.id,'band-3-1');
  assert.equal(band.pixelCount,4);
  assert.equal(band.protectedCount,1);
  assert.deepEqual(band.runs,[[1,3,1],[2,3,1],[3,3,1],[4,3,1]]);
  assert.deepEqual(band.editableRuns,[[1,3,1],[3,3,1],[4,3,1]]);
});

test('the SDK and CLI address findings by frame, layer, kind and ID', t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-craft-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const pathTo = name=>path.join(directory,name);
  const pocket = fixture(['.......','.00000.','.00.00.','.00000.','.......']);
  const subject = { slots:pocket.slots.map(slot=>slot === null ? null : 'ink'),marks:[] };
  const document = {
    format:'ink-studio/pixel-art',version:2,width:pocket.width,height:pocket.height,pixelAspect:[1,1],
    palette:{ ink:'#000000',glint:'#ffff88' },layers:[{ id:'shell' },{ id:'glint' }],
    frames:[{ id:'front',durationMs:100,cels:{ shell:subject,glint:{ marks:[{ at:[0,0],swatch:'glint' }] } } },
      { id:'side',durationMs:100,cels:{ shell:subject } }],
    protectedDetails:[{ id:'pin-hole',kind:'gap',frame:'front',pixels:[[3,2]] }]
  };
  const editor = ink.createPixelEditor(document);
  const front = editor.lint({ kind:'hole' });
  assert.equal(front.findings.hole.count,0);
  assert.equal(front.protectedMarks.hole,1);
  assert.equal(front.diagnostics[0].protectedCount,1);
  assert.deepEqual(front.diagnostics[0].editableRuns,[]);
  assert.equal(editor.lint({ layer:'glint' }).diagnostics[0].layers[0],'glint');
  const side = editor.lint({ cel:'side/shell',finding:'hole-3-2' });
  assert.equal(side.frame,'side');
  assert.equal(side.layer,'shell');
  assert.equal(side.findings.hole.count,1);
  assert.throws(()=>editor.lint({ finding:'hole-6-6' }),/No diagnostic/);
  assert.throws(()=>editor.lint({ kind:'constructor' }),/diagnostic kind/);
  const input = pathTo('art.json'), output = pathTo('report.json');
  fs.writeFileSync(input,JSON.stringify(document));
  const run = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  run('lint',input,'--cel','side/shell','--finding','hole-3-2','--out',output);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),side);
  run('draw',input,'--frame','side','--out',pathTo('draw'));
  assert.deepEqual(JSON.parse(fs.readFileSync(pathTo('draw/report.json'),'utf8')).diagnostics,side.diagnostics);
});
