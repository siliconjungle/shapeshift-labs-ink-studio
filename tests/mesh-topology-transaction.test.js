const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { fixture,editor,command,requests } = require('../examples/mesh-topology-transaction.cjs');

const native = session => ink.render(session.sceneEditor.build(),{w:96,h:72,px:1,raw:true,ortho:true}).rgb;
const row = session => session.sceneEditor.snapshot().topologyMeshes.relay;

test('preview, commit, undo, and replay include the topology, bindings, and live bake fallback', () => {
  const data = fixture(), session = editor(data), {model,draw} = requests(session,data.patch);
  const before = native(session), scoped = session.sceneEditor.build().topologyMeshes.relay;
  assert(scoped.resolvedBindings['cover-mask']);
  assert.equal(session.sceneEditor.tree().children.find(row=>row.kind === 'mesh-topology').key,'mesh-topology:relay');
  const seen = session.sceneEditor.pick({origin:[-.2,.8,5],direction:[0,0,-1],maxDistance:7});
  assert.equal(seen.key,'mesh-topology:relay');
  assert.equal(ink.load().KIT.meshTopology.triangleSource(scoped.mesh,seen.hit.triangle).face,'cover');
  const preview = session.execute(command('preview',{edit:{...model,patch:{...model.patch,revision:session.describe().revision}},
    options:{exact:true,limit:0}}));
  assert.equal(preview.valid,true,JSON.stringify(preview.conflicts));
  assert.equal(preview.diff.renderErrors.length,0);
  assert(preview.diff.rendered[0].cells.length>0);
  const [topology] = preview.diff.topology;
  assert.deepEqual(topology.changes.vertices.map(row=>row.id),['cap','sill']);
  assert(topology.changes.edges.some(edge=>edge.id === 'sill-edge' && edge.after === null));
  assert.equal(topology.edits[0].correspondence.domains.faces.groups.find(group=>group.from.includes('cover')).status,'split');
  assert.deepEqual(topology.changes.bindings.map(({id,change})=>[id,change]),[['cover-mask','needs-review'],['fastener','displaced']]);
  assert.deepEqual(topology.changes.bakes.map(({id,before,after})=>[id,before.status,after.status]),
    [['cover-atlas','ready','invalidated']]);
  assert.deepEqual(session.sceneEditor.snapshot(),data.scene);
  assert.deepEqual(session.receipts(),[]);

  const batch = session.applyBatch({label:'A surface and its annotation',revision:session.describe().revision,commands:[model,draw]});
  const after = native(session);
  assert.notDeepEqual(after,before);
  assert.equal(session.inspect([4,4]).swatch,'gold');
  assert.equal(session.sceneEditor.build().topologyMeshes.relay.resolvedBindings['cover-mask'],undefined);
  assert.deepEqual(row(session).bakes[0].maps,data.scene.topologyMeshes.relay.bakes[0].maps);
  assert.deepEqual(row(session).bakes[1],data.scene.topologyMeshes.relay.bakes[1]);
  assert.deepEqual(batch.steps[0].affectedTargets[0].topology.bindings,topology.changes.bindings);
  assert.deepEqual(session.history().undo,['A surface and its annotation']);

  const review = session.exportReview({batch,zoom:1});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.equal(review.manifest.topology,'topology.json');
  assert(review.manifest.files.some(({path,sha256})=>path==='topology.json' && sha256.length===64));
  assert.match(review.files['index.html'].data,/href="topology.json"/);
  assert.deepEqual(JSON.parse(review.files['topology.json'].data).meshes,
    JSON.parse(review.files['diff.json'].data).diff.topology);

  assert.equal(session.undo(),true);
  assert.deepEqual(session.snapshot(),data.pixel);
  assert.deepEqual(session.sceneEditor.snapshot(),data.scene);
  assert.deepEqual(native(session),before);
  assert.equal(session.redo(),true);
  assert.deepEqual(native(session),after);
  const fresh = editor(data);
  fresh.replayBatch(batch);
  assert.deepEqual(fresh.snapshot(),session.snapshot());
  assert.deepEqual(fresh.sceneEditor.snapshot(),session.sceneEditor.snapshot());
  assert.deepEqual(native(fresh),after);
});

test('a failed draft rolls back native topology and annotations and stale replay cannot displace the current scene', () => {
  const data = fixture(), session = editor(data), {model,draw} = requests(session,data.patch);
  const bad = {...model,patch:{...model.patch,operation:{patch:{removeFaces:['not-a-face']}}}};
  assert.throws(()=>session.applyBatch({revision:session.describe().revision,commands:[draw,bad]}),
    error=>error.receipt.failedStep===1 && error.receipt.conflicts[0].code==='invalid-edit');
  assert.deepEqual(session.snapshot(),data.pixel);
  assert.deepEqual(session.sceneEditor.snapshot(),data.scene);
  assert.deepEqual(session.history(),{undo:[],redo:[]});
  const batch = session.applyBatch({revision:session.describe().revision,commands:[model]});
  const changed = editor(data);
  changed.sceneEditor.editMeshTopology('relay',{vertices:[{id:'cap',position:[-.9,1.75,.32]}]});
  assert.throws(()=>changed.replayBatch(batch),error=>error.receipt.conflicts[0].code==='stale-source');
  assert.equal(row(changed).document.faces.length,2);
});

test('direct scene topology edits use the shared journal and feed whole-scene review', () => {
  const data = fixture(), session = editor(data);
  session.begin('Direct mesh adjustment');
  session.sceneEditor.editMeshTopology('relay',data.patch);
  const preview = session.previewChanges({exact:true});
  assert.equal(preview.diff.topology[0].edits[0].correspondence.domains.faces.groups.find(group=>group.from.includes('cover')).status,'split');
  assert(session.exportReview({zoom:1}).manifest.topology);
  session.commit();
  assert.equal(session.undo(),true);
  assert.deepEqual(session.sceneEditor.snapshot(),data.scene);
});

test('persisted CLI sessions replay and undo the same topology receipt with a scene-ID binding', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-topology-transaction-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = (name,value)=>{
    const target=path.join(dir,name);
    if (value !== undefined) fs.writeFileSync(target,JSON.stringify(value));
    return target;
  };
  const entry = path.join(__dirname,'../cli/ink-studio.js'), scene = file('scene.json',fixture().scene);
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,[entry,'pixel-art','session',...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe']
  }));
  const data = fixture(), pixels = file('pixels.json',data.pixel), state = file('session');
  const seed = editor(data), commands = Object.values(requests(seed,data.patch));
  const expected = seed.applyBatch({label:'Refit the relay',revision:seed.describe().revision,commands});
  cli('init',state,pixels,'--scene',scene);
  const replay = file('replay.json',command('replay-batch',{batch:expected}));
  assert.deepEqual(cli('run',state,replay),expected);
  const exportScene = file('export.json',command('export',{artifact:'scene'}));
  assert.deepEqual(cli('run',state,exportScene).data,seed.sceneEditor.snapshot());
  const review = file('review.json',command('export-review',{batch:expected,options:{zoom:1,out:file('review')}}));
  assert.equal(cli('run',state,review).manifest.topology,'topology.json');
  assert.equal(cli('undo',state).changed,true);
  assert.deepEqual(cli('run',state,exportScene).data,data.scene);
  const old = spawnSync(process.execPath,[entry,'render',scene,'--w','40','--h','32','--px','1','--out',file('render.png')],{encoding:'utf8'});
  assert.equal(old.status,0,old.stderr);
  assert(fs.existsSync(file('render.png')));
});
