const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const kit=require('..').load(),{KIT:K}=kit, W=K.world,R=W.runtime,V=K.procedural.sparseVolume;
const cli=require('../cli/atmosphere3d.js'), cache=require('../cli/atmosphere-cache.js');
const grid={origin:[-6,0,-6],spacing:[.18,.18,.18],size:[320,240,320]};
const native=mode=>({format:'ink-studio/atmosphere-3d-plan',version:1,id:'atmosphere-check',seed:16,config:{
  mode,grid,settings:{maxActive:4000,maxWork:2000000,pressureIterations:14,wind:[.36,0,.18],swirl:.18},sources:{}},
  run:{dt:.04,ticks:20,every:5}});
const get=(run,name,point)=>run.query().probe('atmosphere/'+name,point).value;

test('sparse combustion transports fuel and smoke with measured ignition and conserved channel balances',()=>{
  const source=native('combustion');
  source.config.sources={
    stream:{at:[.03,.43,-.10],radii:[.40,.32,.36],rates:{fuel:3.7},velocity:[.12,1.72,0]},
    spark:{at:[.035,.53,-.095],radii:[.42,.43,.38],start:.24,end:.6,rates:{heat:4300},velocity:[.07,1.3,0]}
  };
  const {run}=cli.open(kit,source);
  run.advance(5);
  assert.equal(get(run,'report').reaction.fuelBurned,0);
  assert(get(run,'report').fuelMass>0);
  let total=0, hottest=0;
  for(let i=6;i<=20;i++){
    run.advance(i);
    const {reaction,temperaturePeak,pressure,balance,logicalCells,activeCells}=get(run,'report');
    assert.equal(logicalCells,24576000);
    assert(activeCells<700&&pressure.after<=pressure.before);
    assert(Object.values(balance).every(row=>Math.abs(row.error)<1e-7));
    total+=reaction.fuelBurned; hottest=Math.max(hottest,temperaturePeak);
  }
  assert(total>.015&&hottest>650);
  const volume=get(run,'volume');
  assert(get(run,'report').densityMass>0);
  assert(get(run,'report').densityCentroid[1]>.55);
  assert(V.inspect(volume).fields.fuel.stored>0);
  assert(get(run,'temperature',[.035,.53,-.095])>=293);
});

test('cloud condensation transfers vapor to density and up-resolution retains all scalar channel masses',()=>{
  const source=native('cloud');
  source.config.sources={air:{at:[-.11,.65,.17],radii:[.55,.43,.56],rates:{vapor:5,heat:55},velocity:[.31,1.36,.2]}};
  const {run}=cli.open(kit,source);
  run.advance(16);
  const report=get(run,'report'), volume=get(run,'volume');
  assert(report.reaction.condensed>0&&report.densityMass>0&&report.vaporMass>0&&report.reaction.fuelBurned===0);
  assert(Math.abs(report.balance.density.error+report.balance.vapor.error)<1e-7);
  const base=W.atmosphere.upRes(volume,{factor:2,strength:0},{seed:1,time:.64});
  const fine=W.atmosphere.upRes(volume,{factor:2,strength:.83},{seed:1,time:.64});
  assert.deepEqual(fine.document.grid.spacing,[.09,.09,.09]);
  assert.deepEqual(fine.document.grid.size,[640,480,640]);
  assert(base.report.densityDetailRms<1e-12&&fine.report.densityDetailRms>.003);
  assert(Object.values(fine.report.mass).every(row=>Math.abs(row.relativeError)<1e-7));
  assert.deepEqual(W.atmosphere.upRes(volume,{factor:2,strength:.83},{seed:1,time:.64}),fine);
  assert.throws(()=>W.atmosphere.upRes(volume,{factor:4,maxCells:10}),/child-cell budget/);
});

test('sparse scatter validates native fuel and vapor and rejects unbounded active work transactionally',()=>{
  const fields={fuel:{background:0},vapor:{background:0}};
  const doc=V.bakeSparse({grid,fields,brickSize:4,maxCells:5},[0,321,48024],name=>name==='fuel'?.24:.13).document;
  assert.equal(V.inspect(doc).fields.fuel.stored,3);
  assert.equal(V.inspect(V.combine(doc,doc).document).fields.fuel.range.max,Math.fround(Math.fround(.24)*2));
  assert.throws(()=>V.bakeSparse({grid,fields},[1,1],()=>1),/increase/);
  assert.throws(()=>V.bakeSparse({grid,fields},[1],()=>-1),/invalid fuel/);
  const source=native('cloud');
  source.config.sources={air:{at:[0,.7,0],radii:[.49,.49,.49],rates:{vapor:1}}};
  source.config.settings.maxActive=8;
  const {run}=cli.open(kit,source);
  const before=run.checkpoint();
  assert.throws(()=>run.step(),/active-cell budget/);
  assert(R.checkpointsEqual(run.checkpoint(),before));
});

test('cache verifies block hashes, timed interpolation and native continuation from portable references',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-atmosphere-'));
  const source=native('cloud');
  source.config.sources={mist:{at:[-.1,.65,.12],radii:[.49,.36,.48],rates:{vapor:4},velocity:[.04,.9,.08]}};
  source.run={dt:.04,ticks:8,every:4,upRes:{factor:2,strength:.52}};
  const executable=path.resolve(__dirname,'../cli/ink-studio.js'), call=(...args)=>execFileSync(process.execPath,[executable,...args],{encoding:'utf8'});
  try{
    const plan=path.join(directory,'plan.json'), folder=path.join(directory,'take');
    fs.writeFileSync(plan,JSON.stringify(source));
    call('atmosphere3d','bake',plan,'--out',folder);
    const manifest=path.join(folder,'cache.json'), take=cache.open(kit,manifest);
    assert.deepEqual(take.verify(),{format:'ink-studio/atmosphere-verification',version:1,id:'atmosphere-check',
      verified:true,frames:3,detailFrames:3,from:0,to:8});
    const half=take.playback({time:.24,blend:'linear'});
    assert.deepEqual(half.report.frames,[4,8]);
    assert.equal(half.report.mix,.5);
    const totals=[4,8].map(tick=>take.playback({tick}).report.storage.fields.vapor.stored);
    assert(half.report.storage.fields.vapor.stored>=Math.min(...totals));
    assert.deepEqual(JSON.parse(call('atmosphere3d','playback',manifest,'--tick','4','--level','detail')),
      take.playback({tick:4,level:'detail'}).volume);
    assert.equal(JSON.parse(call('sim','verify',path.join(folder,'run.json'))).status,'verified');
    const from=require('../cli/checkpoint-file.js').readCheckpoint(path.join(folder,'checkpoints/4.json'));
    const run=R.create(from.world,{checkpoint:from});
    run.advance(8);
    assert.deepEqual(get(run,'volume'),take.playback({tick:8}).volume);
    const corrupt=path.join(folder,'detail',take.index.frames[1].detail+'.json');
    fs.appendFileSync(corrupt,' ');
    assert.throws(()=>take.playback({tick:4,level:'detail'}),/corrupt detail/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
