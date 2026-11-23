const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ink = require('..');
const { compile, validate } = require('../cli/pixel-art.js');
const { signature } = require('../cli/render-row-assets.js');
const SplatFit = require('../cli/splat-fit-asset.js');
const PNG = require('../cli/png.js');

const { KIT } = ink.load();
const cwd = path.resolve(__dirname,'..');
const cliArgs = (...args) => ['cli/ink-studio.js',...args];
const cli = (...args) => execFileSync(process.execPath,cliArgs(...args),{ cwd, encoding:'utf8' });
const view = { w:40, h:32, px:1, raw:true, transparent:true };
const source = {
  id:'pixel-edit-gate', style:'slate', seed:4,
  camera:{ target:[0,0,0], dist:4, pitch:0, yaw:0, projection:'orthographic', sway:0 },
  solids:[
    { id:'gate', kind:'box', at:[0,0,0], half:[.8,.7,.23], res:.15, mat:'stone',
      surfaceState:{ charts:{ front:{ origin:[-.8,-.7,.23], u:[1.6,0,0], v:[0,1.4,0], depth:.08 } } } },
    { id:'post', kind:'box', at:[1.05,0,0], half:[.13,.7,.23], res:.15, mat:'stone' }
  ]
};

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-edit-destinations-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true, force:true }));
  const filename = name => path.join(directory,name+'.json');
  const write = (name,value) => fs.writeFileSync(filename(name),JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(filename(name),'utf8'));
  write('source',source);
  const bindings = [
    { id:'plate', scene:filename('source'), object:'gate', frame:'front' },
    { id:'solid', scene:filename('source'), object:'gate' }
  ];
  const document = {
    format:'ink-studio/pixel-art', version:2, width:view.w, height:view.h, pixelAspect:[1,1],
    palette:{ amber:'#ffca33' }, layers:[{ id:'base' }],
    frames:[{ id:'front', durationMs:100, cels:{} },{ id:'rear', durationMs:100, cels:{} }],
    protectedDetails:[{ id:'hold', pixels:[[0,0]] }],
    sceneBindings:bindings,
    destinations:[
      { id:'pixels', kind:'raster' },
      { id:'one-shot', kind:'shot-correction', binding:'plate' },
      { id:'patina', kind:'surface-channel', binding:'solid', chart:'front', channel:'paint' },
      { id:'footprint', kind:'splat-attributes', binding:'plate' },
      { id:'notch', kind:'sdf-shape', binding:'solid' },
      { id:'stone', kind:'sdf-material', binding:'solid' }
    ]
  };
  write('document',document);
  const request = extra => ({ revision:compile(document).revision, frame:'front', id:'detail', ...extra });
  function apply(patch, output, scene = filename('source')) {
    write('patch',patch);
    cli('pixel-art','edit',filename('document'),filename('patch'),'--scene',scene,'--out',filename(output));
    return read(output);
  }
  function reject(patch, pattern, scene = filename('source')) {
    write('patch',patch);
    const result = spawnSync(process.execPath,
      cliArgs('pixel-art','edit',filename('document'),filename('patch'),'--scene',scene,'--out',filename('invalid')),
      { cwd, encoding:'utf8' });
    assert.equal(result.status,1);
    assert.match(result.stderr,pattern);
    assert.equal(fs.existsSync(filename('invalid')),false);
  }
  const targets = (destination, limit = 128) => JSON.parse(cli('pixel-art','targets',filename('document'),
    '--destination',destination,'--scene',filename('source'),'--limit',String(limit)));
  return { document, filename, write, read, request, apply, reject, targets };
}

test('pixel destinations route raster, shot and splat edits through their native consumers', t => {
  const { document, filename, request, apply, reject } = setup(t);
  assert.deepEqual(validate(document).destinations,document.destinations);
  const world = KIT.diorama.build(source);
  const baseline = ink.render(world,{ ...view, captureShotCorrectionSurface:true });
  const at = [20,16];
  const { target, ...anchor } = baseline.shotCorrectionSurface.pin(...at);
  assert.equal(target.object,'gate');
  assert.equal(typeof anchor.splat,'string');
  const edits = [{ at, layer:null, from:null, to:'amber' }];
  const raster = apply(request({ destination:'pixels', edits }),'raster');
  assert.equal(compile(raster,'front').slots[16*40+20],0);
  assert.equal(compile(raster,'rear').slots[16*40+20],-1);
  const shot = request({ destination:'one-shot', edits, operation:{ at, fps:10, frames:[0,0], anchor } });
  const corrections = apply(shot,'shot');
  assert.deepEqual(corrections.corrections[0].pixels,[[0,0,'#ffca33']]);
  assert.deepEqual(corrections.corrections[0].anchor.target,{ object:'gate' });
  const output = filename('render').replace(/\.json$/,'.png');
  cli('render',filename('source'),'--w','40','--h','32','--px','1','--shot-corrections',filename('shot'),'--out',output);
  const corrected = PNG.raster(output);
  assert.deepEqual([...corrected.data.slice((16*40+20)*4,(16*40+20)*4+3)],[255,202,51]);
  assert.equal(ink.render(world,{ ...view, t:.2, shotCorrections:corrections }).shotCorrections.corrections.length,0);
  reject({ ...shot, frame:'rear' },/bound to frame front/);
  reject({ ...shot, edits:[{ ...edits[0], at:[0,0] }] },/no longer applies/);
  reject(shot,/Pass --scene/,filename('wrong-scene'));

  const rows = require('../src/target-selectors.js').index(world);
  const inside = Array.from({ length:world.count },(_,i)=>i)
    .filter(i=>rows.row(i).object === 'gate' && SplatFit.eligible(world,i));
  assert(inside.length > 2);
  const asset = apply(request({ destination:'footprint', operation:{
    splats:inside.map((splat,i)=>i === 0 ? { splat, footprintScale:.5 } : { splat, visible:false })
  } }),'fit');
  assert.equal(asset.signature,signature(world));
  const fitted = ink.render(world,{ ...view, splatFit:asset });
  assert.notDeepEqual(fitted.alpha,baseline.alpha);
  const outside = Array.from({ length:world.count },(_,i)=>i).find(i=>rows.row(i).object === 'post');
  reject(request({ destination:'footprint', operation:{ splats:[{ splat:outside, visible:false }] } }),/outside binding/);
});

