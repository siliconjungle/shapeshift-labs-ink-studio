'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const rgba = (color,width=2,height=2)=>ink.createBlankTileset({width,height,background:color});
const brick = {...rgba('#95543a'),tileSize:{width:2,height:2}};
const tilesetSource = {file:'paint.png',refresh:'manual',sha256:'a'.repeat(64)};
const vertices = [[0,0,0],[1,0,0],[1,1,0],[0,1,0]].map((position,i)=>({id:'v'+i,position}));
const corners = [[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({id:'c'+i,vertex:'v'+i,uv}));
const scene = {id:'source-sheet',style:'slate',solids:[],tilesets:{brick,duplicate:brick},
  topologyMeshes:{wall:{document:{id:'wall',vertices,faces:[{id:'wall-face',material:'wall-paint',corners}]},
    materials:[{id:'wall-paint',texture:{tileset:'brick'}}]}}};

function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-source-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const file = name=>path.join(cwd,name);
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const run = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'});
  const edit = (type,source,...args)=>{
    const {status,stdout,stderr} = run('tileset',type,'--scene',source+'.json','--id','brick',...args);
    assert.ok(stdout,stderr);
    return {status,report:JSON.parse(stdout)};
  };
  function writeImage(name,asset) {
    fs.writeFileSync(file(name),PNG.encode(asset.width,asset.height,Buffer.from(asset.data,'base64'),4));
  }
  fs.writeFileSync(file('scene.json'),JSON.stringify(scene));
  writeImage('paint.png',brick);
  return {file,read,run,edit,writeImage};
}

test('CLI previews incoming texels, checks the reviewed digest, and protects local paint',t=>{
  const {file,read,edit,writeImage} = workspace(t);
  writeImage('local.png',rgba('#bea533'));
  const mismatch = edit('link','scene','local.png').report;
  assert.equal(mismatch.blockers[0].reason,'different-embedded-image');
  const linked = edit('link','scene','paint.png','--out','linked.json');
  assert.equal(linked.status,0);
  assert.deepEqual(read('linked.json').tilesetSources.brick,
    {file:'paint.png',refresh:'manual',sha256:linked.report.incoming.sha256});
  const next = Buffer.from(brick.data,'base64');
  next.set([2,150,82,190],12);
  writeImage('paint.png',{...brick,data:next.toString('base64')});
  const {report} = edit('reload','linked');
  assert.equal(report.localPaint,false);
  assert.equal(report.applied,false);
  assert.deepEqual(report.diff,{changed:1,added:0,removed:0,slotChanges:0,paletteChanged:false,alphaChanged:false,
    bounds:{x:1,y:1,width:1,height:1},samples:[{x:1,y:1,before:[149,84,58,255],incoming:[2,150,82,190]}]});
  assert.equal(report.sourceChanged,true);
  const stale = edit('reload','linked','--expect',linked.report.incoming.sha256,'--out','stale.json');
  assert.equal(stale.status,1);
  assert.equal(stale.report.blockers[0].reason,'source-revision-changed');
  assert.equal(fs.existsSync(file('stale.json')),false);

  assert.equal(edit('replace','linked','local.png','--out','local.json').status,0);
  const conflict = edit('reload','local','--out','blocked.json');
  assert.equal(conflict.status,1);
  assert.equal(conflict.report.localPaint,true);
  assert.equal(conflict.report.blockers[0].reason,'local-paint');
  assert.equal(fs.existsSync(file('blocked.json')),false);
  const accepted = edit('reload','local','--expect',report.incoming.sha256,'--accept-external','--out','accepted.json');
  assert.equal(accepted.status,0);
  assert.equal(accepted.report.applied,true);
  assert.equal(read('accepted.json').tilesetSources.brick.sha256,report.incoming.sha256);
  assert.deepEqual(read('accepted.json').tilesets.brick.tileSize,brick.tileSize);
  assert.deepEqual(read('accepted.json').topologyMeshes,scene.topologyMeshes);
  assert.equal(edit('reload','accepted').report.status,'current');
  assert.deepEqual(read('scene.json'),scene);
  assert.deepEqual(read('linked.json').tilesets.brick,brick);
  assert.deepEqual(Buffer.from(ink.readTilesetImage(file('paint.png')).data,'base64'),next);
});

