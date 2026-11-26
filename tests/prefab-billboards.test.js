const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..');
const R = require('../cli/render.js');
const Lens = require('../src/camera-lens.js');
const { fixture } = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;
const { V, M } = K, P = K.authoring.scenePrefabs;
const up = [0, 1, 0], front = [0, 0, 1], origin = [.36, .42, .08];
const near = (a, b) => assert.ok(V.dist(a, b) < 1e-6, `Expected ${a} near ${b}`);
const settings = (mode, facing, snapDegrees) => ({ mode, facing, ...(snapDegrees !== undefined && { snapDegrees }) });

function scene() {
  const { scene, library } = fixture();
  const { prefabLibrary, ...base } = scene;
  library.bay.points = { grip: { position: [.7, .42, .08] } };
  library.bay.solids.locator = { kind:'ball', at:[.7, .42, -.08], r:.12, mat:'glow',
    deliveryHelper:{ markerId:'locator' } };
  return { ...base, id:'billboard-bay', prefabs:library, topologyMeshes:{}, instances:{
    sign:{ prefab:'bay', origin, transform:{ translation:[.5, 0, 0], scale:.86 } }
  } };
}

test('full and upright axes face the camera direction or the eye with explicit snapping', () => {
  const instances = {
    full:{ origin, transform:{ translation:[-2, 1, .2], scale:2 }, billboard:settings('full','direction') },
    eye:{ origin, transform:{ translation:[2, 0, -.5] }, billboard:settings('full','position') },
    upright:{ origin, flipX:true, transform:{ translation:[1, 0, 0] }, billboard:settings('upright','position') },
    snap:{ billboard:settings('full','direction',30) },
    child:{ parent:'full', transform:{ translation:[.4, .5, 1] } },
    mirror:{ mirror:{ source:'full', plane:{ origin:[0,0,0], normal:[1,0,0] } } }
  };
  const yaw = 44 * Math.PI / 180, pitch = 34 * Math.PI / 180;
  const camera = Lens.orbitPose(yaw,pitch,6,[0,0,0]);
  const raw = P.placements(instances), facing = P.placements(instances,{camera});
  for (const id of ['full','eye','upright']) {
    near(P.placedOrigin(instances[id],facing.get(id)), P.placedOrigin(instances[id],raw.get(id)));
    assert.equal(facing.get(id).scale,raw.get(id).scale);
  }
  near(facing.get('full').direction(front), camera.back);
  near(facing.get('full').direction(up), camera.up);
  near(facing.get('eye').direction(front),V.norm(V.sub(camera.eye,raw.get('eye').point(origin))));
  const sight = V.sub(camera.eye,raw.get('upright').point(origin));
  near(facing.get('upright').direction(front),V.norm([sight[0],0,sight[2]]));
  near(facing.get('upright').direction(up), up);
  assert.ok(M.det(facing.get('upright').basis) < 0);
  near(facing.get('snap').direction(front),Lens.orbitPose(Math.PI/6,Math.PI/6,1,[0,0,0]).back);
  near(facing.get('child').point([0,0,0]),facing.get('full').point([.4,.5,1]));
  const reflected = facing.get('full').point(origin).slice();
  reflected[0] *= -1;
  near(facing.get('mirror').point(origin),reflected);

  const nearby = Lens.orbitPose(41 * Math.PI/180,31 * Math.PI/180,6,[0,0,0]);
  assert.deepEqual(P.placements(instances,{camera:nearby}).get('snap').mesh,facing.get('snap').mesh);
  const pole = Lens.orbitPose(1,Math.PI/2,6,[0,0,0]);
  near(P.placements(instances,{camera:pole}).get('upright').direction(up),up);
  assert.throws(() => P.placements({sign:{billboard:{snapDegrees:0}}}),/0.001 to 180/);
});

test('headless render turns registered tile faces with their solid module and retains rest geometry', () => {
  const editor = ink.createSceneEditor(scene());
  const pins = { instances:['sign'], billboard:settings('full','direction') };
  const before = editor.snapshot();
  assert.equal(editor.planPrefabBillboards(pins).canCommit,true);
  assert.deepEqual(editor.snapshot(),before);
  editor.editPrefabBillboards(pins);

  const world = editor.build(), camera = Lens.orbitPose(Math.PI/2,.38,4.5,[.5,.5,0]);
  const generated = world.prefabBillboards.sample(camera), { geometry } = K.sceneMeshes;
  const initial = geometry(world.topologyMeshes['sign.panel'].mesh).positions;
  const moved = geometry(generated.topologyMeshes['sign.panel'].mesh).positions;
  const rest = P.placements(before.instances).get('sign');
  const rotated = P.placements(editor.snapshot().instances,{camera}).get('sign');
  near(moved.slice(0,3),rotated.point(K.diorama.solidFrames.inverse(rest).point(Array.from(initial.slice(0,3)))));
  near(generated.made['sign.locator'].bc,rotated.point([.7,.42,-.08]));
  const { graph } = K.sceneGraph.fromDiorama(generated);
  near(graph.frame({node:'prefab.sign',socket:'grip'}).position,rotated.point([.7,.42,.08]));
  near(K.diorama.scene(editor.snapshot()).model(1,{resolution:.12}).helpers[0].frame.position,rest.point([.7,.42,-.08]));
  assert.deepEqual(geometry(world.topologyMeshes['sign.panel'].mesh).positions,initial);
  assert.equal(world.prefabBillboards.sample(camera),generated);

  const options = { w:160,h:100,px:1,yaw:Math.PI/2,pitch:.38,dist:4.5,target:[.5,.5,0],
    ortho:true,passes:['objectId'] };
  const pixels = frame => {
    const id = frame.passes.objects.indexOf('sign.panel');
    return id < 0 ? 0 : frame.passes.objectId.filter(n => n===id).length;
  };
  const without = R.render(ink.createSceneEditor(before).build(),options);
  const withFacing = R.render(world,options);
  assert.ok(pixels(withFacing)>400);
  assert.ok(pixels(withFacing)>pixels(without)*2);
  assert.ok(pixels(R.render(world,{...options,yaw:-Math.PI/2}))>400);

  editor.editPrefabBillboards({instances:['sign'],billboard:null});
  assert.deepEqual(editor.snapshot(),before);
  editor.undo();
  assert.deepEqual(editor.snapshot().instances.sign.billboard,pins.billboard);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('CLI uses saved instance selections, previews, and writes a separate retained scene', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-facing-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const write = (name,value) => fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const source = scene(), rule = settings('upright','position',15);
  const editor = ink.createSceneEditor(source);
  write('scene.json',source);
  write('billboard.json',{ billboard:rule });
  write('selection.json',editor.selectTilesetComponents({domain:'instances',query:{ids:['sign']}}));
  write('view.json',{w:150,h:100,camera:{yaw:1.24,pitch:.24,dist:4.5,target:[.5,.5,0],ortho:true}});
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const report = JSON.parse(execFileSync(process.execPath,[cli,'mesh-topology','billboard-prefab','scene.json','billboard.json',
    '--selection','selection.json','--view','view.json','--preview','review','--out','placed.json'],{cwd:dir,encoding:'utf8'}));
  assert.deepEqual(report.instances[0].after,rule);
  assert.ok(report.preview.instances[0].afterPixels>report.preview.instances[0].beforePixels);
  for (const filename of report.preview.files) assert.ok(fs.statSync(path.join(dir,'review',filename)).size>0);
  const placed = JSON.parse(fs.readFileSync(path.join(dir,'placed.json')));
  assert.deepEqual(placed.instances.sign,{...source.instances.sign,billboard:rule});
});