test('a stable splat edit resolves the same sample after a scene reorder', t => {
  const { request, apply, targets } = setup(t);
  const report = targets('footprint',1);
  assert(report.count > 1);
  assert.equal(report.splats.length,1);
  const splat = report.splats[0].id;
  const asset = apply(request({ destination:'footprint', operation:{ splats:[{ splat, visible:false }] } }),'stable-fit');
  assert.equal(asset.version,2);
  assert.deepEqual(asset.edits,[[splat,0]]);
  const initial = KIT.diorama.build(source);
  const reordered = KIT.diorama.build({ ...source, solids:source.solids.slice().reverse().map(solid =>
    ({ ...solid, label:'Revised ' + solid.id })) });
  const ids = KIT.procedural.splatProvenance.identities;
  const before = ids(initial).rowOf(splat), after = ids(reordered).rowOf(splat);
  assert(before >= 0 && after >= 0);
  assert.notEqual(before,after);
  assert.equal(SplatFit.prepare(initial,asset)[before],0);
  assert.equal(SplatFit.prepare(reordered,asset)[after],0);
  assert.equal(SplatFit.prepare(reordered,asset)[before],1);
  const missing = KIT.procedural.splatProvenance.subset(reordered,
    Array.from({length:reordered.count},(_,i)=>i).filter(i=>i!==after));
  assert.throws(()=>SplatFit.prepare(missing,asset),/unavailable splat fit target/);
});

test('CLI receipts replay authored and sampled shot edits on the original inputs', t => {
  const { filename, write, read, request, targets } = setup(t);
  const world = KIT.diorama.build(source), at = [20,16], offSurface = [0,31];
  const frame = ink.render(world,{ ...view, captureShotCorrectionSurface:true });
  const { target,...anchor } = frame.shotCorrectionSurface.pin(...at);
  assert.equal(target.object,'gate');
  const shot = request({ destination:'one-shot',
    edits:[at,offSurface].map(at=>({ at,layer:null,from:null,to:'amber' })),
    operation:{ at, fps:10, frames:[0,0], anchor }
  });
  write('patch',shot);
  const args = ['--scene',filename('source'),'--shot-hit-frame','0'];
  const run = (action,name,output,options = args) => ['pixel-art',action,filename('document'),filename(name),
    ...options,'--out',filename(output)];
  const receipt = JSON.parse(cli(...run('edit','patch','shot')));
  assert.equal(receipt.format,'ink-studio/pixel-edit-receipt');
  assert.deepEqual(receipt.command.patch,shot);
  assert.equal(receipt.inputs.documentRevision,shot.revision);
  assert.equal(receipt.inputs.sourceRevision,targets('one-shot').sourceRevision);
  assert.equal(receipt.affectedTargets[0].anchor.id,anchor.splat);
  assert.equal(receipt.shotHits.painted,1);
  assert.deepEqual(receipt.skippedHits.map(hit=>[hit.at,hit.reason]),[[offSurface,'no-surface']]);
  assert.equal(receipt.outputs.documentRevision,shot.revision);
  assert.match(receipt.outputs.artifactRevision,/^[a-f0-9]{64}$/);
  write('receipt',receipt);
  assert.deepEqual(JSON.parse(cli(...run('replay','receipt','replayed'))),receipt);
  assert.deepEqual(read('replayed'),read('shot'));

  const changedOptions = spawnSync(process.execPath,
    cliArgs(...run('replay','receipt','wrong-options',args.slice(0,2))),{ cwd, encoding:'utf8' });
  assert.equal(changedOptions.status,1);
  assert.equal(JSON.parse(changedOptions.stdout).conflicts[0].code,'receipt-arguments');
  assert.equal(fs.existsSync(filename('wrong-options')),false);

  const unguarded = JSON.parse(cli(...run('edit','patch','deferred',args.slice(0,2))));
  assert.equal(unguarded.shotHits.status,'deferred-to-render');
  assert.deepEqual(read('deferred'),read('shot'));
  write('source',{ ...source, camera:{ ...source.camera, yaw:.25 } });
  const stale = spawnSync(process.execPath,cliArgs(...run('replay','receipt','stale')),{ cwd, encoding:'utf8' });
  assert.equal(stale.status,1);
  assert.equal(JSON.parse(stale.stdout).conflicts[0].code,'stale-source');
  assert.equal(fs.existsSync(filename('stale')),false);

  write('patch',{ ...shot, edits:[{ ...shot.edits[0], at:[0,0] }] });
  const rejected = spawnSync(process.execPath,cliArgs(...run('edit','patch','rejected')),{ cwd, encoding:'utf8' });
  assert.equal(rejected.status,1);
  const failure = JSON.parse(rejected.stdout);
  assert.equal(failure.status,'rejected');
  assert.equal(failure.outputs,null);
  assert.equal(failure.skippedHits[0].code,'protected-pixel');
  assert.deepEqual(failure.skippedHits[0].at,[0,0]);
  assert.equal(fs.existsSync(filename('rejected')),false);
});

