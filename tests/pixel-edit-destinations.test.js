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
  return { document, filename, write, request, apply, reject };
}

test('pixel destinations route raster, shot and splat edits through their native consumers', t => {
  const { document, filename, request, apply, reject } = setup(t);
  assert.deepEqual(validate(document).destinations,document.destinations);
  const world = KIT.diorama.build(source);
  const baseline = ink.render(world,{ ...view, captureShotCorrectionSurface:true });
  const at = [20,16];
  const { target, ...anchor } = baseline.shotCorrectionSurface.pin(...at);
  assert.equal(target.object,'gate');
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

test('pixel destinations retain edits on a rest chart and the selected SDF solid', t => {
  const { document, filename, write, request, apply, reject } = setup(t);
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

  reject(request({ destination:'stone', edits:[], operation:{ material:'accent' } }),/explicit source/);
  assert.throws(()=>validate({ ...document, destinations:[{ id:'hole', kind:'sdf-shape', binding:'unknown' }] }),
    /Unknown scene binding/);
  const pinned = structuredClone(document);
  pinned.sceneBindings[1].revision = 'stale';
  write('document',pinned);
  reject({ ...request({ destination:'stone', operation:{ material:'accent' } }), revision:compile(pinned).revision },
    /scene binding is stale/);
});
