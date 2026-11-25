'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const B = require('./modeling-benchmark.js');
const files = require('./asset-files.js');

const criteria = {
  brief:{label:'Brief fulfillment',low:'Requested change is missing',high:'Requested change reads clearly in every view'},
  craft:{label:'Native-pixel craft',low:'Distracting breaks, jagged edges, or paint damage',high:'Clean contours, clusters, and surface detail'},
  continuity:{label:'View and pose continuity',low:'Detail or shape breaks across views',high:'Shape, attachments, and paint hold across views'}
};

const rating = value => Number.isSafeInteger(value) && value >= 1 && value <= 5;

function shuffle(rows) {
  const order = rows.slice();
  for (let i=order.length-1;i>0;i--) {
    const j = randomInt(i+1);
    [order[i],order[j]] = [order[j],order[i]];
  }
  return order;
}

function reads(directories) {
  B.check(Array.isArray(directories) && directories.length >= 1 && directories.length <= 64 &&
    directories.every(directory => B.text(directory,4096)),'supply 1–64 finished run directories');
  const rows = directories.map(directory => ({directory,run:B.resultAt(directory)}));
  B.check(new Set(rows.map(({run}) => run.runId)).size === rows.length,'a run can appear only once');
  return rows;
}

function group(rows, keyOf) {
  const sets = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!sets.has(key)) sets.set(key,[]);
    sets.get(key).push(row);
  }
  return sets;
}

function matched(rows) {
  const sample = rows[0].run;
  return rows.every(({run}) => run.startRevision === sample.startRevision &&
    run.views.every((view,i) => view.beforeSha256 === sample.views[i].beforeSha256));
}

function frame(directory, view, side) {
  const bytes = fs.readFileSync(path.join(directory,'result','review','views',view.id,side+'.png'));
  B.check(B.sha256(bytes) === view[side+'Sha256'],'a native review image changed after submission');
  return bytes;
}

async function build(directories, output, { seats = 3 } = {}) {
  B.check(Number.isSafeInteger(seats) && seats >= 1 && seats <= 12,'choose 1–12 review seats');
  const groups = [...group(reads(directories),({run}) => run.task)];
  B.check(groups.every(([,rows]) => rows.length <= 8 && matched(rows)),
    'each task needs one starting revision, identical baseline frames and at most eight candidates');
  const session = randomUUID(), template = fs.readFileSync(path.join(__dirname,'modeling-benchmark-ballot.html'),'utf8');
  return B.publish(output,stage => {
    const publicDir = path.join(stage,'reviewers'), artDir = path.join(publicDir,'frames');
    fs.mkdirSync(artDir,{recursive:true});
    const ordered = groups.map(([task,rows]) => {
      const {title,brief,review,views} = B.tasks[task];
      const writeFrame = bytes => {
        const name = randomUUID()+'.png';
        files.write(path.join(artDir,name),bytes);
        return 'frames/'+name;
      };
      const baseline = rows[0].run.views.map(view => writeFrame(frame(rows[0].directory,view,'before')));
      const candidates = shuffle(rows).map(({directory,run}) => ({
        runId:run.runId, images:run.views.map(view => writeFrame(frame(directory,view,'after')))
      }));
      return {task,title,brief,review,views:views.map(view => view.id),baseline,candidates};
    });
    const key = {format:B.formats['review-key'],version:1,session,seats:[]};
    for (let seatIndex=0;seatIndex<seats;seatIndex++) {
      const seat = randomUUID(), assignments = [];
      const tasks = shuffle(ordered).map(({task,candidates,...publicTask}) => {
        const rotation = seatIndex % candidates.length;
        const cards = [...candidates.slice(rotation),...candidates.slice(0,rotation)].map(({runId,images}) => {
          const code = randomUUID();
          assignments.push({code,runId,task});
          return {code,images};
        });
        return {...publicTask,cards};
      });
      const model = {format:B.formats.ballot,version:1,session,seat,criteria,tasks,grid:B.grid};
      key.seats.push({seat,assignments});
      const html = template.replace('/* MODEL */ {}',() => JSON.stringify(model).replace(/</g,'\\u003c'));
      fs.writeFileSync(path.join(publicDir,seat+'.html'),html);
    }
    fs.writeFileSync(path.join(stage,'review-key.json'),JSON.stringify(key,null,2)+'\n',{mode:0o600});
    return {session,reviewers:key.seats.map(({seat}) => 'reviewers/'+seat+'.html'), key:'review-key.json'};
  });
}