test('pixel destinations retain edits on a rest chart and the selected SDF solid', t => {
  const { document, filename, write, request, apply, reject, targets } = setup(t);
  const baseline = ink.render(KIT.diorama.build(source),view);
  const stamp = { value:'#e9673b', brush:{ kind:'rect', min:[.2,.15], max:[.8,.8] } };
  const painted = apply(request({ destination:'patina', operation:{ stamp } }),'painted');
  assert.deepEqual(painted.solids[0].surfaceState.charts.front.stamps,[{ ...stamp, channel:'paint' }]);
  assert.notDeepEqual(ink.render(KIT.diorama.build(painted),view).rgb,baseline.rgb);

  const cut = { kind:'mask', mode:'cut', shape:{ kind:'box', at:[0,0,0], half:[.23,.28,.5] } };
  const carved = apply(request({ destination:'notch', operation:{ modifier:cut } }),'carved');
  assert.deepEqual(carved.solids[0].modifiers,[{ ...cut, id:'detail' }]);
  assert.notDeepEqual(ink.render(KIT.diorama.build(carved),view).alpha,baseline.alpha);
  const recolored = apply(request({ destination:'stone', operation:{ material:'accent' } }),'material');
  assert.equal(recolored.solids[0].mat,'accent');
  assert.deepEqual(recolored.solids[1],source.solids[1]);
  assert.notDeepEqual(ink.render(KIT.diorama.build(recolored),view).rgb,baseline.rgb);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename('source'),'utf8')),source);
  assert.deepEqual(targets('patina').surfaceChannel,{ object:'gate', chart:'front', channel:'paint' });

  carved.solids[0].modifiers.unshift({ id:'border', kind:'swell', by:.01 });
  carved.solids[0].label = 'Gate with aperture';
  carved.solids.reverse();
  write('source',carved);
  assert.deepEqual(targets('notch').modifiers.map(({id})=>id),['border','detail']);
  const restored = apply(request({ destination:'notch', id:'disable-detail', operation:{
    updateModifier:{ id:'detail', patch:{ enabled:false } }
  } }),'restored');
  assert.equal(restored.solids[1].modifiers[1].enabled,false);
  assert.equal(restored.solids[1].modifiers[0].enabled,undefined);

  reject(request({ destination:'stone', edits:[], operation:{ material:'accent' } }),/explicit source/);
  assert.throws(()=>validate({ ...document, destinations:[{ id:'hole', kind:'sdf-shape', binding:'unknown' }] }),
    /Unknown scene binding/);
  const pinned = structuredClone(document);
  pinned.sceneBindings[1].revision = 'stale';
  write('document',pinned);
  reject({ ...request({ destination:'stone', operation:{ material:'accent' } }), revision:compile(pinned).revision },
    /scene binding is stale/);
});

test('a shared transaction commits, undoes and redoes the pixel cel and the SDF cut together', t => {
  const { document, filename } = setup(t);
  const scene = ink.createSceneEditor(source);
  scene.setMaterial('accent','solid:post');
  const baseline = scene.snapshot();
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const at = [20,16], events = [];
  scene.onChange(({ type,snapshot }) => events.push([
    type,pixels.inspect(at).swatch,snapshot.solids[0].modifiers?.[0].id ?? null
  ]));
  pixels.transact('Carve the gate and mark the cel', editor => {
    const { revision,frame } = editor.inspect(at);
    editor.apply({ id:'cut-mark', revision, frame, edits:[{ at, layer:null, from:null, to:'amber' }] });
    editor.apply({ id:'notch-cut', frame, revision:editor.describe().revision, destination:'notch',
      operation:{ modifier:{ kind:'mask', mode:'cut', shape:{ kind:'box', at:[0,0,0], half:[.2,.3,.5] } } }
    });
  });
  const committed = scene.snapshot(), painted = pixels.snapshot();
  const receipts = pixels.receipts();
  assert.equal(committed.solids[0].modifiers[0].id,'notch-cut');
  assert.equal(pixels.inspect(at).swatch,'amber');
  assert.deepEqual(pixels.history().undo,['Set solid material','Carve the gate and mark the cel']);
  assert.equal(receipts[0].affectedTargets[0].cel,'front/cut-mark');
  assert.deepEqual(receipts[0].affectedTargets[0].pixels,[at]);
  assert.equal(receipts[0].outputs.documentRevision,receipts[1].inputs.documentRevision);
  assert.equal(receipts[1].affectedTargets[0].node,'solid:gate');
  assert.equal(receipts[1].affectedTargets[0].modifier,'notch-cut');
  assert.deepEqual(receipts[1].skippedHits,[]);

  assert.equal(scene.undo(),true);
  assert.deepEqual(scene.snapshot(),baseline);
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(pixels.receipts(),[]);
  assert.equal(pixels.redo(),true);
  assert.deepEqual(scene.snapshot(),committed);
  assert.deepEqual(pixels.snapshot(),painted);
  assert.deepEqual(pixels.receipts(),receipts);
  assert.deepEqual(events,[
    ['commit','amber','notch-cut'],['undo',null,null],['redo','amber','notch-cut']
  ]);

  const replayScene = ink.createSceneEditor(baseline);
  const replay = ink.createPixelEditor(document,{ sceneEditor:replayScene, sceneRef:filename('source') });
  const tampered = structuredClone(receipts[1]);
  tampered.outputs.artifactRevision = '0'.repeat(64);
  assert.throws(()=>replay.transact('Tampered receipt',editor=>{
    editor.replay(receipts[0]);
    editor.replay(tampered);
  }),/did not reproduce/);
  assert.deepEqual(replay.receipts(),[]);
  assert.deepEqual(replay.snapshot(),document);
  assert.deepEqual(replayScene.snapshot(),baseline);
  replay.transact('Replay the gate',editor=>{
    for (const receipt of receipts) editor.replay(receipt);
  });
  assert.deepEqual(replay.receipts(),receipts);
  assert.deepEqual(replay.snapshot(),painted);
  assert.deepEqual(replayScene.snapshot(),committed);
});

