const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const kit=require('..').load(), {KIT:K}=kit, W=K.world,R=W.runtime;
const {open,execute}=require('../cli/liquid3d.js');

const grid={shape:[10,8,9],cell:.25,origin:[-1.25,0,-1.125]};
const settings={pressureIterations:19,substeps:2,maxWork:3500000,particlesPerAxis:2};
const region={min:[-1.19,.012,-1.09],max:[1.19,.70,1.07]};
const plan=(config,run={})=>({format:'ink-studio/liquid-3d-plan',version:1,id:'liquid-check',seed:42,
  config:{grid,settings,...config},run:{dt:1/30,ticks:14,every:1,...run}});
const copy=value=>JSON.parse(JSON.stringify(value));

function indexed(value){
  assert(value.positions.length%3===0&&value.triangles.length%3===0&&value.triangles.length>0);
  assert(value.positions.every(Number.isFinite)&&value.triangles.every(i=>i>=0&&i<value.positions.length/3));
}

test('three-axis pressure flow conserves primary markers and extracts a native surface',()=>{
  const source=plan({fill:[{min:[-1.12,.012,-.84],max:[-.21,1.18,.01],velocity:[.52,0,.58]}]},
    {captures:[{tick:0,outputs:['particles']},{tick:14,outputs:['particles','surface','density']}]});
  const {report,output}=execute(open(kit,source),{artifacts:true});
  const read=(tick,name)=>output.find(row=>row.file==='frames/'+tick+'/'+name+'.json').document;
  const initial=read(0,'particles'), final=read(14,'particles'), field=read(14,'density'), mesh=read(14,'surface');
  const mean=(rows,axis)=>rows.reduce((n,row)=>n+row.position[axis]/rows.length,0);
  assert.equal(initial.length,final.length);
  assert(mean(final,0)>mean(initial,0)+.05&&mean(final,2)>mean(initial,2)+.04);
  assert(mean(final,1)<mean(initial,1)-.1);
  assert(report.summary.pressure.before>0&&report.summary.pressure.after<report.summary.pressure.before*.6);
  assert(report.frames.every(row=>row.volume===report.summary.volume));
  indexed(mesh);
  assert.equal(mesh.normals.length,mesh.positions.length);
  assert.deepEqual(field.shape,grid.shape);
  assert(field.data.some(n=>n>.7)&&field.data.some(n=>n===0));
  assert.equal(W.outputAdapters.points(final).count,initial.length);
});

test('moving collider injects wake and bounded secondary particles with checkpoint replay',()=>{
  const sphere={kind:'sphere',radius:.29,position:[-.35,1.25,-.32]};
  const commands=Array.from({length:10},(_,i)=>({tick:i+1,action:'move',args:{collider:'ram',
    position:[-.35+.055*(i+1),1.25-.066*(i+1),-.32+.025*(i+1)]}}));
  const source=plan({fill:[region],colliders:{ram:sphere},secondary:{maxCount:60,perTick:8,impact:.26,rise:.8}},
    {commands,checkpoints:[5],captures:[{tick:12,outputs:['secondary','surface']}]});
  const {report,output}=execute(open(kit,source),{artifacts:true});
  assert(report.summary.contacts.ram.count>0&&report.summary.contacts.ram.peakImpact>.26);
  assert(report.summary.clearance>0);
  assert(report.summary.peakSpray>0&&report.summary.emitted>0);
  const tracers=output.find(row=>row.file==='frames/12/secondary.json').document;
  assert(tracers.length>0&&tracers.length<=60&&tracers.every(row=>['spray','foam'].includes(row.kind)));
  const log=copy(output.find(row=>row.file==='liquid.run.json').document);
  const checkpoint=copy(output.find(row=>row.file==='checkpoints/5.json').document);
  const branch=R.openRecording(log,{checkpoint});
  branch.advance(log.end.tick);
  assert(R.checkpointsEqual(branch.checkpoint(),log.end));
  assert.equal(branch.query().probe('liquid/density-at',[0,.26,0]).status,'ok');
  const bad=open(kit,plan({fill:[region],colliders:{ram:sphere}},
    {dt:.002,ticks:1,commands:[{tick:1,action:'move',args:{collider:'ram',position:[.70,1.25,0]}}]})).run;
  const saved=bad.checkpoint();
  assert.throws(()=>bad.step(),/travel budget/);
  assert(R.checkpointsEqual(bad.checkpoint(),saved));
});

test('directional spectrum and local liquid blend agree exactly at the far boundary',()=>{
  const ocean={bounds:{min:[-3,-3],max:[3,3]},level:.69,depth:6,focus:[0,0],near:.28,far:1.8,edge:.38,
    samples:[31,29],bands:[{wavelength:[2,3],amplitude:.06,direction:.6,spread:.24,modes:4}]};
  const source=plan({fill:[{...region,max:[1.19,1.1,1.07],followOcean:true}],ocean},{ticks:4,
    commands:[{tick:2,action:'focus',args:{at:[.60,.10]}}]});
  const run=open(kit,source).run;
  const read=()=>run.query().probe('liquid/ocean').value;
  const first=read();
  run.advance(4);
  const result=read();
  indexed(result);
  assert.deepEqual(result.focus,[.60,.10]);
  assert(result.weights.some(n=>n>0&&n<1)&&result.weights.some(n=>n>.94)&&result.weights.some(n=>n===0));
  for(const [i,w] of result.weights.entries()){
    assert(result.positions[i*3+1]===K.mix(result.spectral[i],result.local[i]??result.spectral[i],w));
    if(!w)assert.equal(result.positions[i*3+1],result.spectral[i]);
  }
  assert(first.spectral.some((n,i)=>Math.abs(n-result.spectral[i])>.001));
  const [a,b,c]=result.triangles.slice(0,3).map(i=>result.positions.slice(i*3,i*3+3));
  assert(K.V.cross(K.V.sub(b,a),K.V.sub(c,a))[1]>0);
  const exact=open(kit,source).run;
  exact.advance(4);
  assert.deepEqual(exact.query().probe('liquid/ocean').value,result);
});

test('headless CLI publishes mesh assets and replayable native checkpoints',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-liquid-volume-'));
  const cli=path.join(__dirname,'../cli/ink-studio.js'), native=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'}),
    file=path.join(folder,'study.json'), output=path.join(folder,'run');
  try{
    const source=plan({fill:[region]},{ticks:3,checkpoints:[3],captures:[{tick:3,outputs:['surface']}]});
    assert.throws(()=>open(kit,{...source,run:{...source.run,maxWork:5}}),/total work estimate/);
    fs.writeFileSync(file,JSON.stringify(source));
    const world=JSON.parse(native('liquid3d','compile',file));
    native('liquid3d','run',file,'--out',output);
    const read=name=>JSON.parse(fs.readFileSync(path.join(output,name),'utf8'));
    assert.deepEqual(world,read('liquid.world.json'));
    const checkpoint=path.join(output,'checkpoints/3.json');
    const direct=JSON.parse(native('liquid3d','surface',checkpoint));
    assert.deepEqual(direct,read('frames/3/surface.json'));
    const obj=path.join(folder,'water.obj');
    native('liquid3d','surface',checkpoint,'--out',obj);
    assert.equal(fs.readFileSync(obj,'utf8').split('\n').filter(line=>line.startsWith('f ')).length,direct.triangles.length/3);
    assert.equal(JSON.parse(native('sim','verify',path.join(output,'liquid.run.json'))).status,'verified');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
