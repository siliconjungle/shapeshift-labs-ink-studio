const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PNG = require('../cli/png.js');

const cwd = path.resolve(__dirname, '..');
const run = (...args) => spawnSync(process.execPath, ['cli/ink-studio.js', ...args], { cwd, encoding: 'utf8' });
function cli(...args) {
  const child = run(...args);
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}
function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-visual-sweep-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const out = name => path.join(dir, name);
  return {
    out,
    write(name, doc) { const file=out(name); fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc)); return file; },
    report(name) { return JSON.parse(fs.readFileSync(out(name + '/report.json'), 'utf8')); },
    bytes(name, file) { return fs.readFileSync(path.join(out(name),file)); }
  };
}

test('scene sweep aligns clips and pins exact seeds and nested controls across nearby exploration', t => {
  const f=fixtures(t), scene=f.write('splat.js', `module.exports = ({KIT:K,makeBuilder}) => ({
    id:'sample', name:'Seeded samples', seed:5, build(seed,{controls}={}) {
      const {size, tint}=controls;
      const B=makeBuilder(seed,[0x171e2c,0x599b8a,0xffce94,0xe7f5ee]);
      B.iso((seed%9-4)*.34,0,0,size.rad,B.P[tint],2.7);
      const jet=K.frameSplats(B,1,(draw,_dt,t)=>draw.point([t-.6,.67,0],{width:.12,color:3}));
      const world=B.finish({cam:{target:[0,.25,0],dist:4,pitch:0,yaw:0,sway:0},dither:0,radius:3});
      const stage=K.stage(world);stage.stateful=false;stage.add(jet);stage.update(0,0);return world;
    }
  });`);
  const plan=f.write('plan.json',{
    controls:{size:{rad:.2},tint:1}, seeds:[5,8], parameters:{radius:{path:'/size/rad',values:[.22,.43]}},
    cases:[{id:'warm',controls:{tint:2}}],
    visual:{width:96,height:64,pixelSize:2,columns:2,at:.125,clip:{from:0,to:1,fps:4}}
  });
  cli('sweep',scene,plan,'--out',f.out('matrix'));
  const report=f.report('matrix');
  assert.deepEqual(report.tiles.map(tile=>[tile.id,tile.seed,tile.parameters.radius]),[
    ['warm:1@5',5,.22],['warm:1@8',8,.22],['warm:2@5',5,.43],['warm:2@8',8,.43]
  ]);
  const original=report.tiles[3], tile=f.bytes('matrix',original.image);
  assert.notDeepEqual(tile,f.bytes('matrix',report.tiles[2].image));
  const sheet=f.bytes('matrix',report.sheet.clip), marker=sheet.indexOf('acTL');
  assert.ok(marker>0);
  assert.equal(sheet.readUInt32BE(marker+4),4);
  assert.equal(PNG.read(f.out('matrix/sheet.png')).w,390);
  assert.equal(PNG.read(f.out('matrix/' + original.image)).w,96);

  const pinned=f.out('pin.json');
  cli('sweep','pin',f.out('matrix'),'4','--out',pinned);
  const pin=JSON.parse(fs.readFileSync(pinned));
  assert.deepEqual(pin.recipe.plan.seeds,[8]);
  assert.deepEqual(pin.recipe.plan.cases,[{id:'warm',controls:{tint:2}}]);
  assert.deepEqual(pin.anchor.parameters,{radius:.43});
  const offsets=f.write('offsets.json',{radius:[-.05,.07]});
  cli('sweep','nearby',pinned,offsets,'--out',f.out('near'));
  const nearby=f.report('near');
  assert.deepEqual(nearby.tiles.map(r=>r.seed),[8,8,8]);
  assert.deepEqual(nearby.tiles.map(r=>r.parameters.radius),[.43-.05,.43,.43+.07]);
  assert.deepEqual(f.bytes('near',nearby.tiles[1].image),tile);
  assert.deepEqual(f.bytes('near',nearby.tiles[1].clip),f.bytes('matrix',original.clip));
  cli('sweep','replay',pinned,'--out',f.out('replay'));
  assert.deepEqual(f.bytes('replay','cases/001.png'),tile);
  assert.deepEqual(f.bytes('replay','cases/001.apng'),f.bytes('matrix',original.clip));

  assert.match(run('sweep',scene,plan,'--out',f.out('matrix')).stderr,/new or empty/);
  const invalid=f.write('invalid.json',{someField:[-.1]});
  assert.match(run('sweep','nearby',pinned,invalid,'--out',f.out('bad')).stderr,/pinned numeric parameter/);
  assert.ok(!fs.existsSync(f.out('bad')));
});

