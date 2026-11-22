const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const example = name=>path.resolve(__dirname,'../examples/story-documents/'+name+'.json');
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sim = (...args)=>spawnSync(process.execPath,[cli,'sim',...args],{encoding:'utf8'});
function report(...args) {
  const result = sim(...args);
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-explanation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return name=>path.join(dir,name+'.json');
}

test('offer explanations use the historical trigger, live admission checks, and retained causes', t => {
  const file = temp(t), world = read(example('sluice-relief.world')), story = 'sluice-relief/relief';
  world.storyDocuments = [read(example('sluice-relief'))];
  world.causality = {limit:256};
  const source = file('world'), log = file('relief.run');
  fs.writeFileSync(source,JSON.stringify(world));
  report('run',source,'--actions',example('sluice-relief.actions'),'--ticks','24','--record',log);
  const absent = report('why-not',log,story,'--ticks','1','--offer');
  assert.equal(absent.reason,'feasibility-blocked');
  assert.equal(absent.offer.feasibility.report.checks['build-platform'].actual.blockers[0].reason,'missing-stock');
  assert.equal(absent.offer.transition,null);
  const appeared = report('why',log,story,'--ticks','6','--trace');
  assert.equal(appeared.format,'ink-studio/story-explanation');
  assert.equal(appeared.offer.transition.tick,6);
  assert.equal(appeared.reason,'trigger-matched');
  assert.equal(appeared.offer.feasibility.report.ready,true);
  const [event] = appeared.offer.source.evidence.events;
  assert(appeared.evidence.events.some(row=>row.id===event&&row.kind==='sluice-relief-requested'));
  assert(appeared.evidence.causes.some(row=>row.event===event&&row.status==='ok'&&row.value.nodes.length>=2));
  assert.equal(report('why',log,story,'--ticks','0').reason,'awaiting-trigger');
});

test('the selected actor retains role and commitment receipts while a rejected alternative has current checks', t => {
  const file = temp(t), source = example('quay-relay.world'), story = 'quay-relay/delivery', spec = file('cast');
  const saved = file('actors.checkpoint');
  fs.writeFileSync(spec,JSON.stringify({rosters:['crew'],requirements:{free:{availability:'free'}},limit:0}));
  report('run',source,'--actions',example('quay-relay.actions'),'--ticks','2','--checkpoint',saved);
  const selected = report('why',saved,story,'--role','loader','--actor','crew/mira');
  assert.equal(selected.reason,'world-binding');
  assert.equal(selected.actor.binding.value.agent,'mira');
  assert.equal(selected.actor.commitment.decision,'accepted');
  assert.equal(selected.actor.assignment.agent,'mira');
  const other = report('why-not',saved,story,'--role','loader','--actor','crew/niko','--spec',spec);
  assert.equal(other.status,'different-actor');
  assert.equal(other.actor.casting.basis,'current-snapshot');
  assert.equal(other.actor.casting.focused.checks.free.actual.state,'busy');
  assert.equal(other.actor.casting.status,'rejected');
  assert.deepEqual(other.actor.casting.candidates,[]);

  const refusedWorld = read(source), document = read(example('quay-relay'));
  refusedWorld.storyDocuments = [document];
  document.stories.delivery.lifecycle.commitment.consider = {
    pay:{when:{path:'/terms/pay',op:'gte',value:2},otherwise:'refuse'}
  };
  const refusedFile = file('refused');
  fs.writeFileSync(refusedFile,JSON.stringify(refusedWorld));
  const refused = report('why-not',refusedFile,story,'--actor','crew/mira',
    '--actions',example('quay-relay.actions'),'--ticks','1');
  assert.equal(refused.status,'refused');
  assert.equal(refused.actor.commitment.checks.find(row=>row.name==='term/pay').reason,'terms-unmet');
});

test('active and historical stage explanations show pending proof and recorded branch decisions', () => {
  const story = 'sluice-relief/relief', source = example('sluice-relief.world');
  const stuck = report('why-not',source,story,'--stage','--actions',example('sluice-relief.actions'),'--ticks','8');
  assert.equal(stuck.status,'blocked');
  assert.deepEqual(stuck.stage.blockers.find(row=>row.kind==='branch').pending,['courier','platform']);
  assert.equal(stuck.stage.evidence.current.objectives.cargo.receipt.event.applied,2);
  assert.equal(stuck.stage.pendingEvidence.courier.matches,false);
  assert.equal(stuck.stage.pendingEvidence.platform.event.kind,'work-completed');
  const advanced = report('why',source,story,'--stage','deliver','--actions',example('sluice-relief.actions'),'--ticks','24');
  assert.equal(advanced.status,'advanced');
  assert.equal(advanced.stage.lastVisit.target.outcome,'ready');
});

test('ending explanations identify the actual fallback and the authored route that could still reach the expected ending', () => {
  const source = example('breakwater-watch.world'), story = 'breakwater-watch/dispatch';
  const alternate = report('why-not',source,story,'--ticks','14','--outcome','night-delivery');
  assert.equal(alternate.status,'different-ending');
  assert.equal(alternate.outcome.actual,'standard-delivery');
  assert.equal(alternate.outcome.divergence.visit.branch,'ship');
  assert.equal(alternate.outcome.divergence.visit.decision.by,'fallback');
  assert.equal(alternate.outcome.divergence.alternatives[0].branch,'review');
  const reached = report('why',source,story,'--actions',example('breakwater-watch.intervene.actions'),
    '--ticks','14','--outcome','night-delivery');
  assert.equal(reached.status,'reached');
  assert.equal(reached.outcome.closingVisit.objectives.destination.receipt.option,'night');
  assert.equal(reached.outcome.settlements.outcome.status,'applied');
});

test('scheduler explanations preserve recorded draws and label the next-tick projection', () => {
  const source = example('glass-coast.world');
  const held = report('why-not',source,'glass-coast/breakwater-collapse','--storyteller','generous','--ticks','1');
  assert.equal(held.status,'waiting');
  assert.equal(held.offer.forecast.tick,2);
  assert.equal(held.offer.forecast.basis,'published-state');
  assert(held.offer.forecast.candidate.automatic.blockers.some(row=>row.code==='challenge'));
  assert.equal(held.offer.previousDraw.tick,1);
  const winner = report('why',source,held.offer.previousDraw.winner,'--storyteller','generous','--ticks','1');
  assert.equal(winner.reason,'candidate-dispatched');
  assert.deepEqual(winner.offer.candidate.selection,held.offer.previousDraw);
  assert.match(sim('why',source,'glass-coast/breakwater-collapse','--offer','--stage').stderr,/sim why\|why-not/);
});
