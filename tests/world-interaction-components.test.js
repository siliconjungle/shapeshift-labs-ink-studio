const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: { world: W } } = require('..').load();
const I = W.interactions, C = I.components;
const json = value => JSON.parse(JSON.stringify(value));
const actor = (id, position, generation = 1) => ({ id, position, generation });
const nearOrigin = actor('surveyor', [0, 0, 0]);
const nearPanel = actor('surveyor', [3, 0, 0]);
const createScene = () => W.runtime.create({
  entities: { pedestal: { position: [3, 0, 0], sockets: { dock: [0, 0, 0], crank: [0, 0, 0] } } }
});
function panel(extra = {}) {
  return C.compose({ id: 'sluice', components: {
    approach: C.trigger({ bounds: { min: [-.5, -.5, -.5], max: [.5, .5, .5] } }),
    marker: C.checkpoint({ at: [0, 0, 0] }),
    crank: C.handle({ at: { entity: 'pedestal', socket: 'crank' }, range: .7 }),
    cell: C.pickup({ at: [0, 0, 0], range: .8 }),
    mount: C.socket({ at: { entity: 'pedestal', socket: 'dock' }, accepts: ['cell'], range: .7 }),
    gate: C.timedSwitch({ ticks: 4, when: { path: '/states/crank/value', op: 'gte', value: .5 } }),
    signal: C.timedSwitch({ ticks: 2 })
  }, routes: [
    { from: 'approach/sample', to: 'marker/activate', when: { path: '/detail/inside', value: true } },
    { from: 'mount/insert', to: 'gate/press' }
  ], ...extra });
}
function open(assembly, scene, prepare) {
  return I.create({ id: 'station', interactables: [assembly], realize(next) {
    prepare?.(next);
    return { query: scene.query };
  } });
}
const states = run => run.current().states.sluice;
const dispatch = (run, action, source = nearOrigin, args) => run.dispatch('sluice', action, { actor: source, args });

test('triggers, handles, pickups and sockets compose with one published revision', async () => {
  const assembly = panel(), scene = createScene(), publications = [];
  let fault = false;
  const run = open(assembly, scene, next => {
    if (fault && next.event?.action === 'mount/insert') throw Error('world realization failed');
    publications.push(next.sequence);
  });
  await run.restore();
  const entered = await dispatch(run, 'approach/sample');
  assert.deepEqual(entered.event.detail.changes.map(row => row.cue), ['trigger-entered', 'checkpoint-activated']);
  assert.equal(await dispatch(run, 'approach/sample'), null);
  assert.deepEqual(states(run).marker.actors['surveyor@1'].point, [0, 0, 0]);
  assert.equal((await dispatch(run, 'approach/sample', nearPanel)).event.cue, 'trigger-left');
  assert.equal(await dispatch(run, 'cell/take', nearPanel), null);
  await dispatch(run, 'cell/take');
  assert.equal(assembly.frame('cell', run.current()), null);
  assert.equal(await dispatch(run, 'mount/insert', actor('visitor', [3, 0, 0]), { item: 'cell' }), null);
  const beforeGuard = run.checkpoint();
  assert.equal(await dispatch(run, 'mount/insert', nearPanel, { item: 'cell' }), null);
  assert.equal(run.checkpoint(), beforeGuard);

  await dispatch(run, 'crank/grab', nearPanel);
  assert.equal(await dispatch(run, 'crank/move', actor('surveyor', [3, 0, 0], 2), { value: .8 }), null);
  assert.equal(await dispatch(run, 'crank/move', nearOrigin, { value: .8 }), null);
  await dispatch(run, 'crank/move', nearPanel, { value: .8 });
  await dispatch(run, 'crank/release');
  assert.equal(states(run).crank.holder, null);
  fault = true;
  const previous = run.checkpoint();
  await assert.rejects(dispatch(run, 'mount/insert', nearPanel, { item: 'cell' }), /realization failed/);
  assert.equal(run.checkpoint(), previous);
  fault = false;

  const inserted = await dispatch(run, 'mount/insert', nearPanel, { item: 'cell' });
  assert.equal(inserted.snapshot.sequence, previous.sequence + 1);
  assert.deepEqual(inserted.event.point, [3, 0, 0]);
  assert.deepEqual(inserted.event.detail.changes.map(row => row.cue), ['socket-inserted', 'switch-on']);
  assert.deepEqual(states(run).cell, { mode: 'docked', socket: 'mount' });
  assert.equal(states(run).mount.item, 'cell');
  assert.equal(states(run).gate.active, true);
  assert.equal(publications.filter(n => n === inserted.snapshot.sequence).length, 1);
  assert.deepEqual(assembly.frame('cell', run.current()).point, [3, 0, 0]);
  scene.schedule([{tick:1,action:'world/patch',args:{edits:[{op:'set',path:'/entities/pedestal/position',value:[4,0,0]}]}}]);
  scene.step();
  assert.deepEqual(assembly.frame('cell', run.current()).point, [4, 0, 0]);
  assert.equal(await dispatch(run, 'mount/remove', nearPanel), null);

  const moved = actor('surveyor', [4, 0, 0]);
  await dispatch(run, 'mount/remove', moved);
  await dispatch(run, 'cell/drop', moved);
  assert.deepEqual(assembly.frame('cell', run.current()).point, [4, 0, 0]);
  assert.equal(states(run).mount.item, null);
  assert.equal((await dispatch(run, 'marker/respawn', moved)).event.detail.changes[0].detail.tick, 0);
  assert.equal(await dispatch(run, 'marker/respawn', actor('surveyor', [4, 0, 0], 2)), null);
});