test('simulation sweep captures the same checkpoint branches and scheduled observations it reports', t => {
  const f=fixtures(t), world=f.write('world.json',{
    format:'ink-studio/world',id:'visual-world',seed:17,dt:.25,
    entities:{tile:{position:[0,.4,0],visual:{half:[.34,.38,.35]}}},
    systems:{meter:{kind:'control',config:{op:'scale',scale:2}}},
    visual:{resolution:.125,bounds:{min:[-1.5,-.2,-1],max:[1.5,1,1]}}
  });
  const checkpoint=f.out('at-two.json');
  cli('sim','run',world,'--ticks','2','--checkpoint',checkpoint);
  const plan=f.write('plan.json',{
    ticks:[2,4], observations:{meter:{field:'world/signal',args:{port:'meter/value'}}},
    parameters:{flow:{port:'meter/value',values:[1,3]}},
    visual:{width:96,height:64,at:3,clip:{from:2,to:4,every:1,fps:6}}
  });
  cli('sim','sweep',checkpoint,plan,'--out',f.out('matrix'));
  const report=f.report('matrix'), result=report.visual;
  assert.equal(report.format,'ink-studio/observation-sweep');
  assert.deepEqual(result.samples,{units:'ticks',poster:3,frames:[2,3,4],fps:6});
  assert.deepEqual(result.tiles.map(tile=>tile.id),report.runs.map(row=>row.id));
  assert.deepEqual(report.runs.map(row=>row.samples.map(sample=>sample.value)),[[0,2],[0,6]]);
  const pin=f.out('pin.json');
  cli('sweep','pin',f.out('matrix/report.json'),result.tiles[1].id,'--out',pin);
  cli('sweep','nearby',pin,f.write('offsets.json',{flow:[-1,.5]}),'--out',f.out('near'));
  assert.deepEqual(f.report('near').runs.map(row=>row.samples[1].value),[4,6,7]);
  assert.deepEqual(f.bytes('near','cases/002.apng'),f.bytes('matrix','cases/002.apng'));

  const still=f.write('stills.json',{
    parameters:{x:{path:'/entities/tile/position/0',values:[-.5,.5]}}, visual:{at:1,width:96,height:64}
  });
  cli('sim','sweep',world,still,'--out',f.out('stills'));
  assert.equal(f.report('stills').observations.length,0);
  assert.notDeepEqual(f.bytes('stills','cases/001.png'),f.bytes('stills','cases/002.png'));
  assert.ok(!fs.existsSync(f.out('stills/sheet.apng')));
});

