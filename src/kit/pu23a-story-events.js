/* Analyze and present recorded world events without loading their simulation. */
(function(K) {
  const W = K.world, {check,copy,equal,id,record} = W.data, {freeze} = K.procedural.data;
  const format = 'ink-studio/story-events', envelopeFormat = 'ink-studio/committed-events', version = 1;
  const maxHistory = 100000, maxBatch = 10000, maxData = 32*1024*1024, maxCues = 4096;
  const validTick = tick => Number.isSafeInteger(tick)&&tick>=0&&tick<=W.runtime.maxTick;
  const validDt = dt => Number.isFinite(dt)&&dt>0&&dt<=1;
  const storyOf = ({document,story}) => id(document)&&id(story)?document+'/'+story:null;
  const storyKinds = new Set([
    'story-started','story-start-rejected','story-transition','story-stage-entered','story-beat-entered','story-objective-resolved','story-progress-rejected',
    'story-branch-chosen','story-decision-opened','story-decision-elapsed','story-commitment-decision',
    'story-handoff-decision','story-handoff-accepted','story-settlement','story-settlement-blocked',
    'story-cooldown-started','story-candidate-queued','story-candidate-checked','story-candidate-dispatched','story-candidate-selected','story-candidate-expired','story-candidate-rejected'
  ]);

  function retained(source) {
    const frame = source.format===W.runtime.runFormat?source.end:source;
    check(source.version===version&&frame?.format===W.runtime.checkpointFormat&&frame.version===version&&
      id(frame.world?.id)&&validDt(frame.world.dt)&&validTick(frame.tick)&&
      Array.isArray(frame.history)&&frame.history.length<=maxHistory&&Array.isArray(frame.events)&&frame.events.length<=maxBatch&&
      Number.isSafeInteger(frame.dropped)&&frame.dropped>=0,
      'Invalid native event history source');
    const rows = new Map();
    const sequence = event => Number(event.id.slice(event.id.indexOf('.')+1));
    for (const event of [...frame.history,...frame.events]) {
      check(record(event)&&validTick(event.tick)&&typeof event.id==='string'&&/^\d{1,8}\.\d{1,4}$/.test(event.id)&&
        event.id.startsWith(event.tick+'.')&&(!rows.has(event.id)||equal(rows.get(event.id),event)),
        'Invalid or conflicting retained world event');
      rows.set(event.id,event);
    }
    const events = [...rows.values()].sort((a,b)=>a.tick-b.tick||sequence(a)-sequence(b));
    return {format,version,id:frame.world.id,dt:frame.world.dt,from:0,to:frame.tick,
      coverage:'retained',dropped:frame.dropped,events};
  }

  function read(source) {
    if ([W.runtime.runFormat,W.runtime.checkpointFormat].includes(source?.format)) source = retained(source);
    check(record(source)&&source.format===format&&source.version===version&&id(source.id)&&validDt(source.dt)&&
      Object.keys(source).every(key=>['format','version','id','dt','from','to','coverage','dropped','events'].includes(key))&&
      validTick(source.from)&&validTick(source.to)&&source.to>=source.from&&
      ['complete','retained'].includes(source.coverage)&&Number.isSafeInteger(source.dropped)&&source.dropped>=0&&
      (source.coverage!=='complete'||source.dropped===0)&&Array.isArray(source.events)&&source.events.length<=maxHistory+maxBatch,
      'Expected a version 1 story event recording with a clock and coverage');
    const events = [], seen = new Set();
    let last = source.from, size = 0;
    for (const input of source.events) {
      const event = copy(input);
      check(record(event)&&id(event.id)&&id(event.kind)&&id(event.system)&&validTick(event.tick)&&
        event.tick>=last&&event.tick<=source.to&&!seen.has(event.id),
        'Story event IDs must be unique and events must be in tick order');
      W.timedEvents.timeOf(event);
      size += JSON.stringify(event).length;
      check(size<=maxData, 'Story event recording exceeds its data budget');
      seen.add(event.id);
      events.push(event);
      last = event.tick;
    }
    return freeze({...source,events});
  }

  function describe(event) {
    const title = event.kind.replace(/-/g,' ');
    function label(value) {
      return typeof value==='string'?value.replace(/[\r\n\t]/g,' ').slice(0,80):undefined;
    }
    const {kind,stage,branch,objective,to,outcome,decision,reason,beat} = event;
    const detail = kind==='story-transition'?label(outcome??to):
      kind==='story-branch-chosen'?label(branch):
      kind==='story-beat-entered'?label(beat?.kind):
      kind==='story-objective-resolved'?label(objective):
      kind==='story-stage-entered'||kind==='story-decision-opened'||kind==='story-decision-elapsed'?label(stage):
      kind==='story-candidate-selected'?label(event.selection?.reason):
      kind==='story-candidate-dispatched'&&event.anchor?label(event.anchor.reason):
      kind==='story-progress-rejected'?label(reason):undefined;
    const by = kind==='story-branch-chosen'&&label(decision?.by??beat?.by);
    return title+(detail?' · '+detail:'')+(by?' ('+by+')':'');
  }

  function selected(recording,story) {
    if (story===undefined) return recording.events;
    check(typeof story==='string'&&story.split('/').length===2&&story.split('/').every(id),
      'Story event filter needs a document/story ID');
    const links = new Set();
    for (const event of recording.events) if (storyOf(event)===story&&storyKinds.has(event.kind)) {
      if (id(event.receipt?.event?.id)) links.add(event.receipt.event.id);
      const proof = event.evidence??event.source?.evidence;
      if (Array.isArray(proof?.events)) for (const ref of proof.events) if (id(ref)) links.add(ref);
    }
    return recording.events.filter(event=>storyOf(event)===story||links.has(event.id));
  }

  function analyze(source,{story} = {}) {
    const recording = read(source), {events:all,...header} = recording, events = selected(recording,story);
    const kinds = new Map(), stories = new Map(), hostReceipts = new Map();
    const timeline = events.map(event=>{
      kinds.set(event.kind,(kinds.get(event.kind)??0)+1);
      const key = storyOf(event);
      if (key&&storyKinds.has(event.kind)) {
        if (!stories.has(key)) stories.set(key,{status:null,transitions:0,branches:0,objectives:0,windows:0});
        const row = stories.get(key);
        if (event.kind==='story-transition'&&id(event.to)) {
          row.status = event.to;
          row.transitions++;
          if (id(event.outcome)) row.outcome = event.outcome;
          else delete row.outcome;
        }
        if (event.kind==='story-branch-chosen') row.branches++;
        if (event.kind==='story-objective-resolved') row.objectives++;
        if (event.kind==='story-decision-opened') row.windows++;
      }
      const receipt = event.receipt?.event?.receipt??event.receipt;
      if (receipt?.format===W.storyHosts.format&&W.storyHosts.validReceipt(receipt,receipt.attempt,receipt.tick,receipt.status))
        hostReceipts.set(receipt.system+'/'+receipt.attempt+'/'+receipt.id,receipt);
      return {time:event.tick*recording.dt,label:describe(event),event};
    });
    return freeze({format:'ink-studio/story-event-report',version,source:{...header,events:all.length},
      ...(story!==undefined&&{story}),counts:Object.fromEntries(kinds),stories:Object.fromEntries(stories),
      hostReceipts:[...hostReceipts.values()],timeline});
  }

  function timeline(source,{story} = {}) {
    const recording = read(source), events = selected(recording,story);
    check(events.length<=maxCues,'Story timeline exceeds 4096 cues. Select a story or a shorter recording.');
    const markers = [], cues = [];
    for (const [index,event] of events.entries()) {
      const cueId = 'story-cue-'+index, time = event.tick*recording.dt, label = describe(event);
      const descriptor = Object.fromEntries(['stage','branch','objective','outcome','to'].filter(key=>id(event[key]))
        .map(key=>[key,event[key]]));
      if (Number.isSafeInteger(event.visit)&&event.visit>0) descriptor.visit = event.visit;
      markers.push({id:cueId,time,label});
      cues.push({id:cueId,time,kind:'story-cue',detail:{label,sourceEvent:event.id,sourceKind:event.kind,
        sourceSystem:event.system,sourceTick:event.tick,...descriptor,...(storyOf(event)&&{document:event.document,story:event.story})}});
    }
    return freeze({duration:recording.to*recording.dt,markers,events:cues});
  }

  function envelopes(source,{story,stream,simulationRate} = {}) {
    const {events:rows,id:world,dt,from,to,coverage,dropped}=read(source);
    check(story===undefined||typeof story==='string'&&story.split('/').length===2&&story.split('/').every(id),
      'Story event filter needs a document/story ID');
    const lineage=stream??source.end?.eventStream??source.eventStream;
    const rate=simulationRate??(source.end??source).world?.takeClock?.simulationRate;
    const events=rows.map(row=>W.committedEvents.read(row,world,lineage))
      .filter(row=>story===undefined||row.story===story);
    return freeze({format:envelopeFormat,version,world,dt,from,to,coverage,dropped,events,
      ...(rate!==undefined&&{simulationRate:copy(rate)})});
  }

  W.storyEvents = Object.freeze({format,envelopeFormat,read,analyze,timeline,envelopes});
})(KIT);
