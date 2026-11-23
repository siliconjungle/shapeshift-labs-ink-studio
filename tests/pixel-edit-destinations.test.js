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
  return { document, filename, write, request, apply, reject, targets };
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
  assert.equal(committed.solids[0].modifiers[0].id,'notch-cut');
  assert.equal(pixels.inspect(at).swatch,'amber');
  assert.deepEqual(pixels.history().undo,['Set solid material','Carve the gate and mark the cel']);

  assert.equal(scene.undo(),true);
  assert.deepEqual(scene.snapshot(),baseline);
  assert.deepEqual(pixels.snapshot(),document);
  assert.equal(pixels.redo(),true);
  assert.deepEqual(scene.snapshot(),committed);
  assert.deepEqual(pixels.snapshot(),painted);
  assert.deepEqual(events,[
    ['commit','amber','notch-cut'],['undo',null,null],['redo','amber','notch-cut']
  ]);
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