test('preview shows exact pixel and source changes before commit and leaves cancel reversible', t => {
  const { document, filename } = setup(t);
  const scene = ink.createSceneEditor(source);
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const at = [20,16], events = [];
  scene.onChange(event=>events.push(event.type));
  function stage() {
    pixels.begin('Edit the gate');
    const { revision,frame } = pixels.inspect(at);
    pixels.apply({ id:'rim-paint', revision, frame, edits:[{ at, layer:null, from:null, to:'amber' }] });
    scene.setMaterial('accent','solid:post');
    pixels.apply({ id:'gate-carve', frame, revision:pixels.describe().revision, destination:'notch',
      operation:{ modifier:{ kind:'mask', mode:'cut', shape:{ kind:'box', at:[0,0,0], half:[.2,.3,.5] } } } });
  }
  stage();
  const preview = pixels.previewChanges();
  assert.equal(preview.valid,true);
  assert.equal(preview.pixelCount,1);
  assert.deepEqual(preview.pixels.map(({frame,at,before,after})=>[frame,at,before.swatch,after.swatch,after.cel]),
    [['front',at,null,'amber','front/rim-paint']]);
  assert.deepEqual(preview.sources.map(({object,fields})=>[object,fields]),
    [['gate',['modifiers']],['post',['mat']]]);
  assert.deepEqual(preview.targets.map(({kind,object})=>[kind,object]),[['sdf-shape','gate']]);
  assert.deepEqual(pixels.history().undo,[]);
  assert.deepEqual(events,[]);
  assert.equal(pixels.cancel(),true);
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(pixels.receipts(),[]);
  assert.deepEqual(scene.snapshot(),source);
  assert.deepEqual(events,[]);

  stage();
  assert.deepEqual(pixels.previewChanges(),preview);
  assert.equal(pixels.commit(),true);
  assert.equal(pixels.inspect(at).swatch,'amber');
  assert.equal(scene.snapshot().solids[0].modifiers[0].id,'gate-carve');
  assert.deepEqual(events,['commit']);
  assert.equal(scene.undo(),true);
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(scene.snapshot(),source);
});

test('proposed edits report conflicts without changing an open draft or writing a scene file', t => {
  const { document, filename, write } = setup(t);
  const scene = ink.createSceneEditor(source);
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const patch = (id,extra) => ({ id, frame:'front', revision:pixels.describe().revision, ...extra });
  pixels.begin('Existing draft');
  scene.setMaterial('accent','solid:post');
  const sceneDraft = scene.snapshot();
  const rejected = pixels.previewEdit(patch('bad-paint',{ edits:[
    { at:[0,0], layer:null, from:null, to:'amber' },
    { at:[2,1], layer:'base', from:null, to:'amber' }
  ] }));
  assert.equal(rejected.valid,false);
  assert.deepEqual(rejected.conflicts.map(({code,at})=>[code,at]),[
    ['protected-pixel',[0,0]],['pixel-changed',[2,1]]
  ]);
  const operation = { modifier:{ kind:'mask', mode:'cut', shape:{ kind:'box', at:[0,0,0], half:[.2,.3,.5] } } };
  const edit = patch('preview-notch',{ destination:'notch', operation });
  const proposed = pixels.previewEdit(edit);
  assert.equal(proposed.valid,true);
  assert.deepEqual(proposed.sources.map(({object})=>object),['gate']);
  assert.deepEqual(scene.snapshot(),sceneDraft);
  assert.deepEqual(pixels.previewChanges().sources.map(({object})=>object),['post']);
  pixels.cancel();

  const pinned = structuredClone(document);
  pinned.sceneBindings[1].revision = 'old-scene';
  write('document',pinned);
  write('patch',{ ...edit, revision:compile(pinned).revision });
  const argumentsFor = ['pixel-art','preview',filename('document'),filename('patch'),
    '--scene',filename('source'),'--out',filename('output')];
  const invalid = spawnSync(process.execPath,cliArgs(...argumentsFor),{ cwd,encoding:'utf8' });
  assert.equal(invalid.status,2);
  const conflict = JSON.parse(invalid.stdout);
  assert.equal(conflict.valid,false);
  assert.equal(conflict.conflicts[0].code,'stale-source');
  assert.equal(conflict.targets[0].object,'gate');

  write('document',document);
  write('patch',edit);
  const ready = JSON.parse(cli(...argumentsFor));
  assert.equal(ready.valid,true);
  assert.deepEqual(ready.sources.map(({object,fields})=>[object,fields]),[['gate',['modifiers']]]);
  assert.equal(fs.existsSync(filename('output')),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename('source'),'utf8')),source);
});

