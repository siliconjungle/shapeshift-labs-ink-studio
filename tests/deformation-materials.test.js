const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT, W = K.world;
const demo = require('../examples/world-surface-state.json');

function panel() {
  const rect = (min, max) => ({ kind: 'rect', min, max });
  return { id: 'surface-panel',
    style: { palette: [0x101820, 0x434343, 0x777777, 0xaaaaaa, 0xd0d0d0, 0xff0000, 0xa00000, 0x700000, 0x7a8690,
      0x995555, 0x595d65, 0x858a93, 0xf2f2f2], roles: { stone: [1, 2, 3, 4] } },
    camera: { target: [0, 1, 0], dist: 4, yaw: .25, pitch: .1 },
    solids: [{ id: 'panel', kind: 'box', at: [0, 1, 0], half: [1, .5, .16], mat: 'stone', part: 'panel', res: .094,
      surfaceState: { charts: {
        'panel-front': { origin: [-1, .5, .16], u: [2, 0, 0], v: [0, 1, 0], stamps: [
          { channel: 'paint', value: '#ff0000', brush: rect([.1,.15],[.6,.85]) },
          { channel: 'wear', value: 1, brush: rect([.45,.15],[.6,.85]) },
          { channel: 'wetness', value: 1, brush: rect([.65,.1],[.96,.9]) }
        ] }
      } } }],
    parts: { panel: { joint: [0, 1, 0] } },
    motion: [{ do: 'squash', part: 'panel', axis: [1, 0, 0], amount: .4, period: 4 }]
  };
}
const copy = value => JSON.parse(JSON.stringify(value));
const whole = { kind: 'rect', min: [0, 0], max: [1, 1] };
const byChart = (world, name) => {
  const { targets, targetIds } = world.renderMetadata;
  return Array.from(targetIds ?? []).flatMap((target, i) => targets[target]?.surface === name ? [i] : []);
};
const point = (w, i) => Array.from(w.data.subarray(i * 16, i * 16 + 3));
const rgb = (w, i) => w.data[i * 16 + 7];
const red = packed => (packed & 255) > 96 && (packed >> 8 & 255) < 20 && (packed >> 16 & 255) < 20;
const ink = (w, name = 'panel-front') => byChart(w, name).filter(i => red(rgb(w, i)));

test('authored ink, wear and wetness persist through rig stretch and a transformed rebake', () => {
  const spec = panel(), editor = studio.createSceneEditor(spec);
  const world = editor.build();
  world.anim.update(0, 0);
  const hit = ink(world);
  assert(hit.length > 10 && hit.every(i => point(world, i)[0] < -.08));
  const i = hit.find(i => point(world, i)[0] < -.5), before = point(world, i), color = rgb(world, i);
  world.anim.update(.05, 1);
  assert(point(world, i)[0] < before[0] - .12);
  assert.equal(rgb(world, i), color);

  editor.setTransform({ translation: [2, 0, 0], rotation: [Math.PI, 0, 0] }, ['solid:panel']);
  const rebake = editor.build(), moved = ink(rebake);
  assert(moved.length > 10 && moved.every(i => point(rebake, i)[0] > 2.08 && point(rebake, i)[2] < -.15));
  const resampled = editor.snapshot();
  const next = copy(resampled);
  next.solids[0].res = .13;
  assert(ink(K.diorama.build(next)).length > 5);
  assert.notEqual(rebake.count, K.diorama.build(next).count);
  next.finish = { adaptiveSampling: true };
  assert(ink(K.diorama.build(next)).length > 4);

  const cleared = copy(editor.snapshot().solids[0].surfaceState);
  cleared.charts['panel-front'].stamps = [];
  editor.setSurfaceState(cleared, ['solid:panel']);
  assert.equal(ink(editor.build()).length, 0);
  editor.undo();
  assert(ink(editor.build()).length > 10);
  const bad = copy(spec);
  bad.solids[0].surfaceState.charts['panel-front'].v = [4, 0, 0];
  assert(K.diorama.check(bad).some(row => row.path.endsWith('.surfaceState') && /span a plane/.test(row.problem)));
});

