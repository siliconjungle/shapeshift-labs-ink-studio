/* Blinded audio pairs, order and identity controls, and criterion-level listener calibration. */
(function (P) {
  const A=P.mediaGraph, S=P.mediaGraphSupport, {fields,record,finite,integer,id,check,db,hash}=P.musicInstruments;
  const R=P.musicCritiqueReferences;
  const format='ink-studio/listener-calibration', round=n=>Number(n.toFixed(6));
  const sides=['left','right','tie'], responses=['A','B','tie','abstain'];
  const rateLimit=48000;

  function expect(row) {
    if (row.kind==='known') return row.expected;
    if (!row.votes?.length) return null;
    const counts=Object.fromEntries(sides.map(choice=>[choice,row.votes.filter(vote=>vote===choice).length]));
    const maximum=Math.max(...Object.values(counts));
    const leaders=sides.filter(choice=>counts[choice]===maximum);
    // A split vote is preserved as uncertain human evidence.
    return leaders.length===1 && maximum>row.votes.length/2 ? leaders[0] : null;
  }

  function pack(clips,settings) {
    check(record(clips) && Object.keys(clips).length<=128 && fields(settings,['id','seed','cases','gapSeconds','ceiling']) &&
      id(settings.id ?? 'listener') && Number.isSafeInteger(settings.seed ?? 0) &&
      finite(settings.gapSeconds ?? .75,.25,2) && finite(settings.ceiling ?? -2,-12,-.1) &&
      Array.isArray(settings.cases) && integer(settings.cases.length,1,32) &&
      new Set(settings.cases.map(row=>row?.id)).size===settings.cases.length,'Give the listener named comparison cases');
    const chosen=new Map();
    function clip(name) {
      check(Object.hasOwn(clips,name),'Unknown listener clip '+name);
      if (!chosen.has(name)) {
        const raw=clips[name], tagged=fields(raw,['audio','firstSample']);
        const audio=A.audio(tagged ? raw.audio : raw);
        const frames=audio.samples.length/audio.channels, firstSample=tagged ? raw.firstSample ?? 0 : 0;
        check(audio.channels<=2 && integer(audio.sampleRate,8000,rateLimit) &&
          frames>=audio.sampleRate*.15 && frames<=audio.sampleRate*15 &&
          integer(firstSample,0,Number.MAX_SAFE_INTEGER-frames),'Listener clips need .15 to 15 seconds of mono or stereo PCM');
        chosen.set(name,{audio,frames,firstSample,hash:R.audioHash(audio.samples)});
      }
      return chosen.get(name);
    }
    const cases=[], trials=[], audio={};
    let total=0;
    for (const row of settings.cases) {
      check(fields(row,['id','kind','criterion','question','left','right','expected','votes']) && id(row.id) &&
        ['known','preference'].includes(row.kind) && id(row.criterion) && R.prose(row.question,400) &&
        id(row.left) && id(row.right) && row.left!==row.right &&
        (row.kind==='known' ? sides.includes(row.expected) && row.votes===undefined :
          row.expected===undefined && (row.votes===undefined || Array.isArray(row.votes) && integer(row.votes.length,1,128) &&
          Array.from(row.votes).every(vote=>sides.includes(vote)))),'Invalid listener case or human labels');
      const pair={left:clip(row.left),right:clip(row.right)}, {sampleRate,channels}=pair.left.audio;
      check(pair.left.audio.sampleRate===pair.right.audio.sampleRate && channels===pair.right.audio.channels &&
        pair.left.frames===pair.right.frames,'Listener comparisons need aligned equal-length clips on one PCM grid');
      check(pair.left.hash!==pair.right.hash || row.expected==='tie','Use different audio for an experimental pair');
      const peak=Math.max(...Object.values(pair).map(({audio})=>
        S.mixerPeak.peak(audio.samples,channels)));
      const gain=Math.min(1,db(settings.ceiling ?? -2)/Math.max(peak,1e-9));
      const first=(hash([settings.seed ?? 0,row.id])>>>0)%2 ? 'right' : 'left', second=first==='left' ? 'right' : 'left';
      const gap=Math.round((settings.gapSeconds ?? .75)*sampleRate), width=pair.left.frames;
      const orders=[[first,second],[second,first],[second,second]];
      const records=orders.map((order,i)=>{
        const name='trial-'+(hash([settings.seed ?? 0,row.id,i])>>>0).toString(36);
        check(!Object.hasOwn(audio,name),'Listener trial IDs collide; change the seed');
        const frames=2*width+gap;
        total+=frames*channels;
        check(total<=32e6,'Listener reels exceed the PCM budget');
        const samples=new Float32Array(frames*channels), halves={};
        for (const [j,side] of order.entries()) {
          const label=j ? 'B' : 'A', at=j ? width+gap : 0;
          const {audio}=pair[side];
          for (let k=0;k<audio.samples.length;k++) samples[at*channels+k]=audio.samples[k]*gain;
          halves[label]={firstSample:at,endSample:at+width};
        }
        const publicRow={id:name,criterion:row.criterion,question:row.question,sampleRate,halves};
        trials.push(publicRow);
        audio[name]={sampleRate,channels,samples};
        return {id:name,order,control:i===2 ? 'identical' : i===1 ? 'swapped' : 'forward',
          origins:order.map(side=>pair[side].firstSample)};
      });
      cases.push({id:row.id,kind:row.kind,criterion:row.criterion,expected:expect(row),votes:row.votes ?? [],
        clips:{left:row.left,right:row.right},hashes:Object.values(pair).map(row=>row.hash),records});
    }
    // Interleave controls and orientations so adjacent trial IDs are not clues.
    trials.sort((a,b)=>(hash([settings.seed ?? 0,'mix',a.id])>>>0)-(hash([settings.seed ?? 0,'mix',b.id])>>>0) ||
      a.id.localeCompare(b.id));
    const key={format,version:1,id:settings.id ?? 'listener',trials,cases};
    const token='listener-'+hash(JSON.stringify(key)).toString(36);
    return {value:{format:'ink-studio/listener-pairs',version:1,id:key.id,token,trials},audio,key:{...key,token}};
  }

  function evaluate(key,input,settings={}) {
    check(fields(key,['format','version','id','token','cases','trials']) && key.format===format && key.version===1 &&
      fields(input,['token','model','responses']) && input.token===key.token && R.prose(input.model,160) &&
      Array.isArray(key.trials) && integer(key.trials.length,3,96) && Array.isArray(key.cases) &&
      integer(key.cases.length,1,32) && Array.isArray(input.responses) && input.responses.length<=key.trials.length &&
      new Set(input.responses.map(row=>row?.trial)).size===input.responses.length &&
      fields(settings,['minLabeled']) && integer(settings.minLabeled ?? 5,2,32),'Open a paired listener key and unique responses');
    const {token,...body}=key;
    check(token==='listener-'+hash(JSON.stringify(body)).toString(36),'Listener key contents do not match the batch token');
    const trials=new Map(key.trials.map(row=>[row.id,row]));
    check(Array.from(input.responses).every(row=>fields(row,['trial','choice','reason','evidence','raw']) && trials.has(row.trial) &&
      responses.includes(row.choice) && (row.reason===undefined || R.prose(row.reason,1000)) &&
      (row.raw===undefined || typeof row.raw==='string' && row.raw.length<=6000) &&
      (row.evidence===undefined || Array.isArray(row.evidence) && row.evidence.length<=8)),
    'Invalid listener response');
    const replies=new Map(input.responses.map(row=>[row.trial,row]));
    const aggregate=new Map(), minLabeled=settings.minLabeled ?? 5;
    const ratio=(top,bottom)=>bottom ? round(top/bottom) : null;
    const cases=key.cases.map(row=>{
      const group=aggregate.get(row.criterion) ?? {criterion:row.criterion,labeled:0,humanLabeled:0,unlabeled:0,
        completed:0,covered:0,correct:0,knownCorrect:0,humanCorrect:0,orderPairs:0,orderStable:0,controlCount:0,controlTies:0,
        falsePreferences:0,responses:0,abstained:0,missing:0,addressed:0,rejectedAddresses:0};
      aggregate.set(row.criterion,group);
      if (row.expected) group.labeled++;
      else group.unlabeled++;
      if (row.kind==='preference' && row.expected) group.humanLabeled++;
      const measured=row.records.map(record=>{
        const {order,origins,control,id}=record, trial=trials.get(id), reply=replies.get(id);
        if (!reply) group.missing++;
        else {
          group.responses++;
          if (reply.choice==='abstain') group.abstained++;
        }
        const choice=reply?.choice ?? 'missing';
        const preference=choice==='A' ? order[0] : choice==='B' ? order[1] : choice;
        const evidence=[];
        for (const event of reply?.evidence ?? []) {
          const half=event?.side==='A' ? 0 : event?.side==='B' ? 1 : -1;
          const width=(trial.halves.A.endSample-trial.halves.A.firstSample)/trial.sampleRate;
          if (!fields(event,['side','from','to','observation']) || half<0 || !finite(event.from,0,width) ||
              !finite(event.to,event.from,width) || !R.prose(event.observation,300)) {
            group.rejectedAddresses++;
            continue;
          }
          const from=origins[half]+Math.round(event.from*trial.sampleRate), to=origins[half]+Math.round(event.to*trial.sampleRate);
          if (to<=from) {
            group.rejectedAddresses++;
            continue;
          }
          group.addressed++;
          evidence.push({clip:row.clips[order[half]],firstSample:from,endSample:to,sampleRate:trial.sampleRate,
            observation:event.observation});
        }
        if (control==='identical') {
          if (choice!=='missing') group.controlCount++;
          if (choice==='tie') group.controlTies++;
          if (choice==='A' || choice==='B') group.falsePreferences++;
        }
        return {id,control,choice,preference,evidence,...(reply?.reason && {reason:reply.reason})};
      });
      const [first,swapped,control]=measured;
      const covered=sides.includes(first.preference) && sides.includes(swapped.preference);
      const orderStable=covered && first.preference===swapped.preference;
      if (covered) {group.orderPairs++;if (orderStable) group.orderStable++;}
      const correct=row.expected!==null && orderStable && first.preference===row.expected;
      if (row.expected && first.choice!=='missing' && swapped.choice!=='missing') group.completed++;
      if (row.expected && covered) group.covered++;
      if (correct) {
        group.correct++;
        if (row.kind==='known') group.knownCorrect++;
        else group.humanCorrect++;
      }
      return {id:row.id,criterion:row.criterion,kind:row.kind,expected:row.expected,votes:row.votes,
        covered,orderStable,correct:row.expected===null ? null : correct,identity:control.choice,trials:measured};
    });
    const criteria=[...aggregate.values()].map(row=>{
      const accuracy=ratio(row.correct,row.labeled), coverage=ratio(row.covered,row.labeled);
      const order=ratio(row.orderStable,row.orderPairs), ties=ratio(row.controlTies,row.controlCount);
      const status=row.completed<minLabeled || row.controlCount<minLabeled ?
        'insufficient' : accuracy>=.8 && coverage>=.75 && order>=.8 && ties>=.8 ? 'passed' : 'failed';
      return {...row,accuracy,coverage,orderConsistency:order,identityTieRate:ties,status};
    });
    return P.data.freeze({format:'ink-studio/listener-evaluation',version:1,id:key.id,token,model:input.model,
      minLabeled,criteria,cases});
  }
  P.musicCritiqueListener=Object.freeze({pack,evaluate});
})(KIT.procedural);
