'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { fixture } = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const { KIT: K } = ink.load(), topology = K.meshTopology;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const triangle = topology.fromIndexed({ id: 'panel', positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2] });
const delta = ({ before, after }) => K.V.sub(after, before);
const close = (result, expected) => assert(result.length === expected.length &&
  result.every((value, i) => Math.abs(value - expected[i]) < 1e-8), JSON.stringify({ result, expected }));
const move = offset => ({ kind: 'move', offset });

function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-transform-coordinates-'));
  t.after(() => fs.rmSync(cwd, { force: true, recursive: true }));
  const at = filename => path.join(cwd, filename);
  const call = (...args) => execFileSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'});
  return { write: (name,value) => fs.writeFileSync(at(name),JSON.stringify(value)),
    read: name => JSON.parse(fs.readFileSync(at(name),'utf8')),
    call, run: (...args) => JSON.parse(call(...args)),
    reject: (...args) => spawnSync(process.execPath,[cli,'mesh-topology',...args],{cwd,encoding:'utf8'}) };
}

test('camera moves, rotates and scales in an orthonormal world basis through a placed mesh', () => {
  const frame = { matrix: [0,-2,0, 3,0,0, 0,0,1], position: [4,-1,2] };
  const camera = { right: [0,0,-1], up: [0,1,0], back: [1,0,0] };
  const selection = topology.select(triangle, {domain:'faces'});
  const transform = (space, operation, fields = {}) => topology.planTransform(triangle,
    { selection, frame, pivot:[0,0,0], space, operation, ...fields });
  const worldAt = (result, id) => K.sceneGraph.point(frame, result.document.vertices.find(row=>row.id===id).position);
  const moved = transform('camera', move([1,2,3]), { camera });
  close(worldAt(moved,'v/0'), [7,1,1]);
  assert.deepEqual(moved.report.camera,camera);
  moved.report.worldAxes.forEach((axis,i) => close(axis,[camera.right,camera.up,camera.back][i]));
  const rotated = transform('camera', {kind:'rotate',axis:[0,0,1],degrees:90}, {camera});
  close(worldAt(rotated,'v/1'), [4,-1,5]);
  const scaled = transform('camera', {kind:'scale',factors:[2,3,.5]}, {camera});
  close(worldAt(scaled,'v/1'), [4,8,2]);
  close(worldAt(scaled,'v/2'), [3,-1,2]);
  assert.deepEqual(rotated.document.faces,triangle.faces);
  assert.deepEqual(scaled.document.edges,triangle.edges);
  const local = transform('local',move([1,0,0]));
  close(worldAt(local,'v/0'),[4,2,2]);
  close(local.report.worldAxes[0],[0,3,0]);
  close(worldAt(transform('world',move([1,0,0])),'v/0'),[5,-1,2]);
  const plane = {origin:[4,-1,2],right:[0,1,0],up:[0,0,-1],grid:.25};
  close(worldAt(transform('plane',move([1,0,0]),{constructionPlane:plane}),'v/0'),[4,0,2]);
  const replay = transform('camera',move([1,2,3]),{camera:moved.report.camera});
  assert.deepEqual(replay.document,moved.document);
  assert.throws(() => transform('camera',move([1,0,0])), /needs right, up and back/);
  assert.throws(() => transform('camera',move([1,0,0]),{camera:{...camera,back:[-1,0,0]}}), /right-handed/);
  assert.throws(() => transform('world',move([1,0,0]),{camera}), /guides for the chosen space/);
  assert(!Object.isFrozen(camera.right));
});

test('scene commands use the authored camera by default and can pin a different native view', t => {
  const { write, read, run, call, reject } = workspace(t);
  const scene = { id:'coordinate-test',style:'slate',solids:[],
    camera:{yaw:Math.PI/2,pitch:0,dist:4,projection:'orthographic'},
    topologyMeshes:{panel:{document:triangle}} };
  const selection = topology.select(triangle,{domain:'vertices',ids:['v/0']});
  const request = {space:'camera',selection,operation:move([.2,0,0])};
  const camera = {eye:[0,0,4],right:[0,1,0],up:[-1,0,0],back:[0,0,1]};
  const view = {w:96,h:64,lockCamera:true,camera:{pose:camera,ortho:true}};
  const editor = ink.createSceneEditor(scene);
  close(delta(editor.planMeshTransform('panel',request).report.vertices[0]),[0,0,-.2]);
  write('scene.json',scene);
  write('request.json',request);
  write('view.json',view);
  const command = ['transform','scene.json','request.json','--object','panel','--view','view.json'];
  const preview = run(...command);
  close(delta(preview.report.vertices[0]),[0,.2,0]);
  close(preview.report.camera.right,camera.right);
  const shortcut = run('move','scene.json','--object','panel','--vertex','v/0','--by','.2,0,0','--space','camera','--view','view.json');
  assert.deepEqual(shortcut.vertices,preview.report.vertices);
  call(...command,'--out','edited.json','--report','receipt.json');
  assert.deepEqual(read('receipt.json').transform,preview.report);
  assert.deepEqual(read('edited.json').topologyMeshes.panel.document.vertices[0].position,[0,.2,0]);
  write('pinned.json',{...request,camera:preview.report.camera});
  assert.deepEqual(run('transform','scene.json','pinned.json','--object','panel'),preview);
  assert.match(reject('transform','scene.json','pinned.json','--object','panel','--view','view.json').stderr,/pin camera axes/);
  assert.deepEqual(read('scene.json'),scene);
});

test('isolated prefab transforms use camera axes while protecting the shared boundary', t => {
  const { scene, library, request, shared } = fixture(), { write, read, run } = workspace(t);
  const edit = { ...request, edits:[{member:'panel',transform:{space:'camera',operation:move([.16,0,0]),pins:{vertices:shared}}}] };
  const camera = {eye:[0,.5,4],right:[0,1,0],up:[-1,0,0],back:[0,0,1]};
  const editor = ink.createSceneEditor(scene,{env:{prefabs:library}});
  close(delta(editor.planPrefabIsolation(edit).edits[0].evidence.vertices[0]),[.16,0,0]);
  write('scene.json',scene);
  write('library.json',library);
  write('view.json',{w:92,h:66,lockCamera:true,camera:{pose:camera}});
  write('edit.json',edit);
  const preview = run('isolate-prefab','scene.json','edit.json','--view','view.json','--out','revised.json');
  assert.deepEqual(preview.edits[0].changedFaces,['sign']);
  close(delta(preview.edits[0].evidence.vertices[0]),[0,.16,0]);
  assert.deepEqual(read('revised.json').instances.east,scene.instances.east);
  assert.deepEqual(read('scene.json'),scene);
});
