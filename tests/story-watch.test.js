const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const example = name=>path.resolve(__dirname,'../examples/story-documents/'+name+'.json');
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const events = text=>text.trim().split('\n').map(JSON.parse);
const samples = rows=>rows.filter(row=>row.type==='story-watch');
const sim = (...args)=>spawnSync(process.execPath,[cli,'sim',...args],{encoding:'utf8'});
function ok(...args) {
  const run = sim(...args);
  assert.equal(run.status,0,run.stderr);
  return run.stdout;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-watch-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return name=>path.join(dir,name);
}

test('watch files show concrete roles, changing worksite blockers, and evidence as objectives resolve', t => {
  const file = temp(t), stream = file('relief.ndjson'), source = example('sluice-relief.world');
  const story = 'sluice-relief/relief';
  const summary = JSON.parse(ok('run',source,'--actions',example('sluice-relief.actions'),'--ticks','28',
    '--watch-story',story,'--watch-out',stream));
  const rows = events(fs.readFileSync(stream,'utf8')), frames = samples(rows);
  assert.equal(rows[0].format,'ink-studio/story-watch');
  assert.deepEqual(rows[0].stories,[story]);
  assert.deepEqual(frames[0].values.roles.courier,{kind:'roster-member',source:'world',
    value:{system:'crew',agent:'courier',generation:2}});
  assert.equal(frames.filter(row=>Object.hasOwn(row.values,'roles')).length,1);
  const blocked = frames.flatMap(row=>row.values.blockers??[]).filter(row=>row.check==='build-platform');
  for (const reason of ['missing-stock','output-full'])
    assert(blocked.some(row=>row.actual.blockers.some(item=>item.reason===reason)));
  const receipts = frames.flatMap(row=>row.values.evidence?.receipts??[]);
  assert(receipts.some(row=>row.objective==='platform'&&row.receipt.kind==='event'));
  assert(frames.some(row=>row.values.stage?.outcome==='ready'));
  assert.deepEqual(rows.at(-1),{type:'story-watch-end',tick:28,summary});
});

test('watched breakpoints stream the final frame and a verified replay reproduces the same deltas', t => {
  const file = temp(t), start = file('handover.json'), recording = file('intervention.run.json');
  const story = 'breakwater-watch/dispatch', source = example('breakwater-watch.world');
  const seedRows = events(ok('run',source,'--watch-story',story,'--until-stage',story+'/plan-route','--checkpoint',start));
  assert.equal(seedRows.at(-1).summary.stop.tick,3);
  assert.equal(samples(seedRows).at(-1).values.stage.stage,'plan-route');
  const options = ['--watch-story',story,'--watch-values','choices,evidence,changes'];
  const rows = events(ok('resume',start,...options,'--actions',example('breakwater-watch.intervene.actions'),
    '--until-outcome',story+'/night-delivery','--record',recording));
  const frames = samples(rows);
  assert.equal(frames[0].tick,3);
  assert.deepEqual(frames[0].values.changes,[]);
  assert(frames.some(row=>row.tick===4&&row.values.choices?.choices.route.selectable===true));
  assert(frames.some(row=>row.tick===7&&row.values.choices?.choices.destination.selectable===true));
  assert(frames.flatMap(row=>row.values.evidence?.receipts??[]).some(row=>row.receipt.option==='night'));
  assert.equal(rows.at(-1).summary.stop.matches[0].outcome,'night-delivery');
  assert.deepEqual(samples(events(ok('replay',recording,...options))),frames);
  const baseline = file('unwatched.json');
  ok('resume',start,'--actions',example('breakwater-watch.intervene.actions'),'--ticks','12','--checkpoint',baseline);
  assert.deepEqual(read(recording).end,read(baseline));
});

test('assigned order blockers and story changes stream without retained world history', t => {
  const file = temp(t), source = read(example('quay-relay.world')), document = read(example('quay-relay'));
  source.storyDocuments = [document];
  source.history = {enabled:false};
  source.systems.crew.config.orders.tasks.load.steps.unshift({op:'move',at:{entity:'loading-pad'}});
  source.commands = [
    {tick:1,action:'world/event',args:{kind:'quay-relay-requested'}},
    {tick:5,action:'world/patch',args:{edits:[{op:'set',path:'/entities/loading-pad',value:{position:[-1,0,0]}}]}}
  ];
  const input = file('world.json');
  fs.writeFileSync(input,JSON.stringify(source));
  const rows = events(ok('run',input,'--watch-story','all','--watch-values','blockers,changes','--ticks','7'));
  const frames = samples(rows);
  assert(frames.some(row=>row.values.blockers?.some(item=>item.kind==='work'&&
    item.status==='blocked'&&item.reason==='target-missing'&&item.assignment.agent==='mira'&&item.task==='load')));
  assert(frames.some(row=>row.tick>=5&&row.values.blockers&&row.values.blockers.every(item=>item.kind!=='work')));
  assert(frames.flatMap(row=>row.values.changes??[]).some(event=>event.kind==='story-started'));
  assert.equal(rows.at(-1).summary.events,0);
});

test('watch validation rejects unsupported commands, selectors, and input aliases', t => {
  const file = temp(t), source = example('breakwater-watch.world'), story = 'breakwater-watch/dispatch';
  assert.match(sim('preflight',source,'--watch-story',story).stderr,/Use sim run, resume, fork, or replay/);
  assert.match(sim('run',source,'--watch-story','unknown/missing').stderr,/authored document\/story IDs/);
  assert.match(sim('run',source,'--watch-story',story,'--watch-values','stage,stage').stderr,/distinct names/);
  const copied = file('world.json'), document = file('breakwater-watch.json'), alias = file('alias.ndjson');
  fs.copyFileSync(source,copied);
  fs.copyFileSync(example('breakwater-watch'),document);
  const before = fs.readFileSync(document,'utf8');
  fs.symlinkSync(document,alias);
  assert.match(sim('run',copied,'--watch-story',story,'--watch-out',alias).stderr,/separate path/);
  assert.equal(fs.readFileSync(document,'utf8'),before);
});
