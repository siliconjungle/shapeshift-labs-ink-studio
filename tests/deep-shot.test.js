const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const Color = require('../src/color-space.js');
const { readHeader } = require('../cli/exr-bytes.js');
const { layout } = require('../cli/deep-composite.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const planFormat = 'ink-studio/deep-shot';
const operator = (id, type, select, params, color) => ({ id, operator:type, select, params, ...(color && {color}) });
const encoded = Color.prepare('srgb', 'srgb-linear');
const fromLinear = Color.prepare('srgb-linear','srgb');
const act = (dir,...args) => spawnSync(process.execPath, [cli,'deep-shot',...args], { cwd:dir, encoding:'utf8' });
const near = (a,b) => assert(Math.abs(a-b)<1e-6, a+' != '+b);
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-deep-shot-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name => path.join(dir,name);
  const json = (name,data) => fs.writeFileSync(file(name),JSON.stringify(data));
  return { dir, file, json, get:name=>JSON.parse(fs.readFileSync(file(name))) };
}

function fixture(rows, time, { shift = 0, count = rows.length } = {}) {
  const w=2,h=2,layers=4, colors=new Float32Array(w*h*layers*layout.stride), ids=new Uint32Array(w*h*layers*layout.idStride);
  for(const [i,row] of rows.entries()){
    const { z, alpha, color, id, material, kind = layout.kinds.sprite }=row;
    colors.set([z,alpha,...color,0,0,0,1,1,1],i*layout.stride);
    ids.set([kind,i+1,id,material],i*layout.idStride);
  }
  const camera={view:[1,0,0,0,0,1,0,0,0,0,1,0,shift,0,-8,1],ortho:true,focal:2,setback:8};
  return ink.encodeDeepEXR({deep:{w,h,layers,count:Uint32Array.of(count,0,0,0),colors,ids,
    objects:[null,'front','back'],materials:[null,'pigment'],camera}},{time,allowTruncated:true});
}
const front={z:2,alpha:.5,color:[.4,.6,.65],id:1,material:1};
const back={z:6,alpha:.9,color:[.8,.5,.3],id:2,material:1};
const insert={z:3,alpha:.75,color:[.8,.3,.2],id:0xf0000011,material:1};

function loaded(work,result) {
  const report=work.get('out/'+result.report), folder=path.dirname(result.report);
  const image = work.file('out/'+folder+'/'+report.frames[0].image.file);
  return {report, image: PNG.raster(image), imageFile:image,
    deep: frame=>work.file('out/'+folder+'/'+report.frames[frame].deep.file)};
}

test('native import round-trips ID planes, samples, calibrated camera, and rejects malformed chunks',()=>{
  const bytes=fixture([back, front], 1.25), plate=ink.readDeepEXR(bytes);
  assert.deepEqual(Array.from(plate.offsets),[0,2,2,2,2]);
  assert.deepEqual(Array.from(plate.planes.Z),[2,6]);
  assert.deepEqual(Array.from(plate.planes['ink.objectId']),[1,2]);
  assert.equal(plate.time,1.25);
  assert.equal(plate.registration.worldToCamera[14],8);
  near(plate.planes.R[0], encoded(front.color)[0]*front.alpha);
  const source=fixture([insert], 2);
  assert.equal(ink.readDeepEXR(source).planes['ink.objectId'][0],0xf0000011);
  const invalid=Buffer.from(bytes), {at}=readHeader(bytes,[0x802],'test');
  invalid.writeBigUInt64LE(8n,at);
  assert.throws(()=>ink.readDeepEXR(invalid),/scanline/);
  assert.throws(()=>ink.readDeepEXR(bytes.subarray(0,bytes.length-1)),/Truncated/);
  assert.throws(()=>ink.readDeepEXR(bytes,{sampleBudget:1}),/sample budget/);
});

