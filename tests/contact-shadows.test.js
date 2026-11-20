const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT: K, makeBuilder, makeSculpt } = ink.load();

const floor = { include: [{ object: 'floor' }] };
const columns = { include: [{ tag: 'column' }] };
const settings = { reach: .53, strength: .82, cast: columns, receive: floor };
const view = { w: 81, h: 65, px: 1, raw: true, passes: ['objectId', 'position', 'depth', 'coverage'] };

function fixture({ transparent = false, patterned = false, lift = 0, look = {}, ortho = true, sdf = false } = {}) {
  const B = makeBuilder(11, [0x2c3f51, 0x77706a, 0xbbaa8f, 0xe5d5b6, 0x624b45]);
  if (sdf) {
    const S = K.sculpt(makeSculpt(B));
    S.keepRenderSdf = true;
    S.box([0,-.16,0],[1.4,.16,1.4],{ r:[1,2,3] },{ res:.19, objectId:'floor' });
    S.bake();
  } else for (let z = -10; z <= 10; z++) for (let x = -10; x <= 10; x++) {
    if (patterned) B.pixNext([1,2,3], .58, null, 0, 1, 0);
    B.disc(x*.13, 0, z*.13, [0,1,0], .107, .012, B.P[2], 1.8);
  }
  const start = B.count();
  B.describeSplats(0, start, { object: 'floor', material: 'stone' });
  for (const x of [-.17, 0, .17]) for (const y of [.09, .23, .37]) {
    B.disc(x, y+lift, 0, [0,0,1], .145, .01, B.P[4], transparent ? .45 : 1.6);
  }
  B.describeSplats(start, B.count(), { object:'crate', material:'wood', target:{ tags:['column'] } });
  return B.finish({ cam:{ target:[0, .05, 0], yaw: .04, pitch:.61, dist:5.7, ortho },
    radius: 4, dither: 0, look: { splatCoverage:'continuous', ...(patterned && { pixel:true }), ...look } });
}

function compare(before, after) {
  const { objects, objectId, position } = before.passes, floorId = objects.indexOf('floor');
  let changed = 0, strongest = 0, remote = 0;
  for (let p = 0; p < objectId.length; p++) {
    const offset = p*3, darkening = before.rgb[offset] - after.rgb[offset];
    if (!darkening) continue;
    assert(darkening > 0);
    assert.equal(objectId[p], floorId);
    const [x, y, z] = position.subarray(offset, offset+3);
    changed++;
    strongest = Math.max(strongest, darkening);
    remote += Number(Math.abs(x) > .82 || Math.abs(z) > .55 || Math.abs(y) > .002);
  }
  return { changed, strongest, remote };
}

test('near-field shadows darken only the masked receiver without changing its depth or coverage', () => {
  for (const ortho of [false, true]) {
    const world = fixture({ ortho, look:{ contactShadows:settings } });
    const off = ink.render(world, { ...view, contactShadows:false }), on = ink.render(world, view);
    const { changed, strongest, remote } = compare(off,on);
    assert(changed > 10);
    assert(strongest > 20);
    assert.equal(remote, 0);
    assert.deepEqual(on.passes.depth, off.passes.depth);
    assert.deepEqual(on.passes.coverage, off.passes.coverage);
    assert.deepEqual(ink.render(world, { ...view, contactShadows:{ ...settings, strength:0 } }).rgb, off.rgb);
    assert.deepEqual(ink.render(world, { ...view, contactShadows:{ ...settings, cast:{ include:[] } } }).rgb, off.rgb);
    const short = ink.render(world, { ...view, contactShadows:{ ...settings, reach:.22 } });
    assert(compare(off,short).changed < changed);
  }
});

test('clear coats cast no shadow and a caster lifted beyond reach releases its contact', () => {
  for (const world of [fixture({ transparent:true }), fixture({ lift:.68 })]) {
    const off = ink.render(world, { ...view, contactShadows:false }), on = ink.render(world, { ...view, contactShadows:settings });
    assert.deepEqual(on.rgb, off.rgb);
  }
});

test('contact shading survives the palette and per-pixel material redraw', () => {
  const world = fixture({ patterned:true });
  const off = ink.render(world, { ...view, raw:false, contactShadows:false });
  const on = ink.render(world, { ...view, raw:false, contactShadows:settings });
  assert(compare(off,on).changed > 5);
  assert.deepEqual(on.passes.objectId, off.passes.objectId);
});

test('an SDF-assisted floor still receives a local shadow from splat casters', () => {
  const world = fixture({ sdf: true });
  const options = { ...view, sdfAssist: { rules:[{ select:{ object:'floor' } }] } };
  const off = ink.render(world, { ...options, contactShadows:false });
  const on = ink.render(world, { ...options, contactShadows:settings });
  assert(compare(off,on).strongest > 20);
  assert.deepEqual(on.passes.depth, off.passes.depth);
  assert.deepEqual(on.passes.coverage, off.passes.coverage);
});

test('JSON dioramas validate the opt-in and keep the authored cast and receive masks', () => {
  const spec = { id:'contact-test', finish:{ look:{ contactShadows:settings } },
    solids:[{ id:'floor', kind:'box', at:[0,-.2,0], half:[1,.2,1], mat:'stone' }] };
  assert.deepEqual(K.diorama.build(spec).look.contactShadows, settings);
  assert.throws(() => K.diorama.build({ ...spec, finish:{ look:{ contactShadows:{ reach:-1 } } } }), /finish\.look\.contactShadows/s);
});
