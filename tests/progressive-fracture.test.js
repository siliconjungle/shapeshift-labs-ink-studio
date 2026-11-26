const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const kit=require('..').load(), {KIT:K}=kit, R=K.world.runtime;
const {open,execute}=require('../cli/fracture.js');
const source=require('../examples/progressive-fracture/stormglass-span.json');
const {simulation,...plan}=source;
const native=(...args)=>execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),...args],{encoding:'utf8'});

test('feature guides place exact closed power cells with stable mass, shared seams and hierarchy',()=>{
  const prepared=K.procedural.fracture.prepare(plan);
  const reversed=K.procedural.fracture.prepare({...plan,guides:[...plan.guides].reverse()});
  assert.deepEqual(prepared,reversed);
  assert.equal(Object.keys(prepared.cells).length,6);
  assert.equal(prepared.bonds.length,5);
  assert(Math.abs(prepared.volume-2.641968)<1e-10);
  assert(Math.abs(prepared.hierarchy.groups.span.mass-prepared.mass)<1e-12);
  assert.deepEqual(prepared.hierarchy.groups.strap.pieces,['weave-root','weave-tip']);
  for(const bond of prepared.bonds){
    assert(bond.area>0 && Math.abs(K.V.dot(bond.normal,bond.axis))<1e-10);
    if(bond.guide)assert(Math.abs(K.V.dot(bond.normal,K.V.sub(bond.point,bond.guide.at)))<1e-10);
  }
  for(const cell of Object.values(prepared.cells))assert.doesNotThrow(()=>K.world.colliders.local(cell.hull));
  const angled=K.procedural.fracture.prepare({
    format:plan.format,version:1,id:'angled-glaze',host:{kind:'box',half:[2,1,.5],turn:.21},
    materials:{glaze:plan.materials.glaze},stretch:[1.5,.7,1.12],rotation:[0,.27,0],
    guides:[{id:'diagonal',at:[0,0,0],normal:[1,.22,.11],span:.2,
      sides:[{id:'a',material:'glaze',anchored:true},{id:'b',material:'glaze'}]}]
  });
  assert(Math.abs(angled.volume-8)<1e-12);
  assert(K.V.dist(angled.bonds[0].normal,K.V.norm([1,.22,.11]))<1e-12);
  assert.throws(()=>K.procedural.fracture.prepare({...plan,groups:{...plan.groups,span:{parent:'tiles'}}}),/cycle/);
  assert.throws(()=>K.procedural.fracture.prepare({...plan,seams:{...plan.seams,'glaze-left/weave-tip':{}}}),/shared face/);
});

test('loads retain plastic bend, crack and tear independently, and preserve motion at native handoff',()=>{
  const {report,output}=execute(open(kit,source),{artifacts:true});
  const at=tick=>report.captures.find(row=>row.tick===tick);
  const seam=(tick,id)=>at(tick).constraints.find(row=>row.id===id);
  const copper='copper-strap/wall-shoe', glass='glaze-left/glaze-right', weave='weave-root/weave-tip';
  assert(seam(26,glass).damage>0&&seam(26,glass).damage<1);
  assert(seam(22,weave).extension>.15&&seam(22,weave).damage<1);
  assert(seam(88,copper).plastic>.13&&seam(88,copper).bend>.13);
  assert(seam(88,copper).bend<seam(33,copper).bend);
  assert.deepEqual(at(0).pieces['wall-shoe'],at(88).pieces['wall-shoe']);
  const crack=report.events.find(row=>row.kind==='fracture-crack');
  const tear=report.events.find(row=>row.kind==='fracture-tear');
  const releases=report.events.filter(row=>row.kind==='fracture-handoff');
  assert.equal(crack.bond,glass);
  assert.equal(tear.bond,weave);
  assert(crack.tick<tear.tick);
  assert.equal(releases.length,3);
  assert(releases.slice(1).every(row=>row.parent===releases[0].island&&row.velocityChange<1e-10));
  assert(releases.every(row=>row.positionError<1e-10&&row.rotationError<1e-10&&
    row.linearMomentumError<1e-10&&row.angularMomentumError<1e-10));
  assert(at(tear.tick).groups.length===2&&at(crack.tick).groups.length===1);
  assert(report.captures.some(frame=>frame.contacts.some(row=>row.b===null&&row.pieces[0]==='weave-tip')));
  assert.equal(report.end.massError,0);
  assert.deepEqual(report.end.broken,[glass,weave]);

  const replay=output.find(row=>row.file==='fracture.run.json').document;
  const checkpoint=output.find(row=>row.file==='checkpoints/34.json').document;
  const reopened=R.openRecording(JSON.parse(JSON.stringify(replay)),{checkpoint:JSON.parse(JSON.stringify(checkpoint))});
  reopened.advance(replay.end.tick);
  assert(R.checkpointsEqual(reopened.checkpoint(),replay.end));
  const bad=JSON.parse(JSON.stringify(checkpoint));
  Object.values(bad.states.failure.islands)[0].body.mass*=2;
  assert.throws(()=>R.create(bad.world,{checkpoint:bad}),/Invalid fracture island checkpoint/);
});

test('headless commands emit portable world, deterministic captures and verified native replay',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-fracture-'));
  try {
    const planFile=path.join(directory,'plan.json'), out=path.join(directory,'bake');
    const sim={...source.simulation,ticks:42,sampleEvery:5,checkpoints:[32]};
    fs.writeFileSync(planFile,JSON.stringify({...source,simulation:sim}));
    const prepared=JSON.parse(native('fracture','prepare',planFile));
    const world=JSON.parse(native('fracture','compile',planFile));
    native('fracture','run',planFile,'--out',out);
    const read=file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
    assert.deepEqual(prepared,read('preparation.json'));
    assert.deepEqual(world,read('fracture.world.json'));
    const report=read('report.json');
    assert(report.captures.some(row=>row.tick%5!==0&&row.tick!==32&&row.tick!==42));
    assert.deepEqual(JSON.parse(native('fracture','run',planFile)),report);
    assert.equal(JSON.parse(native('sim','verify',path.join(out,'fracture.run.json'))).status,'verified');
    const planText=fs.readFileSync(planFile,'utf8');
    assert.throws(()=>native('fracture','compile',planFile,'--out',planFile),/separate from source files/);
    assert.equal(fs.readFileSync(planFile,'utf8'),planText);
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('typed load and failure ports compose with native worlds and keep pose IDs after release',()=>{
  const {world}=open(kit,{...source,simulation:{...simulation,loads:[]}});
  world.entities={'weave-tip':{},tag:{parent:'weave-tip',position:[0,0,0]}};
  const bond='glaze-left/glaze-right';
  world.commands=[{tick:1,action:'world/input',args:{port:'failure/loads',value:[{bond,tension:3.55}]}}];
  const run=R.create(world);
  const initial=run.query().target({entity:'tag'}).point;
  run.advance(7);
  const view=run.view(), query=run.query(), signals=view.signals['failure/failure'];
  assert(signals.some(row=>row.kind==='fracture-crack'&&row.bond===bond));
  assert(signals.some(row=>row.kind==='fracture-handoff'&&row.members.includes('weave-tip')));
  run.advance(12);
  const next=run.query();
  assert.equal(query.probe('failure/pieces').value['weave-tip'].island,next.probe('failure/pieces').value['weave-tip'].island);
  assert.deepEqual(next.target({entity:'tag'}).point,next.target({entity:'weave-tip'}).point);
  assert(next.target({entity:'tag'}).point[1]<initial[1]);
});
