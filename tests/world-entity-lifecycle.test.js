const test = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const { KIT: { world: W } } = studio.load();
const json = value => JSON.parse(JSON.stringify(value));
const door = { origin: [0, .6, 0], normal: [0, 0, 1] };
const arrival = { origin: [6, .6, 4], normal: [1, 0, 0] };
const link = { id: 'to-workshop', from: { place: 'yard', anchor: 'door' },
  to: { place: 'shop', anchor: 'door' }, aperture: { halfWidth: 1.2, halfHeight: 1.4 } };
const previous = [0, .6, .25], end = [0, .6, -.25];
const vis = { bounds: { min: [-2, 0, -2], max: [9, 2.5, 7] }, resolution: .18 };
const group = (id = 'lantern', place = 'yard') => ({
  id, place, state: { charge: 32, marks: ['amber'] },
  entities: {
    [id]: { position: previous, sockets: { rim: [0, .36, 0] },
      visual: { half: [.26, .22, .16], ramp: [19, 20, 21, 22, 23] } },
    [id + '-flag']: { anchor: { entity: id, socket: 'rim' }, position: [.45, 0, 0],
      visual: { half: [.22, .08, .06], ramp: [2, 3, 4, 5, 6] } }
  }
});
const pose = (asset, entity) => asset.query().frame({ entity });
const sessionFor = ({ staticYard = {}, staticShop = {}, allow = () => true, visual } = {}) => W.portals.create({
  lifecycle: true, links: [link],
  places: [
    W.simulationPlace({ id: 'yard', anchors: { door }, source: { entities: staticYard, visual: vis }, visual }),
    W.simulationPlace({ id: 'shop', anchors: { door: arrival }, source: { entities: staticShop, visual: vis },
      canArrive: allow, visual })
  ]
});
const equalPoint = (actual, expected) => assert.ok(actual?.every((n,i) => Math.abs(n - expected[i]) < 1e-9),
  JSON.stringify({actual,expected}));

test('one native group spawns, unloads and crosses with its attachment, then restores beside an unloaded group', async () => {
  const session = sessionFor();
  const source = (await session.enter('yard')).asset, life = session.lifecycle;
  const handle = life.spawn(group());
  assert.equal(handle.generation, 1);
  equalPoint(pose(source, 'lantern-flag').point, [.45, .96, .25]);
  assert.ok(source.world);
  const firstQuery = source.query(), firstWorld = source.world;
  life.update(handle, { state: { charge: 17, marks: ['amber', 'salt'] } });
  assert.equal(source.query(), firstQuery);
  assert.equal(source.world, firstWorld);
  life.unload(handle);
  assert.equal(pose(source, 'lantern-flag'), null);
  assert.equal(life.get('lantern').state.charge, 17);
  life.restoreEntity(handle);
  assert.deepEqual(life.actor(handle).entityHandle, handle);
  const asleep = life.spawn(group('spare'));
  life.unload(asleep);
  const destination = await session.prepare(link.id);
  assert.equal(pose(destination, 'lantern'), null);
  const actor = life.actor(handle, { position: end, velocity: [0, 0, -1] });
  const checked = session.checkArrival(link.id, { previous, actor });
  assert.equal(checked.status, 'ready');
  assert.deepEqual(checked.entity, handle);
  assert.equal(life.get('lantern').place, 'yard');
  assert.equal(checked.commitEntity, undefined);

  let observed;
  session.onCross(result => {
    observed = [result.sourceDisposition, !!pose(result.source.asset, 'lantern'), !!pose(result.place.asset, 'lantern')];
  });
  const crossing = await session.cross(link.id, { previous, actor });
  assert.deepEqual(observed, ['released', false, true]);
  assert.deepEqual(crossing.entity, handle);
  equalPoint(pose(destination, 'lantern').point, [6.25, .6, 4]);
  equalPoint(pose(destination, 'lantern-flag').point, [6.25, .96, 4.45]);
  equalPoint(crossing.actor.velocity, [1, 0, 0]);
  assert.equal(life.get('lantern').state.charge, 17);

  const saved = json(session.checkpoint()), restored = sessionFor();
  await restored.restore(saved);
  assert.deepEqual(json(restored.checkpoint()), saved);
  assert.deepEqual(restored.lifecycle.actor(handle).entityHandle, handle);
  equalPoint(pose(restored.current().asset, 'lantern-flag').point, [6.25, .96, 4.45]);
  assert.equal(restored.lifecycle.get('spare').loaded, false);
  await restored.enter('yard');
  assert.equal(pose(restored.current().asset, 'spare'), null);
  restored.lifecycle.restoreEntity(asleep);
  equalPoint(pose(restored.current().asset, 'spare-flag').point, [.45, .96, .25]);
  assert.equal(pose(restored.current().asset, 'lantern'), null);
});