test('a CLI source revision guards the inspected diorama and the resolved binding', t => {
  const { document, filename, write, request, apply, reject, targets } = setup(t);
  const inspected = targets('notch',1);
  assert.match(inspected.sourceRevision,/^[a-f0-9]{64}$/);
  assert.equal(inspected.documentRevision,compile(document).revision);
  const patch = request({ destination:'notch', operation:{ parameters:{ half:[.4,.5,.23] } } });
  const previewArgs = ['pixel-art','preview',filename('document'),filename('patch'),'--scene',filename('source')];
  write('patch',patch);
  const open = JSON.parse(cli(...previewArgs));
  assert.equal(open.sourceRevision,inspected.sourceRevision);
  assert.equal(open.warnings[0].code,'unverified-source');
  const guarded = { ...patch, sourceRevision:open.sourceRevision };
  write('patch',guarded);
  const verified = JSON.parse(cli(...previewArgs));
  assert.equal(verified.valid,true);
  assert.equal(verified.warnings,undefined);

  const changed = structuredClone(source);
  changed.solids[0].half[0] = .9;
  write('source',changed);
  const stale = spawnSync(process.execPath,cliArgs(...previewArgs),{ cwd,encoding:'utf8' });
  assert.equal(stale.status,2);
  const report = JSON.parse(stale.stdout);
  assert.equal(report.conflicts[0].code,'stale-source');
  assert.equal(report.conflicts[0].expected,guarded.sourceRevision);
  assert.equal(report.conflicts[0].actual,report.sourceRevision);
  reject(guarded,/Inspected scene source or binding has changed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename('source'),'utf8')),changed);
  assert.deepEqual(apply({ ...guarded, sourceRevision:targets('notch').sourceRevision },'guarded')
    .solids[0].half,[.4,.5,.23]);

  // Even a patch refreshed to the new document revision cannot reuse the old binding observation.
  write('source',source);
  const rebound = structuredClone(document);
  rebound.sceneBindings[1].object = 'post';
  write('document',rebound);
  reject({ ...guarded, revision:compile(rebound).revision },/Inspected scene source or binding has changed/);
});

test('a stale source guard rolls back an associated pixel edit', t => {
  const { document,filename } = setup(t);
  const scene = ink.createSceneEditor(source);
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const observed = pixels.targets('notch');
  const cut = { id:'new-shape', revision:observed.documentRevision, frame:'front', destination:'notch',
    sourceRevision:observed.sourceRevision, operation:{ parameters:{ half:[.4,.5,.23] } } };
  assert.equal(pixels.previewEdit(cut).valid,true);
  scene.setTransform({ translation:[.1,0,0] },'solid:gate');
  const current = scene.snapshot();
  pixels.begin('Paint and carve');
  pixels.apply({ id:'rim', revision:pixels.describe().revision, frame:'front',
    edits:[{ at:[20,16], layer:null, from:null, to:'amber' }] });
  assert.throws(()=>pixels.apply({ ...cut, revision:pixels.describe().revision }),
    error=>error.conflicts?.[0].code === 'stale-source');
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(scene.snapshot(),current);
  assert.deepEqual(scene.history().undo,['Transform solids']);
  const fresh = pixels.targets('notch');
  pixels.apply({ ...cut, sourceRevision:fresh.sourceRevision, revision:fresh.documentRevision });
  assert.deepEqual(scene.snapshot().solids[0].half,[.4,.5,.23]);
});

test('a revised prefab dependency invalidates inspection while the scene JSON stays the same', t => {
  const { document,filename } = setup(t);
  const prefabs = half => ({ rail:{ revision:1, solids:{
    slat:{ kind:'box', at:[0,0,0], half:[half,.2,.1], mat:'stone' }
  } } });
  const scene = ink.createSceneEditor({ ...source, prefabLibrary:'library.json', instances:{
    end:{ prefab:'rail', transform:{ translation:[2,0,0] } }
  } },{ env:{ prefabs:prefabs(.3) } });
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const inspected = pixels.targets('notch'), snapshot = scene.serialize();
  scene.refreshPrefabs(prefabs(.4));
  assert.equal(scene.serialize(),snapshot);
  const patch = { id:'adjust-gate', frame:'front', destination:'notch', revision:inspected.documentRevision,
    sourceRevision:inspected.sourceRevision, operation:{ parameters:{ half:[.4,.5,.23] } } };
  assert.equal(pixels.previewEdit(patch).conflicts[0].code,'stale-source');
  assert.deepEqual(scene.history().undo,[]);
});

