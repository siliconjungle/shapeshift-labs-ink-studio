'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const Finish = require('../src/paint-finish.js');
const Provenance = require('../src/splat-provenance.js');
const { KIT: K } = ink.load();
const scene = { id: 'paint-finish', camera: { target: [0,0,.22], dist: 4.4, yaw: 0, pitch: 0, sway: 0 },
  style: { palette: [0x171f2e,0x164a51,0x327370,0x54a196,0x8ac9b0,0x655343,0x917761,0xb49776,0xddb890],
    roles: { stone: [1,2,3,4], clay: [5,6,7,8] }, sun: [-.33,.39,.86], amb: .24, sky: .22 },
  solids: [
    { id: 'tile', kind: 'box', at: [-.66,0,0], half: [.59,.63,.18], mat: 'stone', res: .044 },
    { id: 'neighbor', kind: 'box', at: [.68,0,0], half: [.63,.63,.18], mat: 'clay', res: .047 }
  ] };
const mark = { id: 'line', brush: { kind: 'sphere', radius: .114 }, poses: [{ point: [-.34,-.31,.43] }, { point: [-.34,.31,.43] }],
  step: .037, attachment: { kind: 'surface', slot: 'receiver', snap: { mode: 'surface', direction: [0,0,1], maxDistance: .41 } } };
const placement = (finish, spot = mark) => ({ id: 'glaze', bindings: { receiver: 'tile' }, painting: { id: 'glaze-demo',
  format: K.authoring.paintings3d.format, version: 1, marks: [{ ...spot, finish }] } });
function make(finish, source = scene) {
  const editor = ink.createSceneEditor(source);
  editor.applyPainting3d(placement(finish));
  return editor;
}
const close = (a,b) => assert(Math.abs(a-b) < 1e-6, `${a} should equal ${b}`);
const patch = (editor, finish) => editor.applyPainting3d({ id: 'glaze',
  edits: [{ op: 'set', id: 'line', patch: { finish } }] }, { update: true });

test('finish paint grades existing color and separates roughness and coating from the base ramp', () => {
  const base = ink.createSceneEditor(scene).build();
  const finish = { opacity: .6, tint: { color: '#dbf1ff', strength: .75 }, hueShift: 53,
    roughness: .19, coating: { weight: .8, roughness: .14 } };
  const editor = make(finish), world = editor.build();
  assert.deepEqual(world.data, base.data);
  assert.deepEqual(world.renderMetadata.normals, base.renderMetadata.normals);
  assert.deepEqual(world.renderMetadata.materialIds, base.renderMetadata.materialIds);
  assert.deepEqual(world.paletteRoles, base.paletteRoles);
  const point = [-.34,0,.18], field = K.diorama.brushField(editor.snapshot());
  const material = field.materialAt(field.surfaceAt(...point).material, point, [0,0,1]);
  const row = material.paintFinishSample;
  assert.deepEqual(material.r, scene.style.roles.stone);
  close(Finish.roughness(row,.61), .61*.4 + .19*.6);
  const [coat, polished] = Finish.coat(row,.1,.3);
  close(coat,.1*.4+.8*.6);
  close(polished,.3*.4+.14*.6);
  const rgb = [.2,.5,.4], before = Finish.gradeLinear(row,rgb);
  assert.notDeepEqual(before,rgb);
  const result = editor.applyPainting3d({ id: 'glaze', edits: [{ op: 'set-finish', id: 'line', patch: { roughness:.87 } }] },
    { update:true });
  assert.equal(result.marks[0].finish.roughness,.87);
  assert.deepEqual(result.marks[0].finish, {...finish,roughness:.87});
  assert.deepEqual(editor.extractPainting3d('glaze').marks[0].poses,mark.poses);
  const nextField = K.diorama.brushField(editor.snapshot());
  const next = nextField.materialAt(nextField.surfaceAt(...point).material, point, [0,0,1]).paintFinishSample;
  assert.deepEqual(Finish.gradeLinear(next,rgb),before);
  assert.deepEqual(Finish.coat(next,.1,.3),[coat,polished]);
  close(Finish.roughness(next,.61), .61*.4+.87*.6);
  const frozen=editor.snapshot();
  assert.throws(() => patch(editor,{ coating:{weight:2}}), /coating needs weight/);
  assert.deepEqual(editor.snapshot(),frozen);
});

test('headless emission is local and explicit spill lights a separate receiver in legacy and PBR renders', () => {
  const emission = { color: '#ff9b35', strength: .9 };
  const plain = ink.createSceneEditor(scene).build();
  const glowing = make({ emission }).build();
  const casting = make({ emission: { ...emission, spill: { intensity: 21, radius: 2.2, lift: .64, shadows: true } } }).build();
  assert.equal(glowing.renderMetadata.paintSpills, undefined);
  assert.equal(casting.renderMetadata.paintSpills.length,1);
  assert(casting.renderSdfs.length > 0);
  assert.deepEqual(glowing.data, casting.data);
  const view = { w:165, h:116, px:1, ortho:true, raw:true, passes:['objectId','emission'] };
  const physical = { materials: { clay:{roughness:.62} }, default:'clay', lights:[{direction:[-.6,.38,.69],intensity:1.3}] };
  for (const pbrMaterials of [false, physical]) {
    const settings = { ...view, pbrMaterials };
    const [bare, glow, spill, bypass] = [plain,glowing,casting,casting].map((world,i) =>
      ink.render(world, i === 3 ? {...settings,areaLights:false}:settings));
    assert.deepEqual(bypass.rgb,glow.rgb);
    const { objectId, objects } = glow.passes, neighbor = objects.indexOf('neighbor'), tile = objects.indexOf('tile');
    let lit=0, core=0, neighborPixels=0;
    for(let i=0;i<objectId.length;i++){
      const k=i*3;
      if(objectId[i]===neighbor){
        neighborPixels++;
        assert.equal(glow.rgb[k],bare.rgb[k]);
        if(spill.rgb[k]-glow.rgb[k]>8)lit++;
      }else if(objectId[i]===tile && glow.rgb[k]-bare.rgb[k]>25)core++;
    }
    assert(neighborPixels>200 && lit>70 && core>30, `${neighborPixels} receiver pixels, ${lit} lit, ${core} in the core`);
  }
});

test('spill samples follow posed rows and survive row remapping', () => {
  const world = make({ emission:{color:'#ffbb59',spill:{intensity:8,radius:1.8}} }).build();
  const source=world.renderMetadata.paintSpills[0], indices=[...new Set(source.rows.filter((_,i)=>!(i%2)))].reverse();
  const small=Provenance.subset(world,indices);
  assert(small.renderMetadata.paintFinish.some(Boolean));
  const compact=small.renderMetadata.paintSpills[0];
  const posed=shift=>({
    x:indices.map(i=>world.data[i*16]+shift), y:indices.map(i=>world.data[i*16+1]), z:indices.map(i=>world.data[i*16+2]),
    alpha:indices.map(()=>1)
  });
  const normal=()=>[0,0,1], [a]=Finish.spillLights([compact],posed(0),normal), [b]=Finish.spillLights([compact],posed(3),normal);
  close(b.at[0]-a.at[0],3);
  close(a.intensity,b.intensity);
  assert.deepEqual(Finish.spillLights([compact],{...posed(0),alpha:[]},normal),[]);
});