test('a fixed-view sweep reuses each candidate pose, and pins every camera lane', t => {
  const f = fixtures(t), log = f.out('builds.txt');
  const scene = f.write('fixed.js', `module.exports = ({KIT:K, makeBuilder}) => ({
    id:'fixed', seed:17, build(seed, { controls } = {}) {
      require('node:fs').appendFileSync(${JSON.stringify(log)}, controls.jaw + '\\n');
      const B = makeBuilder(seed,[0x172337, 0x8096c6, 0xffbb69, 0x79db9b]);
      B.iso(0,.04,0,.41,B.P[1],2.7);
      B.iso(.25,0,controls.jaw,.22,B.P[2],2.7);
      const marks = K.frameSplats(B, 1, (draw,_dt,t) =>
        draw.point([.42,.45,Math.sin(t)*.3],{width:.15,color:3}));
      const world = B.finish({ dither:0, cam:{target:[76,18,14],dist:5,yaw:-.7,pitch:0,sway:0} });
      const stage=K.stage(world);stage.stateful=false;stage.add(marks);stage.update(0,0);return world;
    }
  });`);
  const front = { target:[0,.24,.14], yaw:0, pitch:.13, dist:4, fov:.55, ortho:true };
  const side = { ...front, yaw:Math.PI / 2 };
  const settings = { width:96, height:64, pixelSize:2, columns:1,
    views:[{id:'front',camera:front},{id:'side',camera:side}], clip:{from:0,to:1,fps:4} };
  const source = { parameters:{jaw:{values:[.23,.43]}}, visual:settings };
  const plan = f.write('fixed.json', source);
  cli('sweep',scene,plan,'--out',f.out('fixed-review'));
  const review = f.report('fixed-review');
  assert.equal(fs.readFileSync(log,'utf8'),'0.23\n0.43\n');
  assert.equal(review.tiles.length, 2);
  assert.equal(PNG.read(f.out('fixed-review/sheet.png')).w,390);
  assert.deepEqual(review.recipe.plan.visual.views, settings.views);
  for (const [i, tile] of review.tiles.entries()) {
    assert.equal(tile.tile, i + 1);
    assert.deepEqual(tile.views.map(({id,camera}) => ({id,camera})), settings.views);
    assert.equal(tile.image, tile.views[0].image);
    assert.notDeepEqual(f.bytes('fixed-review', tile.views[0].image), f.bytes('fixed-review', tile.views[1].image));
  }
  cli('sweep','pin',f.out('fixed-review'),'2','--out',f.out('view-pin.json'));
  cli('sweep','replay',f.out('view-pin.json'),'--out',f.out('fixed-replay'));
  for (const [i, view] of f.report('fixed-replay').tiles[0].views.entries()) {
    const original = review.tiles[1].views[i];
    assert.deepEqual(f.bytes('fixed-replay',view.image), f.bytes('fixed-review',original.image));
    assert.deepEqual(f.bytes('fixed-replay',view.clip), f.bytes('fixed-review',original.clip));
  }
  cli('sweep','compare',f.out('fixed-review'),'1','2','--out',f.out('fixed-comparison'));
  const compared = f.report('fixed-comparison');
  assert.deepEqual(compared.samples,review.samples);
  for (const [i, { clip }] of compared.views.entries()) {
    assert.deepEqual(clip.frames.map(frame => frame.sample),review.samples.frames);
    assert.ok(clip.frames.every(frame => frame.changedPixels > 0));
    const original = review.tiles.map(tile => PNG.readFullFrameAnimation(
      f.out('fixed-review/' + tile.views[i].clip),{w:96,h:64,count:4,fps:4}));
    const playback = PNG.readFullFrameAnimation(f.out('fixed-comparison/' + clip.sideBySide),
      {w:192,h:64,count:4,fps:4});
    for (const [j, frame] of playback.entries()) {
      const pixels = PNG.read(PNG.encodeFrame(frame)).rgb;
      const originals = original.map(sequence => PNG.read(PNG.encodeFrame(sequence[j])).rgb);
      for (const [lane, rgb] of originals.entries()) for (let row = 0; row < 64; row++) {
        const start = (row * 192 + lane * 96) * 3;
        assert.deepEqual(pixels.subarray(start,start+96*3),rgb.subarray(row*96*3,(row+1)*96*3));
      }
    }
  }
  const tampered = f.out('fixed-review/' + review.tiles[0].views[0].clip);
  const bytes = fs.readFileSync(tampered), control = bytes.indexOf('fcTL');
  bytes.writeUInt16BE(5,control+4+22);
  fs.writeFileSync(tampered,bytes);
  assert.match(run('sweep','compare',f.out('fixed-review'),'1','2','--out',f.out('clip-mismatch')).stderr,/matching frames, dimensions, and cadence/);
  assert.ok(!fs.existsSync(f.out('clip-mismatch')));
  const invalid = f.write('duplicate.json', { ...source, visual:{ ...settings, views:[settings.views[0],settings.views[0]] } });
  assert.match(run('sweep',scene,invalid,'--out',f.out('duplicate')).stderr,/distinct IDs/);
  assert.ok(!fs.existsSync(f.out('duplicate')));
});

