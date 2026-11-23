const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPixelEditor } = require('..');
const { compile, edit, review, stamp, validate } = require('../cli/pixel-art.js');
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

test('opening a legacy design preserves live clips, staircases, indexed slots and protected details', t => {
  const source = structuredClone(fixture);
  source.note = { author:'relay workshop' };
  source.layers[0].slots = Array(source.width*source.height).fill(null);
  source.layers[0].slots[0] = 'ink';
  const old = compile(source);
  const editor = createPixelEditor(JSON.stringify(source));
  const upgraded = editor.snapshot();
  assert.equal(upgraded.version,2);
  assert.deepEqual(upgraded.pixelAspect,[1,1]);
  assert.deepEqual(upgraded.palette,source.palette);
  assert.deepEqual(upgraded.legacyMetadata,{ note:source.note });
  assert.deepEqual(upgraded.layers,source.layers.map(({marks,slots,...layer})=>layer));
  assert.equal(upgraded.frames.length,1);
  const { id, durationMs, cels } = upgraded.frames[0];
  assert.deepEqual([id,durationMs],['artwork',100]);
  for (const layer of source.layers) {
    assert.equal(cels[layer.id].id,id+'/'+layer.id);
    assert.deepEqual(cels[layer.id].marks,layer.marks);
    assert.deepEqual(cels[layer.id].slots,layer.slots);
  }
  const current = compile(upgraded);
  for (const key of ['slots','owners','locks','underSlots','underOwners'])
    assert.deepEqual(current[key],old[key]);

  const gap = editor.inspect([3,3]);
  assert.deepEqual([gap.cel,gap.swatch,gap.protected],['artwork/opening',null,true]);
  assert.throws(()=>editor.apply({ revision:gap.revision, frame:gap.frame, id:'close-gap',
    edits:[{ at:[3,3], layer:gap.layer, from:gap.swatch, to:'ink' }]
  }),/no longer applies/);
  assert.deepEqual(editor.snapshot(),upgraded);

  const rim = editor.inspect([1,1],{ cel:'artwork/rim' });
  editor.apply({ revision:rim.revision, id:'bright-rim', cel:rim.cel,
    edits:[{ at:[1,1], layer:rim.layer, from:rim.swatch, to:'light' }]
  });
  const reopened = createPixelEditor(editor.serialize());
  assert.equal(reopened.inspect([1,1]).swatch,'light');
  assert.equal(reopened.inspect([0,1]).swatch,null);
  assert.deepEqual(reopened.snapshot().frames[0].cels.rim.marks[0],source.layers[1].marks[0]);
  assert.equal(reopened.inspect([3,3]).protected,true);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-legacy-upgrade-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file = path.join(directory,'legacy.json'), out = path.join(directory,'new.json');
  fs.writeFileSync(file,JSON.stringify(source));
  execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','upgrade',file,'--out',out],
    {cwd:path.resolve(__dirname,'..')});
  assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')),upgraded);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),source);
});

test('the package API applies existing guarded repair files to freshly opened legacy artwork', () => {
  const editor = createPixelEditor(draft);
  const result = editor.apply(patch);
  const original = compile(draft);
  assert.equal(result.version,2);
  assert.deepEqual(editor.stamp(),stamp(compile(edit(draft,original,patch))));
  assert.throws(()=>editor.apply(patch),/observed revision/);
  result.layers[0].id = 'copied';
  assert.notEqual(editor.snapshot().layers[0].id,'copied');
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.stamp(),stamp(original));
  assert.equal(editor.redo(),true);
  assert.equal(editor.undo(),true);
  editor.apply(patch);
  assert.equal(editor.redo(),false);
  assert.equal(draft.version,1);
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
  assert.equal(traced.version,2);
  assert.deepEqual(traced.sceneBindings,[{
    id:'projection', scene:'examples/sdf-gatehouse.js', object:'gatehouse', frame:'capture', layer:'projection'
  }]);
  assert.deepEqual([frame.width,frame.height],[64,40]);
  assert.equal(frame.layerIds[1],'projection');
  assert(frame.slots.some(slot=>slot>=0));
  assert(frame.slots.includes(-1));
  assert.deepEqual([...PixelStamps.image(stamp(frame)).rgba],
    [...PNG.raster(path.join(directory,'art.png')).data]);
});

