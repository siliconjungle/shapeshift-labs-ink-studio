const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const R = load().KIT.world.runtime;
const fixtures = path.resolve(__dirname,'../examples/story-documents');
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const read = name=>JSON.parse(fs.readFileSync(path.join(fixtures,name+'.json'),'utf8'));
const copy = value=>JSON.parse(JSON.stringify(value));
const source = name=>embedStoryDocuments(read(name+'.world'),path.join(fixtures,name+'.world.json'));
const inspect = (run,incident)=>run.query().probe('world/scheduler',undefined,incident?{incident}:{}).value;
const candidate = (report,key)=>report.candidates.find(row=>row.candidate===key);
const automatic = report=>report.forecast.automatic.map(row=>row.candidate);
const contains = (row,code)=>row.automatic.blockers.some(item=>item.code===code);

test('pressure remedies identify holders and distinguish recorded and projected readiness',()=>{
  const run = R.create(source('pressure-shifts'));
  const ridge = 'pressure-shifts/ridge-watch', mediation = 'pressure-shifts/mediation';
  run.advance(2);
  const before = run.checkpoint(), report = inspect(run);
  assert.equal(report.forecast.tick,3);
  assert.deepEqual(report.forecast.manual,[]);
  assert.deepEqual(automatic(report),[]);
  assert.deepEqual(report.commitments.stories.map(row=>row.story),['pressure-shifts/rescue-shift','pressure-shifts/supply-shift']);
  assert.deepEqual(candidate(report,ridge).admission.find(row=>row.dimension==='danger'),
    {code:'pressure-capacity',dimension:'danger',requested:1,remaining:0,limit:2,additionalNeeded:1,fitsLimit:true,
      heldBy:['pressure-shifts/rescue-shift']});
  assert.deepEqual(run.checkpoint(),before);
  run.advance(3);
  const after = inspect(run);
  assert.equal(candidate(after,mediation).observed.status,'blocked');
  assert.equal(candidate(after,mediation).status,'would-dispatch');
  assert.deepEqual(automatic(after),[mediation]);
  assert.equal(after.commitments.capacity.commitments.remaining,1);
  const focused = inspect(run,ridge);
  assert.equal(focused.candidates.length,1);
  assert.deepEqual(focused.forecast,after.forecast);
  const resumed = R.create(run.checkpoint().world,{checkpoint:copy(run.checkpoint())});
  assert.deepEqual(inspect(resumed),after);
  run.advance(4);
  assert.equal(inspect(run).actual[0].candidate,mediation);
});

test('the exact weighted projection identifies the winner and the alternative held by the draw',()=>{
  const world = source('pressure-shifts');
  world.incidentPressure.limits.danger = 3;
  const run = R.create(world);
  run.advance(3);
  const report = inspect(run), [winner] = automatic(report);
  const loser = ['pressure-shifts/mediation','pressure-shifts/ridge-watch'].find(key=>key!==winner);
  const entry = candidate(report,loser);
  assert.equal(entry.manual.eligible,true);
  const draw = entry.automatic.blockers.find(row=>row.code==='weighted-selection');
  assert.equal(draw.winner,winner);
  assert.equal(draw.pool,'crossing-response');
  run.advance(4);
  assert.equal(inspect(run).actual[0].candidate,winner);
});