test('destination collision and clearance checks leave the whole group at its source', async () => {
  let clear = true;
  const session = sessionFor({ staticShop: { 'lantern-flag': { position: [8, 1, 5] } },
    allow: () => clear, visual: false });
  await session.enter('yard');
  const life = session.lifecycle, handle = life.spawn(group()), actor = life.actor(handle, { position: end });
  const destination = await session.prepare(link.id);
  assert.equal(session.checkArrival(link.id, { previous, actor }).entityBlocker.reason, 'occupied-entity');
  const saved = json(life.checkpoint());
  assert.equal(await session.cross(link.id, { previous, actor }), null);
  assert.deepEqual(json(life.checkpoint()), saved);
  assert.equal(session.current().id, 'yard');
  assert.equal(pose(destination, 'lantern'), null);
  clear = false;
  const other = life.spawn(group('lamp'));
  const second = life.actor(other, { position: end });
  assert.equal(await session.cross(link.id, { previous, actor: second }), null);
  assert.equal(life.get('lamp').place, 'yard');
  clear = true;
  assert.equal((await session.cross(link.id, { previous, actor: second })).place.id, 'shop');
});

test('occupied and stale IDs cannot change a lifetime, including through native patches', async () => {
  const session = sessionFor({ staticYard: { authored: {} }, visual: false });
  const {asset} = await session.enter('yard'), life = session.lifecycle, handle = life.spawn(group());
  assert.throws(() => life.spawn(group('authored')), /collides with authored/);
  assert.throws(() => life.spawn(group('lantern', 'shop')), /must be unique/);
  assert.throws(() => life.spawn({ id:'root',place:'yard',entities:{root:{},other:{}} }), /one rooted group/);
  life.unload(handle);
  const before = json(asset.checkpoint().checkpoint.world);
  asset.schedule([{tick:1,action:'world/patch',args:{edits:[{op:'set',path:'/entities/lantern',value:{}}]}}]);
  assert.throws(() => session.step(.05), /collides with authored/);
  assert.deepEqual(json(asset.checkpoint().checkpoint.world), before);
  assert.equal(session.place('yard').time, 0);
  life.despawn(handle);
  const replacement = life.spawn(group());
  assert.notEqual(replacement.generation, handle.generation);
  assert.throws(() => life.restoreEntity(handle), /stale entity/);
  await session.prepare(link.id);
  const stale = {...life.actor(replacement,{position:end}),entityHandle:handle};
  assert.equal(session.checkArrival(link.id, {previous,actor:stale}).entityBlocker.reason, 'stale-entity');
});

test('failed checkpoints and restore preparation never publish a staged group', async () => {
  let sourceWritable = false, rejectRestore = false, observed;
  function make(){
    return W.portals.create({ lifecycle: true, links: [link], places: [
      {id:'yard',anchors:{door},prepare:({lifecycle})=>({
        checkpoint(){ if(!sourceWritable)throw Error('source could not save'); return {scratch:3}; },
        scene:lifecycle.scene
      })},
      {id:'shop',anchors:{door:arrival},prepare:({lifecycle,reason})=>{
        if(reason==='restore'){
          observed=lifecycle.get('lantern');
          if(rejectRestore)throw Error('destination restore failed');
        }
        return {scene:lifecycle.scene};
      }}
    ]});
  }
  const session = make();
  await session.enter('yard');
  const handle = session.lifecycle.spawn(group()), actor = session.lifecycle.actor(handle, {position:end});
  await assert.rejects(session.cross(link.id, {previous,actor}), /source could not save/);
  assert.equal(session.lifecycle.get('lantern').place, 'yard');
  sourceWritable=true;
  assert.equal((await session.cross(link.id, {previous,actor})).place.id, 'shop');
  const saved = json(session.checkpoint()), restored = make();
  rejectRestore=true;
  await assert.rejects(restored.restore(saved), /destination restore failed/);
  assert.equal(observed.place, 'shop');
  assert.equal(restored.current(), null);
  assert.equal(restored.lifecycle.get('lantern'), null);
  rejectRestore=false;
  await restored.restore(saved);
  assert.equal(restored.lifecycle.get('lantern').place, 'shop');
  assert.ok(restored.current().asset.scene().entities.lantern);
  restored.lifecycle.unload(handle);
  assert.equal(restored.current().asset.scene().entities.lantern, undefined);
});