const document = {
  format:'ink-studio/pixel-art', version:2, width:3, height:2, pixelAspect:[2,1],
  palette:{ brass:'#ae8640', light:'#f8e8ac' },
  layers:[{ id:'shell' },{ id:'lit', clip:'shell' }],
  frames:[
    { id:'idle', durationMs:150, cels:{ shell:{ slots:['brass','brass',null,null,null,null], marks:[] } } },
    { id:'blink', durationMs:40, cels:{
      shell:{ marks:[{ swatch:'brass', shape:rect(0,0,2,1) }] },
      lit:{ marks:[{ swatch:'light', at:[0,0] },{ swatch:'light', at:[2,0] }] }
    } }
  ],
  selections:[{ id:'shell-area', pixels:[[0,0],[1,0]] }],
  protectedDetails:[
    { id:'gap', pixels:[[2,0]] },
    { id:'glint', frame:'blink', pixels:[[0,0]] }
  ],
  sceneBindings:[{ id:'lamp', scene:'relay-stage', object:'relay', part:'lamp', revision:'asset-v1', frame:'blink', layer:'lit' }]
};

test('opening a version 2 document preserves its authored frames and scene bindings', () => {
  const source = structuredClone(document);
  const editor = createPixelEditor(source);
  source.sceneBindings[0].object = 'mutated';
  assert.deepEqual(editor.snapshot(),document);
  assert.deepEqual(JSON.parse(editor.serialize()),document);
  assert.equal(editor.inspect([0,0],{ cel:'blink/lit' }).frame,'blink');
  assert.throws(()=>editor.inspect([0,0],{ frame:'idle', cel:'blink/lit' }),/Unknown pixel cel blink\/lit on frame idle/);
});

test('document validation checks frame and layer references and cels outside the current frame', () => {
  const legacy = validate(draft);
  assert.equal(legacy.version,1);
  assert.equal(legacy.revision,patch.revision);
  assert.deepEqual(validate(document).frames,[{ id:'idle', durationMs:150 },{ id:'blink', durationMs:40 }]);
  assert.throws(()=>validate({...document, version:3}),/version 1 or 2/);
  assert.throws(()=>validate({...document, pixelAspect:[2,0]}),/positive integers/);
  assert.throws(()=>validate({...document, frames:[...document.frames,document.frames[0]]}),/unique IDs/);
  assert.throws(()=>validate({...document, selections:[{ id:'outside', pixels:[[3,1]] }]}),/outside the native grid/);
  assert.throws(()=>validate({...document, protectedDetails:[{ id:'gap', frame:'absent', pixels:[[2,0]] }]}),/known frames/);
  assert.throws(()=>validate({...document, sceneBindings:[{ ...document.sceneBindings[0], layer:'absent' }]}),/frame and layer scopes/);
  const invalid = structuredClone(document);
  invalid.frames[1].cels.lit.marks[0].swatch = 'absent';
  assert.equal(compile(invalid).id,'idle');
  assert.throws(()=>validate(invalid),/Pixel frame blink: Unknown pixel swatch absent/);
});