test('save and restore retain independent timers and checkpoint locations before expiration', async () => {
  const assembly = panel(), scene = createScene(), run = open(assembly, scene);
  await run.restore();
  await dispatch(run, 'approach/sample');
  await dispatch(run, 'crank/grab', nearPanel);
  await dispatch(run, 'crank/move', nearPanel, { value: 1 });
  await dispatch(run, 'cell/take');
  await dispatch(run, 'mount/insert', nearPanel, { item: 'cell' });
  await run.advance(1);
  await dispatch(run, 'signal/press');
  const saved = json(run.checkpoint());
  assert.deepEqual(saved.timers.map(timer => [timer.id, timer.at]), [['signal/reset', 3], ['gate/reset', 4]]);
  const restored = open(assembly, scene);
  let heard = 0;
  restored.onEvent(() => heard++);
  await restored.restore(saved);
  assert.equal(heard, 0);
  assert.equal(await dispatch(restored, 'gate/reset', nearPanel), null);
  await dispatch(restored, 'crank/move', nearPanel, { value: 0 });
  await dispatch(run, 'crank/move', nearPanel, { value: 0 });
  for (const controller of [run, restored]) {
    const signal = await controller.advance(3);
    assert.deepEqual(signal.outcomes.map(row => row.event.action), ['signal/reset']);
    assert.equal(states(controller).gate.active, true);
    const gate = await controller.advance(4);
    assert.deepEqual(gate.outcomes.map(row => row.event.action), ['gate/reset']);
    assert.equal(states(controller).gate.active, false);
  }
  assert.deepEqual(json(restored.checkpoint()), json(run.checkpoint()));
  assert.deepEqual(states(restored).marker.actors['surveyor@1'].point, [0, 0, 0]);
  saved.states.sluice.cell = { mode: 'world', point: null };
  await assert.rejects(open(assembly, scene).restore(saved), /Invalid interactable state/);
});

test('assemblies validate routes and keep shared component definitions independent', async () => {
  const source = { id: 'workbench', components: {
    control: C.timedSwitch({ ticks: 5 }),
    blocked: C.handle({ at: [3, 0, 0] })
  } };
  assert.throws(() => C.compose({ ...source, routes: [
    { from: 'control/press', to: 'blocked/grab' }, { from: 'blocked/grab', to: 'control/press' }
  ] }), /route cycle/);
  assert.throws(() => C.compose({ ...source, routes: [{ from: 'control/reset', to: 'blocked/grab' }] }), /route/);
  const left = C.compose({ ...source, routes: [{ from: 'control/press', to: 'blocked/grab', required: false }] });
  const right = C.compose(source);
  const create = assembly => I.create({ interactables: [assembly], realize: value => value.states });
  const a = create(left), b = create(right);
  await Promise.all([a.restore(), b.restore()]);
  const result = await a.dispatch('workbench', 'control/press', { actor: nearOrigin });
  assert.deepEqual(result.event.detail.changes.map(change => change.component), ['control']);
  assert.equal(a.current().states.workbench.control.active, true);
  assert.equal(b.current().states.workbench.control.active, false);
});

test('concurrent pickups award the item to the first eligible actor', async () => {
  const run = open(panel(), createScene());
  await run.restore();
  const [selected, other] = await Promise.all([
    dispatch(run, 'cell/take', nearOrigin), dispatch(run, 'cell/take', actor('visitor', [0, 0, 0]))
  ]);
  assert.ok(selected);
  assert.equal(other, null);
  assert.deepEqual(states(run).cell.owner, { id: 'surveyor', generation: 1 });
});