test('on-load refresh renders clean updates in memory and falls back when the source does not fit or is offline',t=>{
  const {file,read,run,edit,writeImage} = workspace(t);
  assert.equal(edit('link','scene','paint.png','--refresh','on-load','--out','auto.json').status,0);
  const original = fs.readFileSync(file('auto.json'));
  const render = (input,name)=>{
    const runResult = run('render',input+'.json','--w','42','--h','42','--px','1','--target','.5,.5,0',
      '--zoom','1.6','--yaw','0','--pitch','0','--ortho','--raw','--out',name+'.png');
    assert.equal(runResult.status,0,runResult.stderr);
    return {png:fs.readFileSync(file(name+'.png')),log:runResult.stderr};
  };
  const base = render('auto','base');
  writeImage('paint.png',rgba('#397aaa'));
  const updated = render('auto','updated');
  assert.match(updated.log,/refreshed in memory/);
  assert.notDeepEqual(base.png,updated.png);
  assert.deepEqual(fs.readFileSync(file('auto.json')),original);

  writeImage('paint.png',rgba('#397aaa',1,2));
  const unsupported = render('auto','layout-changed');
  assert.match(unsupported.log,/image-layout-changed/);
  assert.deepEqual(base.png,unsupported.png);
  const plan = edit('reload','auto').report;
  assert.equal(plan.diff.removed,2);
  assert.equal(plan.revision.blockers[0].reason,'grid-does-not-fit');

  fs.unlinkSync(file('paint.png'));
  const offline = render('auto','offline');
  assert.match(offline.log,/missing-source/);
  assert.deepEqual(base.png,offline.png);
  assert.equal(edit('reload','auto').report.canCommit,false);
  const policy = edit('link','auto','paint.png','--refresh','manual','--out','manual.json');
  assert.equal(policy.status,0);
  assert.equal(policy.report.policyOnly,true);
  assert.deepEqual(read('manual.json').tilesetSources.brick,
    {...read('auto.json').tilesetSources.brick,refresh:'manual'});
});

test('reload reports index changes between identical swatches',t=>{
  const {file,edit,read} = workspace(t);
  const palette = [[51,60,77],[51,60,77]];
  const write = slots=>fs.writeFileSync(file('paint.png'),PNG.encodeIndexed(2,2,slots,palette));
  write([0,0,0,0]);
  assert.equal(edit('link','scene','paint.png','--accept-external','--out','indexed.json').status,0);
  write([0,1,0,0]);
  const {report,status} = edit('reload','indexed','--out','restored.json');
  assert.equal(status,0);
  const {changed,slotChanges,samples} = report.diff;
  assert.equal(changed,1);
  assert.equal(slotChanges,1);
  assert.deepEqual(samples,[{x:1,y:0,before:[51,60,77,255],incoming:[51,60,77,255],beforeSlot:0,incomingSlot:1}]);
  assert.deepEqual([...Buffer.from(read('restored.json').tilesets.brick.data,'base64')],[0,1,0,0]);
});

test('source metadata and replacement share undo, while clones are detached from live refresh',()=>{
  const editor = ink.createSceneEditor(scene);
  const painting = rgba('#2d667e');
  assert.equal(editor.planTilesetSource('brick',painting,null).canCommit,false);
  const planned = editor.planTilesetSource('brick',painting,tilesetSource);
  assert.equal(planned.canCommit,true);
  editor.updateTilesetSource('brick',painting,tilesetSource);
  const linked = editor.snapshot();
  assert.deepEqual(linked.tilesetSources,{brick:tilesetSource});
  assert.deepEqual(editor.tilesetDependencies('brick').sheets[0].source,tilesetSource);
  editor.undo();
  assert.deepEqual(editor.snapshot(),scene);
  editor.redo();
  assert.deepEqual(editor.snapshot(),linked);

  editor.editTilesetRevision({type:'clone',id:'brick',newId:'spare'});
  assert.equal(editor.tilesetDependencies('spare').sheets[0].source,undefined);
  assert.equal(editor.planTilesetRevision({type:'deduplicate',id:'brick',keepId:'spare'}).blockers[0].reason,
    'different-source-links');
  editor.updateTilesetSource('duplicate',brick,tilesetSource);
  editor.editTilesetRevision({type:'remove',id:'duplicate'});
  assert.deepEqual(editor.snapshot().tilesetSources,{brick:tilesetSource});
  editor.undo();
  assert.deepEqual(editor.snapshot().tilesetSources,{brick:tilesetSource,duplicate:tilesetSource});
});