test('deep shot edits alpha, color and depth before merging rays in linear working color', t=>{
  const work=workspace(t);
  fs.writeFileSync(work.file('base.exr'),fixture([back,front],0));
  fs.writeFileSync(work.file('insert.exr'),fixture([insert],0));
  work.json('plan.json',{format:planFormat,version:1,reference:'base',working:'display-p3-linear',
    inputs:[{id:'base',file:'base.exr'},{id:'replacement',file:'insert.exr'}], effects:[
      operator('fade','opacity',{source:'base',object:'front'},{scale:.5}),
      operator('space','depth',{source:'replacement',object:0xf0000011},{offset:1}),
      operator('gain','color',{source:'replacement'},{exposure:1},{input:'srgb-linear',output:'srgb-linear'}),
      operator('erase','trim',{source:'base',object:'back'},{})
    ]});
  const process=act(work.dir,'run','plan.json','--out','out');
  assert.equal(process.status,0,process.stderr);
  const result=loaded(work,JSON.parse(process.stdout)), [row]=result.report.frames;
  assert.equal(row.trimmedSamples,1);
  assert(row.effects.every(effect=>effect.matched===1));
  const ray=ink.inspectDeepPlate(result.deep(0),{pixel:[0,0]}).pixel.samples;
  assert.deepEqual(ray.map(sample=>sample.object),['front','replacement/objects/4026531857']);
  assert.deepEqual(ray.map(sample=>sample.z),[2,4]);
  assert.deepEqual(ray.map(sample=>sample.alpha),[.25,.75]);
  near(ray[1].visibleCoverage,.75*.75);
  const a=encoded(front.color), b=encoded(insert.color), alpha=.25+.75*.75;
  const blended=a.map((n,i)=>(n*.25+2*b[i]*.75*.75)/alpha);
  const expected=fromLinear(blended).map(n=>Math.round(Math.max(0,Math.min(1,n))*255));
  assert.deepEqual(Array.from(result.image.data.slice(0,4)),[...expected,Math.round(alpha*255)]);
  assert.equal(require('../cli/texture-png.js').read(fs.readFileSync(result.imageFile),{layoutOnly:true}).profile.srgb,0);
  const original=ink.readDeepEXR(fs.readFileSync(work.file('base.exr'))), edited=ink.readDeepEXR(fs.readFileSync(result.deep(0)));
  for(const name of ['ink.surface.R','ink.scatter.R','ink.transmission.R']) near(original.planes[name][0],edited.planes[name][0]);
  assert(edited.planes.R[1]>.75);
  assert.equal(ink.readDeepEXR(fs.readFileSync(work.file('base.exr'))).planes.A[0],.5);
});

test('sequence alignment reports offsets and failed takes preserve the published revision',t=>{
  const work=workspace(t);
  const base=[0,.5], overlay=[.11,.61];
  for(const [i,time] of base.entries()) fs.writeFileSync(work.file('a-'+i+'.exr'),fixture([front],time));
  for(const [i,time] of overlay.entries()) fs.writeFileSync(work.file('b-'+i+'.exr'),fixture([insert],time,{shift:1}));
  for(const [name,times] of [['a',base],['b',overlay]])
    work.json(name+'.json',{format:'ink-studio/deep-openexr',version:1,
      frames:times.map((time,i)=>({time,file:name+'-'+i+'.exr'}))});
  const plan={format:planFormat,version:1,reference:'ref',alignment:'registered',clock:{tolerance:.011},
    inputs:[{id:'ref',file:'a.json'},{id:'pass',file:'b.json',timeOffset:-.1,offset:[1,0],depthOffset:.25}]};
  work.json('shot.json',plan);
  const output=ink.runDeepShot(work.file('shot.json'),{out:work.file('out')});
  const result=loaded(work,output), final = work.get('out/latest.json');
  assert.deepEqual(result.report.frames.map(frame=>frame.time),base);
  for(const [index,row] of result.report.frames.entries()){
    near(row.sources[1].delta,.01);
    assert.equal(ink.inspectDeepPlate(result.deep(index),{pixel:[1,0]}).pixel.samples[0].z,3.25);
    assert.equal(ink.inspectDeepPlate(result.deep(index),{pixel:[0,0]}).pixel.samples.length,1);
  }
  work.json('failed.json',{...plan,clock:{tolerance:.005}});
  assert.throws(()=>ink.runDeepShot(work.file('failed.json'),{out:work.file('out')}),/No frame/);
  work.json('failed.json',{...plan,alignment:'strict',inputs:[
    plan.inputs[0],{...plan.inputs[1],offset:[0,0],depthOffset:0}
  ]});
  assert.throws(()=>ink.runDeepShot(work.file('failed.json'),{out:work.file('out')}),/reference camera/);
  assert.deepEqual(work.get('out/latest.json'),final);
});

test('trusted native operators can extend the synchronous sample edit interface',t=>{
  const work=workspace(t);
  fs.writeFileSync(work.file('base.exr'),fixture([front],0));
  work.json('plan.json',{format:planFormat,version:1,reference:'base',inputs:[{id:'base',file:'base.exr'}],
    effects:[{...operator('shade','tintBlue',{object:'front'},{amount:.25}),version:2}]});
  const options={out:work.file('out')};
  assert.throws(()=>ink.runDeepShot(work.file('plan.json'),options),/Unknown deep effect/);
  const operators={tintBlue:{version:2,description:'Raise blue in the sample color.',parameters:['amount'],
    prepare({ amount }) {return sample=>{sample.rgb[2]+=amount;};}}};
  const output=ink.runDeepShot(work.file('plan.json'),{...options,operators});
  const result=loaded(work,output);
  near(ink.inspectDeepPlate(result.deep(0),{pixel:[0,0]}).pixel.samples[0].rgb[2],
    (encoded(front.color)[2]+.25)*.5);
  assert.equal(result.report.frames[0].effects[0].version,2);
});
