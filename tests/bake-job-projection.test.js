const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { document } = require('../cli/glb-file.js');
const PNG = require('../cli/png.js');
const { inspectBakeJob, runBakeJob } = require('../cli/bake-jobs.js');

function scene(filename, meshes) {
  const fixture = document(), { gltf } = fixture;
  gltf.materials = [[.12,.12,.12], [1,0,0], [0,0,1], [0,1,0], [1,1,0]].map(base => ({
    pbrMetallicRoughness: { baseColorFactor: [...base, 1] }
  }));
  gltf.meshes = meshes.map(({ name, parts }) => ({name, primitives: parts.map(part => {
    const attributes = {
      POSITION:fixture.accessor(Float32Array.from(part.points.flat()),'VEC3',{bounds:true})
    };
    if (part.low) {
      attributes.TEXCOORD_0=fixture.accessor(Float32Array.of(0,1,1,1,1,0,0,0),'VEC2');
      attributes.NORMAL=fixture.accessor(Float32Array.from(Array(4).fill([.6,0,.8]).flat()),'VEC3');
    }
    if (part.tint) attributes.COLOR_0=fixture.accessor(Float32Array.from(Array(4).fill(part.tint).flat()),'VEC4');
    return {attributes,material:part.color,indices:fixture.accessor(Uint32Array.from(part.indices),'SCALAR')};
  })}));
  gltf.nodes=meshes.map(({ transform },mesh)=>({mesh,...transform}));
  gltf.scenes[0].nodes=gltf.nodes.map((_,i)=>i);
  fs.writeFileSync(filename,fixture.finish());
}

function quad(x0,x1,y0,y1,z,color,{reverse=false,low=false,tint}={}) {
  return {points:[[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]],color,low,tint,
    indices: reverse?[2,1,0,3,2,0]:[0,1,2,0,2,3]};
}

function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-bake-projection-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=file=>path.join(root,file);
  scene(at('low.glb'),[{name:'Plate_lo',transform:{translation:[2,3,0],scale:[2,2,1]},
    parts:[quad(-.5,.5,-.5,.5,0,0,{low:true})]}]);
  scene(at('high.glb'),[
    {name:'Plate_hi',transform:{translation:[1,2,0]},parts:[
      quad(0,1,0,2,.15,1),quad(1,2,0,2,-.10,2),quad(0,1,0,2,.22,3,{reverse:true})
    ]},
    {name:'Badge_hi',parts:[quad(1,2,2,4,.26,4,{tint:[1,.5,0,1]})]}
  ]);
  scene(at('cage.glb'),[{name:'Plate Cage',parts:[quad(1.14,3.14,2,4,.25,0)]}]);
  scene(at('wrong.glb'),[{name:'Wrong Cage',parts:[quad(1,3,2,4,.25,0,{reverse:true})]}]);
  fs.writeFileSync(at('skew.png'),PNG.encodeGray(2,2,new Uint8Array(4)));
  const project={mode:'project',high:'detail',match:'name',lowSuffix:'_lo',highSuffix:'_hi',
    front:.24,back:.12,normals:'face',backfaces:'ignore'};
  const cases={
    self:{mode:'self'},
    bounds:{...project,units:'bounds',front:.1,back:.06},
    scene:{...project,units:'scene',front:.1,back:.06},
    ignore:project,
    block:{...project,backfaces:'block'},
    accept:{...project,backfaces:'accept'},
    all:{mode:'project',high:'detail',match:'all',front:.3,back:.12,normals:'face'},
    one:{mode:'project',high:'detail',mesh:1,front:.3,back:.12,normals:'face'},
    explicit:{...project,front:.01,back:.4,cage:{source:'cage'}},
    skew:{...project,front:.2,back:0,normals:'average',skew:'paint'},
    invert:{...project,front:.2,back:0,normals:'average',skew:'paint',invertSkew:true}
  };
  const targets=Object.entries(cases).map(([id,projection])=>({id,mesh:'Plate_lo',projection}));
  const plan={format:'ink-studio/bake-job',version:1,label:'Projection checks',source:'low.glb',
    projectionSources:{detail:'high.glb',cage:'cage.glb',wrong:'wrong.glb'},
    skewMaps:{paint:{tiles:[{tile:1001,file:'skew.png'}]}},
    preset:{format:'ink-studio/bake-preset',version:1,label:'Proof',defaults:{size:32,padding:0},
      maps:['pigment','normal','cage-hit','cage-miss','cage-backface','cage-relief'].map(id=>({id}))},targets};
  fs.writeFileSync(at('job.json'),JSON.stringify(plan));
  return {at,targets,project};
}

test('projection applies scene transforms, separate reach, mesh matching, backface policy, cage and inverted UV skew',async t=>{
  const {at,targets,project}=setup(t), job=at('job.json'), out=at('review');
  const setupReport=await inspectBakeJob(job);
  assert.deepEqual(setupReport.projectionCatalog.sources[1].meshes.map(mesh=>mesh.name),['Plate_hi','Badge_hi']);
  assert.deepEqual(setupReport.projectionCatalog.skewMaps,['paint']);
  const result=await runBakeJob(job,{directory:out});
  const row=(target,map='pigment')=>result.report.maps.find(row=>row.target===target&&row.map===map);
  function pixel(target,x,y,map) {
    const {w,data}=PNG.raster(path.join(path.dirname(result.file),row(target,map).file));
    const i=(y*w+x)*4;
    return Array.from(data.slice(i,i+3));
  }
  const red=[255,0,0], green=[0,255,0], blue=[0,0,255], yellow=[255,188,0];
  const gray=pixel('self',8,16);
  assert.equal(row('self').projection.hits,1024);
  assert.equal(row('self').projection.checks,0);
  assert.deepEqual(pixel('bounds',8,16),red);
  assert.deepEqual(pixel('bounds',24,16),blue);
  assert.deepEqual(pixel('scene',8,16),gray);
  assert.equal(row('scene').projection.misses,1024);
  assert.deepEqual(row('bounds').projection.highMeshes,['Plate_hi']);
  assert(pixel('bounds',8,16,'cage-relief')[0]>128);
  assert(pixel('bounds',24,16,'cage-relief')[0]<128);
  assert.deepEqual(pixel('ignore',8,16),red);
  assert.deepEqual(pixel('block',8,16),gray);
  assert.deepEqual(pixel('accept',8,16),green);
  assert.deepEqual(pixel('ignore',8,16,'cage-backface'),[255,255,255]);
  assert.deepEqual(pixel('ignore',8,16,'cage-hit'),[255,255,255]);
  assert.equal(row('ignore').projection.backfaces,512);
  assert.deepEqual(pixel('all',8,16),yellow);
  assert.deepEqual(pixel('one',8,16),yellow);
  assert.equal(pixel('one',24,16,'cage-miss')[0],255);
  assert.deepEqual(pixel('explicit',8,16),red);
  assert.deepEqual(pixel('explicit',24,16),gray);
  assert.equal(row('explicit').projection.cageMesh,'Plate Cage');
  assert.deepEqual(pixel('skew',15,16),red);
  assert.deepEqual(pixel('invert',15,16),gray);
  assert(['low.glb','high.glb','cage.glb','skew.png'].every(name=>result.report.inputs.some(row=>row.file===name)));
  const last=fs.readFileSync(path.join(out,'latest.json'));
  await assert.rejects(()=>runBakeJob(job,{directory:out,targetValues:[{
    ...targets[0],projection:{...project,cage:{source:'wrong'}}
  }]}),/same vertex order and triangle indices/);
  assert.deepEqual(fs.readFileSync(path.join(out,'latest.json')),last);
});