test('a splat source revision notices in-place packed changes and ownership changes', t => {
  const { document } = setup(t);
  const world = KIT.diorama.build(source);
  const rows = require('../src/target-selectors.js').index(world);
  const row = Array.from({ length:world.count },(_,i)=>i)
    .find(i=>rows.row(i).object === 'gate' && SplatFit.eligible(world,i));
  world.splatIds = Array(world.count).fill(null);
  world.splatIds[row] = 'inspected-dab';
  const pixels = ink.createPixelEditor(document);
  const options = { world:()=>world, limit:1 };
  const original = pixels.targets('footprint',options);
  assert.equal(original.splats[0].id,'inspected-dab');
  const patch = { id:'hide-dab', revision:original.documentRevision, frame:'front', destination:'footprint',
    sourceRevision:original.sourceRevision, operation:{ splats:[{ splat:'inspected-dab', visible:false }] } };
  assert.equal(pixels.previewEdit(patch,options).valid,true);
  world.splatIds[row] = 'replacement-dab';
  const renamed = pixels.previewEdit(patch,options);
  assert.equal(renamed.conflicts[0].code,'stale-source');
  assert.equal(signature(world),original.revision);

  const current = pixels.targets('footprint',options);
  assert.equal(current.splats[0].id,'replacement-dab');
  const revised = { ...patch, sourceRevision:current.sourceRevision,
    operation:{ splats:[{ splat:'replacement-dab', visible:false }] } };
  world.data[row*16] += .01;
  const moved = pixels.previewEdit(revised,options);
  assert.equal(moved.conflicts[0].code,'stale-source');
  assert.deepEqual(pixels.renderOptions(document.sceneBindings[0].scene),{});
  const fresh = pixels.targets('footprint',options);
  assert.notEqual(fresh.revision,original.revision);
  const fit = pixels.apply({ ...revised, sourceRevision:fresh.sourceRevision },options);
  assert.deepEqual(fit.edits,[['replacement-dab',0]]);
  const [receipt] = pixels.receipts();
  assert.deepEqual(receipt.affectedTargets[0].splats,[{ requested:'replacement-dab', row, id:'replacement-dab' }]);
  const replay = ink.createPixelEditor(document);
  assert.deepEqual(replay.replay(receipt,options),fit);
  assert.deepEqual(replay.receipts(),[receipt]);
});

test('a failed scene or pixel operation rolls back the entire shared draft', t => {
  const { document, filename } = setup(t);
  const scene = ink.createSceneEditor(source);
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const request = (id,extra) => ({ id, frame:'front', revision:pixels.describe().revision, ...extra });
  const paint = { at:[20,16], layer:null, from:null, to:'amber' };

  pixels.begin('Invalid carve');
  pixels.apply(request('draft-paint',{ edits:[paint] }));
  pixels.apply(request('bad-cut',{ destination:'notch', operation:{ parameters:{ half:[.3,.4] } } }));
  assert.throws(()=>pixels.commit(),/half/);
  assert.deepEqual(scene.snapshot(),source);
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(pixels.history(),{ undo:[], redo:[] });

  pixels.begin('Preview an invalid carve');
  pixels.apply(request('draft-paint',{ edits:[paint] }));
  scene.updateShape({ half:[.3,.4] },'solid:gate');
  const conflicts = pixels.previewChanges();
  assert.equal(conflicts.valid,false);
  assert.equal(conflicts.pixelCount,1);
  assert.equal(conflicts.sources[0].object,'gate');
  assert(conflicts.conflicts.some(({code,path})=>code === 'invalid-scene' && path.endsWith('.half')));
  assert.deepEqual(scene.snapshot(),source);
  assert.deepEqual(pixels.snapshot(),document);

  scene.begin('Surface paint with a blocked pixel');
  pixels.apply(request('patina-mark',{ destination:'patina', operation:{ stamp:{
    value:'#ffca33', brush:{ kind:'rect', min:[.2,.2], max:[.8,.8] }
  } } }));
  assert.equal(scene.snapshot().solids[0].surfaceState.charts.front.stamps.length,1);
  assert.throws(()=>pixels.apply(request('protected-mark',{ edits:[{ ...paint, at:[0,0] }] })),/no longer applies/);
  assert.deepEqual(scene.snapshot(),source);
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(scene.history(),{ undo:[], redo:[] });

  scene.begin('Direct scene edit');
  scene.setMaterial('accent','solid:gate');
  pixels.apply(request('draft-paint',{ edits:[paint] }));
  assert.equal(pixels.preview().frames[0].cels['draft-paint'].marks.length,1);
  assert.equal(pixels.cancel(),true);
  assert.deepEqual(scene.snapshot(),source);
  assert.deepEqual(pixels.snapshot(),document);

  assert.throws(()=>pixels.transact('Invalid direct scene edit', () => {
    pixels.apply(request('draft-paint',{ edits:[paint] }));
    scene.updateShape({ missing:1 },'solid:gate');
  }),/Unknown box shape parameter/);
  assert.deepEqual(scene.snapshot(),source);
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(pixels.history(),{ undo:[], redo:[] });
});

