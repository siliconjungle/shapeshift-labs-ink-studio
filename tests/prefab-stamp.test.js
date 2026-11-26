'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;

function promoted() {
  const {scene,panel} = fixture();
  const {prefabLibrary,instances,...base} = scene;
  const editor = ink.createSceneEditor({...base,topologyMeshes:{panel}});
  editor.promoteTilesetPrefab({prefab:'station-bay',instance:'source',faces:{panel:['sign','grille']},
    origin:{kind:'point',id:'threshold',at:[-.75,0,0]}});
  return editor;
}

function close(actual,expected) {
  assert(actual.every((value,index) => Math.abs(value-expected[index]) < 1e-9),
    JSON.stringify({actual,expected}));
}

test('a run uses the retained grid, local orientation, and one undo for linked instances', () => {
  const editor = promoted();
  editor.setConstructionPlane({origin:[4,-2,3],right:[0,0,-1],up:[0,1,0],grid:[.5,2],rounding:'floor'});
  const before = editor.snapshot();
  const request = {prefab:'station-bay',id:'row',at:[.8,-.2],count:3,step:[3.5,.6],
    angle:90,normalOffset:.125};
  const report = editor.planPrefabStamp(request);
  assert(report.canCommit);
  assert.equal(report.prefabRevision,1);
  assert.equal(report.rounding,'floor');
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(report.placements.map(row => row.gridAt),[[0,-1],[4,0],[7,1]]);
  assert.deepEqual(report.placements.map(row => row.transform.translation),[[4.125,-4,3],[4.125,-2,1],[4.125,0,-.5]]);
  const rotated = K.diorama.solidFrames.authored(report.placements[0].transform);
  close(rotated.direction([1,0,0]),[0,1,0]);
  close(rotated.direction([0,1,0]),[0,0,1]);
  close(rotated.direction([0,0,1]),[1,0,0]);

  assert.deepEqual(editor.stampPrefab(request),report);
  const stamped = editor.snapshot(), ids = ['row.0','row.1','row.2','source'];
  assert.deepEqual(stamped.prefabs,before.prefabs);
  assert.deepEqual(Object.keys(stamped.instances).sort(),ids);
  assert.deepEqual(stamped.instances.source,before.instances.source);
  for (const {instance,transform} of report.placements)
    assert.deepEqual(stamped.instances[instance],{prefab:'station-bay',transform});
  assert.deepEqual(Object.keys(editor.build().topologyMeshes).sort(),ids.map(id => id+'.panel'));
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),stamped);
});

test('projects a world point onto the tilted plane and rounds independently of orientation', () => {
  const editor = promoted(), request = {id:'detail',prefab:'station-bay',point:[10.75,9,1.8],orientation:'world'};
  editor.setConstructionPlane({origin:[10,1,2],right:[1,0,0],up:[0,0,1],grid:[.5,.25]});
  for (const [rounding,gridAt,position] of [
    ['ceiling',[2,0],[11,1,2]],['floor',[1,-1],[10.5,1,1.75]],['nearest',[2,-1],[11,1,1.75]]
  ]) {
    const {placements,at} = editor.planPrefabStamp({...request,rounding});
    close(at,[1.5,-.8]);
    assert.deepEqual(placements[0].gridAt,gridAt);
    assert.deepEqual(placements[0].transform.rotation,[0,0,0]);
    assert.deepEqual(placements[0].transform.translation,position);
  }
  const unsnapped = editor.planPrefabStamp({...request,snapGrid:false});
  close(unsnapped.placements[0].transform.translation,[10.75,1,1.8]);
  assert.equal(unsnapped.placements[0].instance,'detail');
  assert.equal(unsnapped.rounding,undefined);
});

test('reports duplicate snapped positions and occupied IDs before changing any instance', () => {
  const editor = promoted();
  editor.setPrefabInstance('row.1',{prefab:'station-bay'});
  const before = editor.snapshot();
  const request = {id:'row',prefab:'station-bay',at:[0,0],count:2,step:[.15,0]};
  const report = editor.planPrefabStamp(request);
  assert.deepEqual(report.conflicts,[
    {kind:'instance-in-use',instance:'row.1'},
    {kind:'repeated-position',instance:'row.1',previous:'row.0',gridAt:[0,0]}
  ]);
  assert(!report.canCommit);
  assert.throws(() => editor.stampPrefab(request),error => {
    assert.deepEqual(error.report,report);
    return true;
  });
  assert.deepEqual(editor.snapshot(),before);
  assert.equal(editor.planPrefabStamp({...request,id:'free',snapGrid:false}).canCommit,true);
  assert.deepEqual(editor.planPrefabStamp({id:'one',prefab:'missing',at:[0,0]}).conflicts,
    [{kind:'unknown-prefab',prefab:'missing'}]);
});

test('CLI stamps from an external prefab library and only writes when the whole run can commit', t => {
  const {scene,library} = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-stamp-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value) => fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const request = {prefab:'bay',id:'north',at:[2.2,0],count:2,step:[0,2]};
  write('station.json',scene);
  write('library.json',library);
  write('stamp.json',request);
  const args = [cli,'tileset','stamp-prefab','stamp.json','--scene','station.json'];
  const preview = JSON.parse(execFileSync(process.execPath,args,{cwd:dir}));
  assert.equal(preview.prefabRevision,3);
  assert(preview.canCommit);
  assert(!read('station.json').instances['north.0']);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,[...args,'--out','stamped.json'],{cwd:dir})),preview);
  const stamped = read('stamped.json');
  assert.equal(stamped.prefabLibrary,'library.json');
  assert.deepEqual(stamped.instances['north.1'].transform.translation,[2,2,0]);
  assert.equal(stamped.instances['north.1'].prefab,'bay');
  write('stamp.json',{...request,step:[0,.1]});
  const failed = spawnSync(process.execPath,[...args,'--out','rejected.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(failed.status,1);
  assert.equal(JSON.parse(failed.stdout).conflicts[0].kind,'repeated-position');
  assert(!fs.existsSync(path.join(dir,'rejected.json')));
});