function summarize(key, ballots) {
  B.check(B.valid(key,'review-key') && B.token(key.session) && Array.isArray(key.seats) &&
    key.seats.length >= 1 && key.seats.length <= 12,'use the private blind review key');
  const assignments = new Map(), tallies = new Map();
  let coverage;
  for (const row of key.seats) {
    B.check(B.token(row?.seat) && !assignments.has(row.seat) && Array.isArray(row.assignments) &&
      row.assignments.length >= 1 && row.assignments.length <= 32,'invalid reviewer assignment');
    const codes = new Map(), runs = new Set();
    for (const card of row.assignments) {
      B.check(B.token(card?.code) && !codes.has(card.code) && B.token(card.runId) &&
        !runs.has(card.runId) && Object.hasOwn(B.tasks,card.task) &&
        (!tallies.has(card.runId) || tallies.get(card.runId).task === card.task),'invalid review candidate');
      codes.set(card.code,card);
      runs.add(card.runId);
      if (!tallies.has(card.runId)) tallies.set(card.runId,{task:card.task,rows:[]});
    }
    if (coverage) B.check(coverage.length === runs.size && coverage.every(run => runs.has(run)),
      'each reviewer must see the same submissions');
    coverage = [...runs];
    assignments.set(row.seat,codes);
  }
  const seen = new Set(), dimensions = Object.keys(criteria);
  for (const ballot of ballots) {
    const codes = assignments.get(ballot?.seat);
    B.check(B.valid(ballot,'ballot') && ballot.session === key.session && codes && !seen.has(ballot.seat) &&
      Array.isArray(ballot.ratings) && ballot.ratings.length === codes.size,'foreign, incomplete, or duplicate ballot');
    seen.add(ballot.seat);
    const used = new Set();
    for (const row of ballot.ratings) {
      const card = codes.get(row?.code);
      B.check(card && !used.has(row.code) && row.values && Object.keys(row.values).length === dimensions.length &&
        dimensions.every(name => rating(row.values[name])) &&
        (row.note === undefined || typeof row.note === 'string' && row.note.length <= 1000),'invalid candidate ratings');
      used.add(row.code);
      tallies.get(card.runId).rows.push({seat:ballot.seat,values:row.values,...(row.note && {note:row.note})});
    }
  }
  return {format:B.formats.scores,version:1,session:key.session,assigned:key.seats.length,received:seen.size,
    criteria:Object.fromEntries(dimensions.map(name => [name,criteria[name].label])),
    entries:[...tallies].map(([runId,{task,rows}]) => ({
      runId,task,count:rows.length,
      means:Object.fromEntries(dimensions.map(name => [name,mean(rows.map(row => row.values[name]))])),
      rows
    }))};
}

function score(keyFile, ballotsDirectory, output) {
  const key = B.read(keyFile);
  const filesFound = fs.readdirSync(ballotsDirectory,{withFileTypes:true})
    .filter(file => file.isFile() && file.name.endsWith('.json')).map(file => path.join(ballotsDirectory,file.name)).sort();
  B.check(filesFound.length <= 12 && filesFound.every(file => fs.statSync(file).size <= 64*1024),'too many or oversized ballots');
  const report = summarize(key,filesFound.map(B.read));
  writeNew(output,report);
  return report;
}

const mean = values => values.length ? values.reduce((sum,value) => sum+value,0)/values.length : null;
const delta = (a,b) => Number.isFinite(a) && Number.isFinite(b) ? b-a : null;

function metrics(run, entry) {
  const {protectedTexels,retainedTexels,protectedSwatches,retainedSwatches} = run.paint;
  return {
    elapsedMs:run.elapsedMs, manualRepairs:run.manualRepair.count,
    lostBindings:run.bindings.lost.length, displacedBindings:run.bindings.displaced.length,
    retainedPaint:protectedTexels ? retainedTexels/protectedTexels : null,
    retainedSwatches:protectedSwatches ? retainedSwatches/protectedSwatches : null,
    checksPassed:run.checks.filter(item => item.pass).length,
    ...Object.fromEntries(Object.keys(criteria).map(name => ['review-'+name,entry?.means?.[name] ?? null]))
  };
}

function writeNew(file, data) {
  B.check(typeof file === 'string' && path.extname(file).toLowerCase() === '.json','choose a JSON output file');
  files.publishJson(path.resolve(file),data,'Modeling benchmark output already exists with different data');
}