test('sweep approval preserves failing camera evidence and exits after publishing all candidates', t => {
  const f = fixtures(t);
  const scene = f.write('approval.js', `module.exports = ({makeBuilder}) => ({
    id:'approval', seed:7, build(seed, { controls } = {}) {
      const B = makeBuilder(seed,[0x172337, 0x8096c6]);
      B.iso(0,0,0,controls.radius,B.P[1],2.7);
      return B.finish({dither:0, cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0}});
    }
  });`);
  const camera = { target:[0,0,0], yaw:0, pitch:0, dist:4, fov:.55, ortho:true };
  const plan = f.write('approval.json', {
    parameters:{radius:{values:[.30,.50]}},
    visual:{width:96,height:64,pixelSize:1,views:[
      {id:'front',camera},{id:'side',camera:{...camera,yaw:Math.PI/2}}
    ]},
    approval:{
      checks:{motion:false,transition:false,performance:{fragments:100000}},
      views:{side:{performance:{fragments:0}}}
    }
  });
  const runResult = run('sweep',scene,plan,'--out',f.out('approval'));
  assert.equal(runResult.status, 2, runResult.stderr);
  const review = f.report('approval');
  assert.equal(review.passed, false);
  assert.equal(review.tiles.length, 2);
  for (const tile of review.tiles) {
    assert.deepEqual(tile.approval.map(row => [row.view,row.passed]), [['front',true],['side',false]]);
    const failed = tile.approval[1];
    const report = JSON.parse(f.bytes('approval',failed.report));
    assert.equal(report.firstFailure.check, 'fragments');
    assert.ok(report.firstFailure.evidence.value > 0);
    assert.deepEqual(f.bytes('approval',failed.evidence.image),f.bytes('approval',tile.views[1].image));
  }
});