test('shot corrections and splat assets travel with pixel undo and render the restored revision', t => {
  const { document, filename } = setup(t);
  const scene = ink.createSceneEditor(source);
  const pixels = ink.createPixelEditor(document,{ sceneEditor:scene, sceneRef:filename('source') });
  const world = scene.build(), at = [20,16];
  const baseline = ink.render(world,{ ...view, captureShotCorrectionSurface:true });
  const { target,...anchor } = baseline.shotCorrectionSurface.pin(...at);
  const rows = require('../src/target-selectors.js').index(world);
  const splat = Array.from({ length:world.count },(_,i)=>i).find(i=>
    rows.row(i).object === 'gate' && SplatFit.eligible(world,i) &&
    i !== KIT.procedural.splatProvenance.identities(world).rowOf(anchor.splat));
  assert.equal(target.object,'gate');
  assert.notEqual(splat,undefined);
  const patch = (id,extra) => ({ id, frame:'front', revision:pixels.describe().revision, ...extra });
  const edits = [{ at, layer:null, from:null, to:'amber' }];
  pixels.begin('Paint and fit the shot');
  pixels.apply(patch('highlight',{ destination:'one-shot', edits, operation:{ at, fps:10, frames:[0,0], anchor } }));
  pixels.apply(patch('fit-edge',{ destination:'footprint', operation:{ splats:[{ splat, footprintScale:.9 }] } }));
  pixels.apply(patch('cel-highlight',{ edits }));
  const preview = pixels.previewChanges();
  assert.equal(preview.pixelCount,1);
  assert.equal(preview.valid,true);
  const [shot,fit] = preview.targets;
  assert.deepEqual([shot.object,shot.pixels[0].at],['gate',at]);
  assert.deepEqual([fit.object,fit.splats],['gate',[splat]]);
  assert.equal(pixels.commit(),true);
  const options = pixels.renderOptions();
  assert.equal(options.shotCorrections.corrections[0].id,'highlight');
  assert.equal(Math.round(SplatFit.prepare(world,options.splatFit)[splat]*10),9);
  const rendered = ink.render(world,{ ...view,...options });
  const p = (at[1]*view.w+at[0])*3;
  assert.deepEqual([...rendered.rgb.slice(p,p+3)],[255,202,51]);
  assert.equal(pixels.undo(),true);
  assert.deepEqual(pixels.renderOptions(),{});
  assert.deepEqual(pixels.snapshot(),document);
  assert.deepEqual(ink.render(world,{ ...view,...pixels.renderOptions() }).rgb,baseline.rgb);
  assert.equal(scene.redo(),true);
  assert.deepEqual(pixels.renderOptions(),options);
  assert.equal(pixels.inspect(at).swatch,'amber');
});

test('a persistent shared session restores redo and an interrupted native draft with its receipt', t => {
  const { document,filename,write } = setup(t);
  const directory = filename('session');
  const child = spawnSync(process.execPath,['-e',`
    const ink = require('.');
    const fs = require('node:fs');
    const [directory, sceneFile, documentFile] = process.argv.slice(1);
    const scene = ink.createSceneEditor(fs.readFileSync(sceneFile,'utf8'));
    const pixels = ink.createPixelEditor(fs.readFileSync(documentFile,'utf8'),
      { sceneEditor:scene, sceneRef:sceneFile, sessionDirectory:directory });
    const patch = (id,extra) => ({ id,frame:'front',revision:pixels.describe().revision,...extra });
    const paint = at => ({ edits:[{ at,layer:null,from:null,to:'amber' }] });
    pixels.transact('Committed paint and material',() => {
      pixels.apply(patch('mark',paint([4,4])));
      scene.setMaterial('accent','solid:gate');
    });
    pixels.transact('Future scene move',() => scene.setTransform({ translation:[.1,0,0] },'solid:post'));
    pixels.undo();
    pixels.begin('Interrupted cut');
    pixels.apply(patch('draft-mark',paint([5,4])));
    pixels.apply(patch('draft-cut',{ destination:'notch',operation:{ parameters:{ half:[.5,.6,.23] } } }));
    if (!pixels.sessionStatus().saved) throw new Error(pixels.sessionStatus().error);
    process.kill(process.pid,'SIGKILL');
  `,directory,filename('source'),filename('document')],{ cwd,encoding:'utf8' });
  assert.equal(child.signal,'SIGKILL',child.stderr);

  // The retained definitions reopen independently of the original authoring files.
  write('document',null);
  write('source',null);
  const pixels = ink.openPixelEditorSession(directory);
  const scene = pixels.sceneEditor;
  assert.equal(pixels.sessionStatus().pending,true);
  assert.deepEqual(pixels.snapshot().sceneBindings,document.sceneBindings);
  assert.deepEqual(pixels.history(),{ undo:['Committed paint and material'], redo:['Future scene move'] });
  assert.equal(pixels.inspect([5,4]).swatch,'amber');
  assert.deepEqual(scene.snapshot().solids[0].half,[.5,.6,.23]);
  assert.deepEqual(pixels.receipts().map(receipt=>receipt.command.patch.id),['mark','draft-mark','draft-cut']);
  const preview = pixels.previewChanges();
  assert.equal(preview.valid,true);
  assert.deepEqual(preview.targets.map(target=>[target.id,target.scene]),[['draft-cut',filename('source')]]);
  assert.equal(pixels.cancel(),true);

  const reopened = ink.openPixelEditorSession(directory);
  assert.equal(reopened.sessionStatus().pending,false);
  assert.equal(reopened.inspect([5,4]).swatch,null);
  assert.deepEqual(reopened.sceneEditor.snapshot().solids[0].half,source.solids[0].half);
  assert.deepEqual(reopened.receipts().map(receipt=>receipt.command.patch.id),['mark']);
  assert.equal(reopened.sceneEditor.redo(),true);
  assert.deepEqual(reopened.sceneEditor.snapshot().solids[1].transform.translation,[.1,0,0]);
  assert.equal(reopened.undo(),true);
  assert.equal(reopened.undo(),true);
  assert.equal(reopened.inspect([4,4]).swatch,null);
  assert.equal(reopened.sceneEditor.snapshot().solids[0].mat,'stone');
  const restored = ink.openPixelEditorSession(directory);
  assert.equal(restored.redo(),true);
  assert.equal(restored.inspect([4,4]).swatch,'amber');
  assert.equal(restored.sceneEditor.snapshot().solids[0].mat,'accent');
});

