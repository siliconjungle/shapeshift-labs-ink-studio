const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const {fixture}=require('../examples/mesh-modifiers/fixture.cjs');
const {KIT:K}=ink.load();
const {cage,stack,target}=fixture(K.meshTopology);
const graphSpec=(nodes,outputs)=>({format:'ink-studio/graph-project',version:1,nodes,outputs});
const op=(op,inputs)=>({op,inputs});
const link=node=>({node});
const cli=path.join(__dirname,'../cli/ink-studio.js');

test('modifier diagnostics capture source lineage, attribute edits, health and required bakes',()=>{
  const scene={id:'cabinet',solids:[],topologyMeshes:{panel:{document:cage,modifiers:stack.slice(0,3),
    bakes:[{id:'paint',material:'paint',maps:{roughness:.4}}]},mount:{document:target}}};
  const editor=ink.createSceneEditor(scene), plan=editor.inspectMeshModifiers('panel',{diagnostics:true});
  const [seat,mirror,shell]=plan.report.stages;
  assert.equal(plan.captures[1].before,plan.captures[0].after);
  assert.equal(seat.diagnostics.before.health.counts.nonManifold,0);
  assert(seat.diagnostics.changes.vertices.affected.includes('v0'));
  assert(mirror.diagnostics.changes.corners.attributes.some(row=>row.channel==='attributes/coat'));
  assert(mirror.diagnostics.changes.corners.attributes.some(row=>row.channel==='attributes/coat'&&row.copied));
  assert(mirror.diagnostics.changes.faces.affected.includes('panel'));
  assert(seat.work.some(row=>row.kind==='rebake'&&row.status==='required'&&row.sourceIds.includes('panel')));
  assert(shell.diagnostics.changes.faces.attributes.some(row=>row.after==='rim'));
  const overlapping=K.meshTopology.evaluateModifiers(cage,[{id:'overlap',kind:'array',count:2,step:[.22,0,0]}],
    {diagnostics:true});
  assert(overlapping.report.stages[0].diagnostics.after.health.counts.selfIntersections>0);
});

test('nested graph modeling watches show measured work once and save paired native-grid pixels',async()=>{
  const branch=graphSpec({
    blank:op('sdf.shape',{kind:'box',options:{half:[1,.65,.25],round:.1}}),
    tool:op('sdf.shape',{kind:'capsule',options:{rotation:[Math.PI/2,0,0],radius:.25,length:2}}),
    cut:op('sdf.combine',{sources:[] ,options:{operation:'subtract'}}),
    remesh:op('sdf.mesh',{source:link('cut'),options:{resolution:.11}})
  },{value:link('remesh')});
  branch.nodes.sources=op('data.record',{blank:link('blank'),tool:link('tool')});
  branch.nodes.list=op('data.collect',{source:link('sources'),keys:['blank','tool']});
  branch.nodes.cut.inputs.sources=link('list');
  const spec={...graphSpec({group:op('Carving',{})},{value:link('group')}),groups:{Carving:{
    nodes:branch.nodes,outputs:branch.outputs
  }}};
  const project=ink.createGraphProject(spec);
  const targets={cut:{node:'group/cut',modeling:true},mesh:{node:'group/remesh',modeling:true}};
  const view={w:80,h:60};
  const result=await project.previewFrame(targets,{time:0},{profile:true,modelingView:view});
  const {cut,mesh}=result.values;
  assert.equal(cut.native.pixelSize,1);
  assert(cut.native.changedPixels>0);
  assert.equal(mesh.upstream[0].node,'group/cut');
  assert.equal(mesh.work[0].kind,'remesh');
  assert(mesh.work[0].counts.cells>0);
  assert.equal(mesh.work[0].counts.triangles,mesh.after.triangles);
  assert.deepEqual(result.artifacts.map(row=>row.file),['previews/cut/before.png','previews/cut/after.png',
    'previews/mesh/before.png','previews/mesh/after.png']);
  const cached=await project.previewFrame(targets,{time:0},{encodeArtifacts:false});
  assert.equal(cached.values.mesh.status,'cached');
  assert.deepEqual(cached.values.mesh.work,[]);
});

test('patch and modifier CLIs write legible stage receipts independently of their source assets',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-modeling-watch-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const modifiers=stack.slice(0,3), spec=graphSpec({edit:op('model.modifiers',{source:cage,modifiers,targets:{mount:target}})},
    {output:link('edit'),report:{node:'edit',port:'report'}});
  write('graph.json',spec);
  write('stack.json',{format:'ink-studio/mesh-modifier-stack',version:1,document:cage,modifiers});
  write('targets.json',{mount:target});
  function run(args) {
    return JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8'}));
  }
  const result=run(['patch','run',file('graph.json'),'--frames','1','--size','80x60','--watch','forge=edit:@model','--out',file('patch')]);
  assert.equal(result.previews.forge.value.modifiers.length,3);
  assert.equal(result.previews.forge.value.native.changedPixels>0,true);
  assert(fs.existsSync(file('patch/previews/forge/after.png')));
  const ordinary=ink.createGraphProject(spec).run().outputs.report;
  const watched=await ink.createGraphProject(spec).previewFrame({forge:{node:'edit',modeling:true}},{},
    {encodeArtifacts:false});
  assert.deepEqual(watched.outputs.report,ordinary);
  assert(watched.values.forge.modifiers[1].diagnostics.changes.faces.affected.includes('panel'));
  const report=run(['mesh-topology','modifiers','inspect',file('stack.json'),'--targets',file('targets.json'),
    '--diagnostics','--preview',file('stack-view')]);
  assert.equal(report.stages[2].native.before,'stage-3-before.png');
  assert.equal(PNG.read(file('stack-view/stage-3-after.png')).w,160);
});

test('an attribute remap reports the contributing IDs and conflicting channels',async()=>{
  const source=K.procedural.attributes.asset('curve-control',[{id:'begin',point:[0,0,0]},{id:'end',point:[1,0,0]}],
    {role:{type:'label',interpolation:'constant',values:['port','exit']},power:{type:'number',values:[.2,.8]}});
  const spec=graphSpec({transfer:op('attributeRemap',{source,domain:'curve-control',entities:[{id:'mid',point:[.5,0,0]}],
    lineage:[{id:'mid',from:[{id:'begin',weight:.5},{id:'end',weight:.5}]}]})},{value:link('transfer')});
  const report=await ink.createGraphProject(spec).previewFrame({transfer:{node:'transfer',modeling:true}},{},
    {encodeArtifacts:false});
  const evidence=report.values.transfer.attributes;
  assert.deepEqual(evidence.affected,['begin','end']);
  assert(evidence.changed.some(row=>row.channel==='power'&&row.after===.5));
  assert.deepEqual(evidence.issues,[{id:'mid',channel:'role',reason:'constant-conflict'}]);
});