test('headless candidate review compares views, ranks checks and reapplies verified controls', t => {
  const f = fixtures(t), declared = f.write('resource.txt','matching resource');
  const scene = f.write('review.js', `module.exports = ({makeBuilder}) => ({
    id:'review', seed:7, build(seed, { controls } = {}) {
      const B = makeBuilder(seed,[0x172337,0x8096c6]);
      B.iso(0,0,0,controls.radius,B.P[1],2.7);
      return B.finish({dither:0, cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0}});
    }
  });`);
  const plan = f.write('review.json', {
    dependencies:['resource.txt'], parameters:{radius:{values:[.30,.50]}},
    visual:{width:96,height:64,pixelSize:1}
  });
  cli('sweep',scene,plan,'--out',f.out('review'));
  assert.equal(f.report('review').recipe.inputs.length,2);
  cli('sweep','compare',f.out('review'),'1','2','--out',f.out('differences'));
  const comparison = f.report('differences');
  assert.ok(comparison.views[0].changedPixels > 0);
  assert.equal(PNG.read(f.out('differences/default-comparison.png')).w,192);
  cli('sweep','rank',f.out('review'),'--out',f.out('ranking.json'));
  const ranking = JSON.parse(fs.readFileSync(f.out('ranking.json')));
  assert.deepEqual(ranking.candidates.map(row => row.passed),[null,null]);
  cli('sweep','pin',f.out('review'),'2','--note','Hold this shape','--out',f.out('chosen.json'));
  const pin = JSON.parse(fs.readFileSync(f.out('chosen.json')));
  assert.equal(pin.note,'Hold this shape');
  cli('sweep','apply',f.out('chosen.json'),'--out',f.out('controls.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.out('controls.json'))),{radius:.5});
  fs.writeFileSync(declared,'changed resource');
  assert.match(run('sweep','replay',f.out('chosen.json'),'--out',f.out('stale')).stderr,/dependency changed/);
  assert.ok(!fs.existsSync(f.out('stale')));
});

test('applying a pin writes scoped defaults to a separate editable scene', t => {
  const f = fixtures(t), original = {
    id:'apply-review', seed:5, camera:{target:[0,0,0],dist:5,yaw:0,pitch:.18},
    solids:[{ id:'panel', kind:'box', at:[0,0,0], half:[.3,.35,.2], mat:'stone', res:.09 }],
    parameterBindings:{controls:{width:.3,paint:'stone'},bindings:[
      {path:'/solids/0/half/0',parameter:'width'},{path:'/solids/0/mat',parameter:'paint'}
    ]}
  };
  const scene = f.write('original.json',original), selected = f.out('chosen.json'), revised = f.out('revised.json');
  const plan = f.write('plan.json',{
    seeds:[9],parameters:{width:{values:[.3,.65]}},visual:{width:96,height:64,pixelSize:1}
  });
  cli('sweep',scene,plan,'--out',f.out('candidates'));
  cli('sweep','pin',f.out('candidates'),'2','--out',selected);
  cli('sweep','apply',selected,'--scene','--out',revised);
  assert.deepEqual(JSON.parse(fs.readFileSync(scene)),original);
  assert.deepEqual(JSON.parse(fs.readFileSync(revised)),{
    ...original,seed:9,parameterBindings:{...original.parameterBindings,controls:{width:.65,paint:'stone'}}
  });
  const defaults = f.write('defaults.json',{visual:{width:96,height:64,pixelSize:1}});
  cli('sweep',revised,defaults,'--out',f.out('applied'));
  assert.deepEqual(f.bytes('applied','cases/001.png'),f.bytes('candidates','cases/002.png'));
});

test('ranges and seeded sampling honor cross-control constraints and replay selected values', t => {
  const f = fixtures(t);
  const scene = f.write('ranges.js', `module.exports = ({makeBuilder}) => ({
    id:'ranges', seed:5, build(seed, { controls } = {}) {
      const B = makeBuilder(seed,[0x172337,0x8096c6]);
      B.iso(controls.a,0,controls.b,.26,B.P[1],2.7);
      return B.finish({dither:0,cam:{target:[.35,0,.35],dist:4,yaw:.5,pitch:.15,sway:0}});
    }
  });`);
  const plan = {
    parameters:{a:{range:{min:0,max:.6}},b:{values:[.25,.5,.75]}},
    sampling:{count:4,seed:91}, runBudget:4,
    constraints:[{left:'a',op:'lt',right:{parameter:'b'}}],
    visual:{width:96,height:64,pixelSize:2}
  };
  const first = f.write('ranges.json',plan);
  for (const key of ['run-one','run-two']) cli('sweep',scene,first,'--out',f.out(key));
  const [one,two] = ['run-one','run-two'].map(key => f.report(key));
  assert.deepEqual(one.tiles,two.tiles);
  assert.equal(one.tiles.length,4);
  assert.ok(one.tiles.every(({parameters:{a,b}}) => a >= 0 && a < b));
  assert.equal(new Set(one.tiles.map(tile => JSON.stringify(tile.parameters))).size,4);
  cli('sweep','pin',f.out('run-one'),'2','--out',f.out('range-pin.json'));
  const pin = JSON.parse(fs.readFileSync(f.out('range-pin.json')));
  assert.equal(pin.recipe.plan.sampling,undefined);
  assert.deepEqual(pin.recipe.plan.parameters.a.values,[one.tiles[1].parameters.a]);
  cli('sweep','replay',f.out('range-pin.json'),'--out',f.out('range-replay'));
  assert.deepEqual(f.bytes('range-replay','cases/001.png'),f.bytes('run-one',one.tiles[1].image));

  const fixed = f.write('fixed-grid.json',{
    ...plan,sampling:undefined,runBudget:2,
    parameters:{a:{range:{min:0,max:1,steps:3}},b:{values:[.25]}}
  });
  cli('sweep',scene,fixed,'--out',f.out('grid'));
  assert.deepEqual(f.report('grid').tiles.map(row => row.parameters),[{a:0,b:.25}]);
  const impossible = f.write('impossible.json',{...plan, constraints:[{left:'a',op:'lt',right:{value:0}}]});
  assert.match(run('sweep',scene,impossible,'--out',f.out('no-runs')).stderr,/distinct sample count/);
  assert.ok(!fs.existsSync(f.out('no-runs')));
});