test('anchor reservations, conditions, cooldowns and variety expose their release requirements',()=>{
  const tide = R.create(source('tide-calendar'));
  tide.schedule(read('tide-calendar.early-signal.actions'));
  tide.advance(4);
  const blocked = inspect(tide);
  assert.deepEqual(blocked.forecast.hold,{code:'anchor-reservation',candidate:'tide-calendar/tide-bell',opensAt:6});
  assert(contains(candidate(blocked,'tide-calendar/equipment-check'),'anchor-reservation'));
  assert.equal(candidate(blocked,'tide-calendar/beacon-signal').admission[0].requires.args.account,'stock/signal');
  tide.advance(5);
  assert.deepEqual(automatic(inspect(tide)),['tide-calendar/tide-bell']);
  tide.advance(7);
  assert.deepEqual(automatic(inspect(tide)),[]);
  tide.advance(8);
  assert.equal(inspect(tide).actual[0].candidate,'tide-calendar/beacon-signal');

  const harbor = R.create(source('harbor-recovery'));
  harbor.advance(3);
  const pier = candidate(inspect(harbor),'harbor-recovery/pier-survey');
  assert.equal(pier.admission[0].opensAt,7);
  assert.equal(pier.admission[0].windows[0].source,'harbor-recovery/flood');

  const rotation = R.create(source('harbor-rotation'));
  rotation.advance(2);
  const market = inspect(rotation);
  assert.deepEqual(automatic(market),['harbor-rotation/f-night-market']);
  const repeat = candidate(market,'harbor-rotation/b-bridge-bell').automatic.blockers[0];
  assert.equal(repeat.code,'variety-preference');
  assert.deepEqual(repeat.repeated.situation,['harbor-rotation/a-bank-call']);
});

test('a stable state trigger can mature in the preview and an expiring anchor exposes its last check',()=>{
  const world = source('tide-calendar');
  world.storyDocuments[0].stories['equipment-check'].triggers = {power:{state:{
    field:'world/account',args:{account:'stock/bell-power'},when:{path:'/balance',value:1}
  },hold:0.2}};
  const run = R.create(world);
  run.advance(1);
  const id = 'tide-calendar/equipment-check', entry = candidate(inspect(run),id);
  assert.equal(entry.observed.status,'not-queued');
  assert.equal(entry.queue.queuedAt,2);
  assert.equal(entry.manual.eligible,true);
  run.advance(2);
  assert.equal(candidate(inspect(run),id).observed.status,'ready');

  const missed = R.create(source('tide-calendar'));
  missed.schedule(read('tide-calendar.missed-bell.actions'));
  missed.advance(6);
  const report = inspect(missed), bell = candidate(report,'tide-calendar/tide-bell');
  assert.equal(bell.status,'expiring');
  assert.equal(bell.decision.reason,'anchor-window-missed');
  assert.equal(bell.decision.lastChecks.feasibility.checks['bell-powered'].reason,'condition-mismatch');
  assert.equal(bell.decision.followUp.incident,'tide-calendar/quiet-notice');
  assert.deepEqual(candidate(report,'tide-calendar/quiet-notice').queue.origin,{kind:'follow-up',incident:'tide-calendar/tide-bell'});
});

test('actor commitments expose the live order and follow accepted handoffs',()=>{
  const run = R.create(source('quay-relay'));
  run.schedule(read('quay-relay.actions'));
  run.advance(7);
  const [before] = inspect(run).commitments.stories;
  assert.equal(before.assignment.agent,'mira');
  assert.equal(before.order.status,'active');
  assert.equal(before.order.task,'load');
  assert.equal(before.handoff.decision,'deferred');
  run.advance(8);
  const [after] = inspect(run).commitments.stories;
  assert.equal(after.assignment.agent,'niko');
  assert.equal(after.order.task,'finish');
  assert.equal(after.handoff,undefined);
  assert.deepEqual(inspect(run).candidates,[]);
});

test('the CLI rewinds portable recordings and emits the same focused report without editing them',()=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-scheduler-test-'));
  try {
    const run = R.create(source('pressure-shifts'));
    run.advance(3);
    const expected = inspect(run,'pressure-shifts/ridge-watch');
    run.advance(10);
    const file = path.join(directory,'recording.json'), raw = JSON.stringify(run.recording());
    fs.writeFileSync(file,raw);
    const output = execFileSync(process.execPath,[cli,'sim','scheduler',file,'--ticks','3','--incident','pressure-shifts/ridge-watch'],
      {encoding:'utf8'});
    assert.deepEqual(JSON.parse(output),expected);
    assert.equal(fs.readFileSync(file,'utf8'),raw);
    const empty = R.create({id:'no-queue'});
    assert.deepEqual(inspect(empty).candidates,[]);
    assert.equal(empty.query().probe('world/scheduler',undefined,{incident:'unknown/story'}).status,'missing');
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
