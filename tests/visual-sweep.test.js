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