test('CLI commands reopen and commit a shot draft and export its retained artifact', t => {
  const { filename,write,read } = setup(t);
  const directory = filename('session'), at = [20,16];
  const run = (action,...args) => JSON.parse(cli('pixel-art','session',action,directory,...args));
  const created = run('init',filename('document'),'--scene',filename('source'));
  const base = KIT.diorama.build(source);
  const { target,...anchor } = ink.render(base,{ ...view,captureShotCorrectionSurface:true }).shotCorrectionSurface.pin(...at);
  assert.equal(target.object,'gate');
  const observed = run('targets','--destination','one-shot','--limit','1');
  write('patch',{ id:'sampled-light',frame:'front',revision:created.documentRevision,
    sourceRevision:observed.sourceRevision,destination:'one-shot',
    edits:[{ at,layer:null,from:null,to:'amber' }],operation:{ at,fps:10,frames:[0,0],anchor } });
  run('begin','--label','Retained shot');
  const receipt = run('apply',filename('patch'),'--shot-hit-frame','0');
  assert.equal(receipt.shotHits.painted,1);
  fs.unlinkSync(filename('source'));
  assert.equal(run('status').pending,true);
  assert.equal(run('preview').targets[0].id,'sampled-light');
  assert.deepEqual(run('commit').history.undo,['Retained shot']);
  assert.equal(run('undo').changed,true);
  assert.deepEqual(run('status').history.redo,['Retained shot']);
  assert.equal(run('redo').changed,true);
  run('export','--artifact','shot-corrections','--out',filename('shot'));
  assert.equal(read('shot').corrections[0].id,'sampled-light');
  const rendered = ink.render(base,{ ...view,shotCorrections:read('shot') });
  const p = (at[1]*view.w+at[0])*3;
  assert.deepEqual([...rendered.rgb.slice(p,p+3)],[255,202,51]);
});

test('a stale session writer cannot overwrite the retained checkpoint or lose its local edits', t => {
  const { document,filename } = setup(t);
  const directory = filename('session');
  const first = ink.createPixelEditor(document,{ sessionDirectory:directory, historyLimit:1 });
  const stale = ink.openPixelEditorSession(directory);
  const paint = (pixels,id,at) => pixels.apply({ id,frame:'front',revision:pixels.describe().revision,
    edits:[{ at,layer:null,from:null,to:'amber' }] });
  paint(first,'first',[4,4]);
  paint(first,'second',[5,4]);
  paint(stale,'other',[6,4]);
  assert.equal(stale.sessionStatus().saved,false);
  assert.match(stale.sessionStatus().error,/advanced on disk/);
  assert.equal(stale.inspect([6,4]).swatch,'amber');
  assert.equal(stale.flushSession(),false);
  const current = ink.openPixelEditorSession(directory);
  assert.equal(current.inspect([6,4]).swatch,null);
  assert.equal(current.inspect([5,4]).swatch,'amber');
  assert.deepEqual(current.history().undo,['second']);
  assert.equal(current.undo(),true);
  assert.equal(current.undo(),false);
  assert.equal(current.inspect([4,4]).swatch,'amber');
});

test('session recovery checks the retained scene dependencies before opening', t => {
  const { document,filename } = setup(t);
  const directory = filename('session');
  const env = half => ({ prefabs:{ rail:{ revision:1, solids:{
    slat:{ kind:'box', at:[0,0,0], half:[half,.2,.1], mat:'stone' }
  } } } });
  const scene = ink.createSceneEditor({ ...source, prefabLibrary:'library.json', instances:{
    end:{ prefab:'rail', transform:{ translation:[2,0,0] } }
  } },{ env:env(.3) });
  const pixels = ink.createPixelEditor(document,{ sessionDirectory:directory, sceneEditor:scene, sceneRef:filename('source') });
  const revision = pixels.sessionStatus().revision;
  scene.refreshPrefabs(env(.4).prefabs);
  assert.equal(pixels.sessionStatus().revision,revision+1);
  assert.throws(()=>ink.openPixelEditorSession(directory,{ env:env(.3) }),/dependencies.*changed/);
  const reopened = ink.openPixelEditorSession(directory,{ env:env(.4) });
  assert.deepEqual(reopened.snapshot().sceneBindings,document.sceneBindings);
  assert.equal(reopened.targets('notch').sourceRevision,pixels.targets('notch').sourceRevision);
});