test('inverse warp and cut provenance retain marks on inherited skin and keep new caps clean', () => {
  const spec = panel();
  delete spec.parts;
  delete spec.motion;
  delete spec.solids[0].part;
  const solid = spec.solids[0];
  solid.modifiers = [{ id: 'curve', kind: 'warp', bend: .24, centre: [0, 1, 0] }];
  const field = K.diorama.brushField(spec);
  const x = -.6, y = .86, radius = 1 / .24;
  const bent = [(radius - y + 1) * Math.sin(x * .24), 1 + radius - (radius - y + 1) * Math.cos(x * .24), .16];
  const sample = field.materialAt(field.surfaceAt(...bent).material, bent, [0, 0, 1]);
  assert.equal(sample.surfaceId, 'panel-front');
  assert(sample.albedo[0] > .9 && sample.albedo[1] < .01);
  assert(ink(K.diorama.build(spec)).length > 6);

  const B = kit.makeBuilder(17, spec.style.palette), S = K.sculpt(kit.makeSculpt(B));
  const paint = K.procedural.surfaceState, chart = solid.surfaceState.charts['panel-front'];
  const material = paint.bind({ r: [1, 2, 3, 4] }, paint.projection({ charts: {
    'panel-front': { ...chart, depth: .1, stamps: [{ channel: 'paint', value: '#ff0000', brush: whole }] }
  } }), B.P);
  const box = S.box([0, 1, 0], [1, .5, .16], material, { hold: true });
  const tool = S.box([.55, 1, .23], [.4, .4, .14], { r: [1, 2] }, { hold: true });
  const sliced = S.join('cut', box, tool, { r: 0 });
  assert.equal(S.materialAt(sliced.mat, [.55, 1, .09], [0, 0, 1]).surfaceId, undefined);
  assert.equal(S.materialAt(sliced.mat, [-.55, 1, .16], [0, 0, 1]).surfaceId, 'panel-front');
});

test('rebakes resample charted appearance in brush chunks and model surfaces', () => {
  const spec = panel();
  delete spec.parts;
  delete spec.motion;
  delete spec.solids[0].part;
  const model = K.diorama.scene(spec).model(1, { resolution: .095 });
  assert(model.meshes[0].sampleSurface([-.55,1,.16],[0,0,1]).color[0] > .55);
  const wet = model.meshes[0].sampleSurface([.62,1,.16],[0,0,1]);
  const dry = model.meshes[0].sampleSurface([.24,1,.16],[0,0,1]);
  assert(wet.roughness < dry.roughness && wet.color[0] < dry.color[0]);
  spec.brushRegion = { bounds: { min: [-1.2,.4,-.35], max: [1.2,1.6,.35] }, solids: ['panel'], cell: .125,
    chunkCells: 8, strokes: [] };
  const editor = studio.createSceneEditor(spec), before = editor.build();
  assert(ink(before).length > 10);
  assert([...before.brushRegion.chunks.values()].some(chunk => ink(chunk).length > 0));
  const after = editor.applyBrush({ id: 'notch', mode: 'erase', points: [[.7,1,.14]], radius: .28 });
  assert(ink(after).length > 10);
  assert(after.brushRegion.work.reused > 0);
});

function fabric() {
  return { id: 'marked-fabric', dt: .05, entities: { pin: { position: [1,2,0] } },
    systems: { fabric: { kind: 'deformables', config: { gravity: [0,0,0], shapes: {
      sheet: { kind: 'cloth', at: [-1,1,0], u: [2,0,0], v: [0,1,0], nu: 5, nv: 4, stretch: .001,
        attachments: { left: { node: 15, point: [-1,2,0] }, right: { node: 19, entity: 'pin' } },
        look: [1,2,3,4], surfaceState: { chart: 'cloth-front', stamps: [
          { channel: 'paint', value: '#ff0000', brush: { kind: 'rect', min: [.04,.05], max: [.42,.95] } },
          { channel: 'wetness', value: .62, brush: { kind: 'rect', min: [.02,.05], max: [.28,.95] } }
        ] }
      }
    } } } }, visual: { palette: [...panel().style.palette, ...Array(12).fill(0x45423c)],
      bounds: { min: [-2,-.2,-1], max: [2,2.6,1] }, resolution: .1, fields: { deformables: 'fabric/surfaces' } } };
}