function compare(baseline, candidate, { scores } = {}) {
  const before = reads(baseline), after = reads(candidate), rows = [...before,...after];
  B.check(new Set(rows.map(({run}) => run.runId)).size === rows.length,'baseline and candidate must contain distinct runs');
  const scoresByRun = new Map();
  if (scores !== undefined) {
    B.check(B.valid(scores,'scores') && Array.isArray(scores.entries),'invalid blind review scores');
    for (const entry of scores.entries) {
      B.check(B.token(entry?.runId) && !scoresByRun.has(entry.runId) && Object.hasOwn(B.tasks,entry.task) &&
        entry.means && Object.keys(criteria).every(name => entry.means[name] === null ||
          Number.isFinite(entry.means[name]) && entry.means[name] >= 1 && entry.means[name] <= 5),
      'invalid blind review score entry');
      scoresByRun.set(entry.runId,entry);
    }
  }
  const laneKey = ({run}) => [run.task,run.kind,run.participant].join('/');
  const lanes = [before,after].map(groupRows => {
    const groups = group(groupRows,laneKey);
    B.check([...groups.values()].every(items => items.length === 1),'choose one attempt per task and participant in each lane');
    return groups;
  });
  const measure = run => {
    const entry = scoresByRun.get(run.runId);
    B.check(!entry || entry.task === run.task,'blind review score is for another task');
    return {runId:run.runId,workflow:run.workflow,toolRevision:run.toolRevision,reviewers:entry?.count ?? 0,
      metrics:metrics(run,entry)};
  };
  const tasks = [...group(rows,({run}) => run.task)].map(([task,groupRows]) => {
    B.check(matched(groupRows),'cannot compare different starting revisions or baseline frames for '+task);
    const keys = [...new Set(groupRows.map(laneKey))].sort();
    const participants = keys.map(key => {
      const [a,b] = lanes.map(lane => lane.get(key)?.[0].run);
      const {kind,participant} = a ?? b, baseline = a ? measure(a) : null, candidate = b ? measure(b) : null;
      const difference = baseline && candidate ? Object.fromEntries(Object.keys(baseline.metrics).map(name =>
        [name,delta(baseline.metrics[name],candidate.metrics[name])])) : null;
      return {kind,participant,baseline,candidate,difference};
    });
    const cohorts = [...group(participants,item => item.kind)].map(([kind,members]) => {
      const paired = members.filter(row => row.difference);
      const meanDeltas = Object.fromEntries(Object.keys((members[0].baseline ?? members[0].candidate).metrics).map(name => {
        const values = paired.map(row => row.difference[name]).filter(Number.isFinite);
        return [name,{pairs:values.length,mean:mean(values)}];
      }));
      return {kind,paired:paired.length,unpaired:members.length-paired.length,meanDeltas};
    });
    return {task,startRevision:groupRows[0].run.startRevision,participants,cohorts};
  });
  return {format:B.formats.comparison,version:1,tasks};
}

function command([action,...args], opt) {
  const usage = 'use modeling-benchmark prepare|start|repair|finish|blind|score|compare (see help)';
  function requireArgs(min,max,options) {
    B.check(args.length >= min && args.length <= max && Object.keys(opt).every(key => options.includes(key)),usage);
  }
  const out = () => { B.check(B.text(opt.out,4096),'specify --out'); return opt.out; };
  switch (action) {
    case 'prepare':
      requireArgs(0,0,['out']);
      return B.prepare(out());
    case 'start':
      requireArgs(2,2,['out','participant','kind','workflow','tool-revision']);
      return B.start(args[0],args[1],out(),{participant:opt.participant,kind:opt.kind,workflow:opt.workflow,
        toolRevision:opt['tool-revision']});
    case 'repair':
      requireArgs(1,1,['target','note']);
      return B.repair(args[0],opt);
    case 'finish':
      requireArgs(1,2,['repairs-complete']);
      return B.finish(args[0],args[1],{repairsComplete:opt['repairs-complete']});
    case 'blind':
      requireArgs(1,64,['out','seats']);
      return build(args,out(),{seats:opt.seats === undefined ? undefined : Number(opt.seats === true ? NaN : opt.seats)});
    case 'score':
      requireArgs(2,2,['out']);
      return score(args[0],args[1],out());
    case 'compare': {
      requireArgs(1,1,['out','scores']);
      const planFile = path.resolve(args[0]), plan = B.read(planFile);
      B.check(plan?.version === 1 && Array.isArray(plan.baseline) && Array.isArray(plan.candidate) &&
        [...plan.baseline,...plan.candidate].every(file => B.text(file,4096)), 'use a version 1 comparison plan with two run lists');
      const resolve = directory => path.resolve(path.dirname(planFile),directory);
      const report = compare(plan.baseline.map(resolve),plan.candidate.map(resolve),
        {scores:opt.scores === undefined ? undefined : B.read(opt.scores)});
      writeNew(out(),report);
      return report;
    }
    default:
      B.check(false,usage);
  }
}

module.exports = {build,score,summarize,compare,command};