test('raster edits address a cel by ID after moving it and changing labels and palette order', t => {
  const design = structuredClone(document);
  design.layers[0].label = 'Shell paint';
  design.palette = { light:{color:'#f8e8ac',label:'Bright paint'}, brass:'#ae8640' };
  const cel = design.frames[0].cels.shell;
  cel.id = 'beat-paint';
  cel.label = 'Opening paint';
  const report = validate(design);
  assert.deepEqual(report.identities.cels.find(target=>target.id === 'beat-paint'),
    { id:'beat-paint', frame:'idle', layer:'shell', label:'Opening paint' });
  assert.equal(report.identities.cels.find(target=>target.id === 'blink/shell').layer,'shell');
  design.frames.reverse();
  design.layers.push({ id:'trim', label:'Paint' });
  const idle = design.frames.find(frame=>frame.id === 'idle');
  delete idle.cels.shell;
  idle.cels.trim = { ...cel, label:'Trim paint' };
  const frame = compile(design,'idle');
  const patch = {
    revision:frame.revision, id:'trim-fix', cel:'beat-paint',
    edits:[{ at:[0,0], layer:'trim', from:'brass', to:'light' }]
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-cel-id-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename = name=>path.join(directory,name+'.json');
  fs.writeFileSync(filename('design'),JSON.stringify(design));
  fs.writeFileSync(filename('patch'),JSON.stringify(patch));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{
    cwd:path.resolve(__dirname,'..'),encoding:'utf8'
  });
  cli('edit',filename('design'),filename('patch'),'--out',filename('revised'));
  const revised = JSON.parse(fs.readFileSync(filename('revised'),'utf8'));
  assert.deepEqual(revised.layers,design.layers);
  assert.deepEqual(stamp(compile(revised,'idle')).palette,['#f8e8ac','#ae8640']);
  assert.equal(compile(revised,'idle').slots[0],0);
  assert.equal(revised.frames[1].cels.trim.id,'beat-paint');
  assert.equal(JSON.parse(cli('inspect',filename('revised'),'--frame','idle','--at','0,0')).cel,'beat-paint');
  assert.throws(()=>validate({ ...design, frames:[{
    ...idle, cels:{ ...idle.cels, shell:{ id:'beat-paint', marks:[] } }
  }] }),/Duplicate pixel cel ID/);
});

test('the CLI round-trips a frame edit and preserves protected details and scene bindings', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-document-'));
  t.after(()=>fs.rmSync(out,{ recursive:true, force:true }));
  const cwd = path.resolve(__dirname,'..');
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{ cwd, encoding:'utf8' });
  const source = path.join(out,'document.json'), patchFile = path.join(out,'patch.json'), saved = path.join(out,'saved.json');
  fs.writeFileSync(source,JSON.stringify(document));
  assert.deepEqual(JSON.parse(cli('validate',source)),validate(document));
  const blink = compile(document,'blink'), idle = compile(document);
  assert.deepEqual([...blink.slots],[1,0,-1,-1,-1,-1]);
  assert.deepEqual([...idle.slots],[0,0,-1,-1,-1,-1]);
  const inspect = (x,y)=>JSON.parse(cli('inspect',source,'--frame','blink','--at',x+','+y));
  const detail = inspect(0,0);
  assert.deepEqual([detail.frame,detail.durationMs,detail.swatch,detail.protected],['blink',40,'light',true]);
  assert.deepEqual(detail.pixelAspect,[2,1]);
  assert.deepEqual([inspect(2,0).swatch,inspect(2,0).protected],[null,true]);
  const repair = {
    revision:blink.revision, frame:'blink', id:'repair', edits:[{ at:[1,0], layer:'shell', from:'brass', to:'light' }]
  };
  assert.throws(()=>edit(document,idle,repair),/observed frame ID/);
  assert.throws(()=>edit(document,blink,{
    ...repair, edits:[{ at:[2,0], layer:null, from:null, to:'light' }]
  }),/no longer applies at 2,0/);
  const movedSelection = {...document, selections:[]};
  assert.throws(()=>edit(movedSelection,blink,repair),/revision no longer matches/);
  fs.writeFileSync(patchFile,JSON.stringify(repair));
  cli('edit',source,patchFile,'--out',saved);
  const revised = JSON.parse(fs.readFileSync(saved,'utf8'));
  assert.deepEqual(revised.frames[0],document.frames[0]);
  for (const key of ['pixelAspect','selections','protectedDetails','sceneBindings'])
    assert.deepEqual(revised[key],document[key]);
  assert.notEqual(validate(revised).revision,blink.revision);
  cli('draw',saved,'--frame','blink','--out',out);
  const report = JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.deepEqual([report.frame,report.grid,report.pixelAspect],['blink',[3,2],[2,1]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'stamp.json'),'utf8')).slots,[1,1,null,null,null,null]);
});