test('cloth stamps use rest UV under stretch, cut and alternate render resolutions, including checkpoint replay', () => {
  const run = W.runtime.create(fabric()), surface = () => run.query().probe('fabric/surfaces').value.sheet;
  const sample = args => run.query().probe('fabric/surface-state', {}, { shape: 'sheet', ...args });
  const original = surface(), fixed = sample({ face: 0, weights: [.1,.5,.4] }).value;
  assert.equal(fixed.values.wetness, .62);
  assert.equal(fixed.values.paint.coverage, 1);
  run.schedule([
    { tick: 1, action: 'world/patch', args: { edits: [{ op: 'set', path: '/entities/pin/position', value: [1.6,2.1,.22] }] } },
    { tick: 2, action: 'fabric/surface-stamp', args: { shape: 'sheet', stamp: {
      channel: 'wear', value: .36, brush: { kind: 'rect', min: [.33,.1], max: [.48,.95] }
    } } }
  ]);
  run.advance(3);
  const stretched = surface();
  assert(K.V.dist(stretched.points[19], original.points[19]) > .5);
  assert.deepEqual(sample({ face: 0, weights: [.1,.5,.4] }).value, fixed);
  assert.equal(sample({ uv: [.38,.5] }).value.values.wear, .36);
  const [, ids] = stretched.strands.find(([, [a,b]]) => a === 7 && b === 8);
  const cut = K.V.lerp(stretched.points[ids[0]], stretched.points[ids[1]], .5);
  run.schedule([{ tick: 4, action: 'fabric/cut', args: { shape: 'sheet', point: cut, radius: .09 } }]);
  run.advance(6);
  const removed = surface().faces.findIndex(face => face === null);
  assert(removed >= 0);
  assert.equal(sample({ face: removed, weights: [1,0,0] }).status, 'missing');
  assert.deepEqual(sample({ face: 0, weights: [.1,.5,.4] }).value, fixed);
  for (const resolution of [.105, .175]) {
    const view = run.view(), rendered = W.visual(kit, { ...view, world: {
      ...view.world, visual: { ...view.world.visual, resolution }
    } }, run.query());
    assert(byChart(rendered,'cloth-front').length > 20);
    assert(ink(rendered,'cloth-front').length > 8);
  }
  assert.deepEqual(W.runtime.replay(copy(run.recording())).checkpoint(),run.checkpoint());
});

test('rigid pieces copy only their exterior wetness windows and fresh fracture faces remain dry', () => {
  const spec = copy(demo);
  spec.systems.rig.config.bodies.sign.surfaceState.faces['+z'].push({
    channel: 'wetness', value: .8, brush: { kind: 'rect', min: [0,0], max: [.49,1] }
  });
  const dry = W.runtime.create(demo), run = W.runtime.create(spec);
  run.advance(11); dry.advance(11);
  function query(body, face) {
    return run.query().probe('rig/surface-state', {}, { body, face, uv: [.4,.5] }).value;
  }
  assert.equal(query('sign.0','+z').values.wetness,.8);
  assert.equal(query('sign.1','+z').values.wetness,0);
  assert.equal(query('sign.0','+x').values.wetness,0);
  const render = r => W.visual(kit,r.view(),r.query());
  assert.notDeepEqual(render(run).data,render(dry).data);
});

test('materialised fragments keep baked chart colours and restore the same rig attachment', () => {
  const world = K.diorama.build(panel());
  world.anim.update(0,0);
  const [i] = ink(world), color = rgb(world,i), start = point(world,i);
  const fx = world.anim.add(K.materialisation.bind(world.anim,{ids:[i],drag:0}));
  fx.release({velocity:[1,0,0],normalImpulse:0});
  fx.advance(.22);
  assert(K.V.dist(point(world,i),start)>.1);
  assert.equal(rgb(world,i),color);
  fx.rejoin({duration:.18});
  fx.advance(.3);
  assert.equal(rgb(world,i),color);
  assert.deepEqual(point(world,i),start);
});

test('CLI validates and renders the retained chart source', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-deformation-materials-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), spec = panel();
  const source = path.join(temp,'source.json'), baseline = path.join(temp,'plain.json'), png = path.join(temp,'test.png');
  fs.writeFileSync(source,JSON.stringify(spec));
  delete spec.solids[0].surfaceState;
  fs.writeFileSync(baseline,JSON.stringify(spec));
  const dry = file => {
    execFileSync(process.execPath,[cli,'render',file,'--t','1','--raw','--w','96','--h','64','--px','1','--out',png],{stdio:'pipe'});
    return fs.readFileSync(png);
  };
  assert.notDeepEqual(dry(source),dry(baseline));
});

test('WebGL displays chart ink on a rigged and stretched object', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({},panel,(kit,fixture,backend)=>{
    const w=kit.KIT.diorama.build(fixture()), draw=backend(96,64,{raw:true});
    try {
      w.anim.update(0,0);
      draw.draw(w,{time:0});
      const first=draw.image();
      w.anim.update(.05,1);
      const dirty=Array.from(w.anim.rows).flatMap((n,i)=>n?[i]:[]);
      draw.draw(w,{time:1,changedRows:dirty});
      const changed=first!==draw.image();
      const plain=fixture();
      delete plain.solids[0].surfaceState;
      const dry=kit.KIT.diorama.build(plain);
      dry.anim.update(0,0); dry.anim.update(.05,1);
      const marked=draw.image();
      draw.draw(dry,{time:1});
      return {changed,ink:marked!==draw.image()};
    } finally {draw.close();}
  });
  assert(result.changed && result.ink);
});
