const fs = require('node:fs');
const path = require('node:path');

const coreFiles = ['p00-procedural', 'p06-musical-harmony', 'p06g-music-instruments',
  'p06ga-music-subtractive', 'p06gb-music-note-expression', 'p06gc-music-phrasing', 'p06gd-music-instrument-graph'];
function instrumentCore() {
  return 'const KIT={};\n' + coreFiles.map(name =>
    fs.readFileSync(path.join(__dirname, '../src/kit', name + '.js'), 'utf8')).join('\n') +
    '\nexport const instruments=KIT.procedural.musicInstruments, phrasing=KIT.procedural.musicPhrasing;\n';
}

const controls = {breath:[0,1], pressure:[0,1], contact:[0,1], room:[0,1], amplitude:[0,1], pitchCents:[-200,200]};
const headerBudget = 768 * 1024;
const bodyBudget = headerBudget + 4 + 2e6 * 4;
const own = (row, name) => Object.hasOwn(row ?? {}, name) ? row[name] : undefined;

function unpack(body) {
  if (body.length < 4) throw new RangeError('Missing recording header');
  const size = body.readUInt32LE(0);
  if (!size || size > headerBudget || 4 + size > body.length) throw new RangeError('Invalid recording header size');
  return {meta:JSON.parse(body.toString('utf8',4,4+size)), audio:body.subarray(4+size)};
}

function capture(P, session, state, meta, audio, pins) {
  const {fields,check,finite,integer,id} = P.musicInstruments;
  const {sampleRate:rate, loop} = state;
  const {from,to} = loop, length = to-from;
  check(fields(meta,['client','id','from','to','pass','lane','notes','gesture','mic']) &&
    typeof meta.id==='string' && /^[a-f0-9]{24}$/.test(meta.id) && meta.from===from && meta.to===to &&
    integer(meta.pass,0,Number.MAX_SAFE_INTEGER) && length>=Math.round(rate*.25) && length<=Math.min(rate*26,2e6),
  'Choose a complete current loop between a quarter second and the recording limit');
  const take = 'rec-pass-'+(meta.pass+1)+'-'+meta.id.slice(0,12), changes = [];
  const production = session.production, arrangement = production.arrangement.definition ?? production.arrangement;
  const clock=P.musicTiming.compile(arrangement.score.tempoMap);
  const beatAt=frame=>clock.sample(frame/rate).beat;
  const first = beatAt(from), last = beatAt(to);
  function points(input,span,max) {
    check(fields(input,Object.keys(controls)),'Unknown recorded controller');
    return Object.fromEntries(Object.entries(input).map(([name,rows])=>{
      check(Array.isArray(rows) && rows.length>0 && rows.length<=max,'Too many recorded controller points');
      let previous=-1;
      for (const row of rows) {
        check(Array.isArray(row) && row.length===2 && integer(row[0],previous+1,span) &&
          finite(row[1],...controls[name]),'Invalid recorded controller point');
        previous=row[0];
      }
      return [name,rows];
    }));
  }
  if (meta.notes!==undefined || meta.gesture!==undefined) {
    const lane=meta.lane, track=own(production.tracks,lane);
    check(id(lane) && track && production.patches[track.patch].type!=='clap' && pins?.[lane]!=='all',
      'Choose an editable native instrument lane');
    check(!own(session.takes,take),'This score take already exists');
    let edit;
    if (meta.notes!==undefined) {
      check(meta.gesture===undefined && pins?.[lane]!=='pitch' && Array.isArray(meta.notes) &&
        meta.notes.length>0 && meta.notes.length<=512, 'Record one to 512 notes on an unpinned instrument lane');
      check(last-first>=.0625 && last-first<=256,'A played clip needs a loop between 1/16 and 256 beats');
      const voices=[];
      const sorted=meta.notes.slice().sort((a,b)=>(a?.start ?? 0)-(b?.start ?? 0));
      for (const [index,note] of sorted.entries()) {
        check(fields(note,['start','end','midi','velocity','curves']) && integer(note.start,0,length-1) &&
          integer(note.end,note.start+1,length) && integer(note.midi,0,127) && finite(note.velocity,1/127,1),
          'Invalid recorded MIDI note');
        const beat=beatAt(from+note.start), stop=beatAt(from+note.end);
        if (stop-beat<1e-5) continue;
        const span=note.end-note.start;
        const curves=Object.fromEntries(Object.entries(points(note.curves ?? {},span,32)).map(([name,rows])=>
          [name,rows.map(([at,value])=>[at/span,value])]));
        let voice=voices.find(row=>row.end<=note.start);
        if (!voice) {
          check(voices.length<8,'Ink can store up to eight overlapping notes in a recorded clip');
          voice={id:'voice-'+(voices.length+1),notes:[]};
          voices.push(voice);
        }
        voice.end=note.end;
        voice.notes.push({id:'note-'+(index+1),beat:beat-first,duration:stop-beat,midi:note.midi,velocity:note.velocity,
          ...(Object.keys(curves).length && {play:{curves}})});
      }
      check(voices.length>0,'The pass has no usable notes');
      const percussion=arrangement.parts[lane]?.role==='percussion';
      const clip={id:take,beat:first,length:last-first,timing:'played',voices:voices.map(({id,notes})=>({id,notes})),
        ...(percussion && {mode:'layer'})};
      edit={clips:[clip],phrases:[]};
    } else {
      const drivers={}, mapping={};
      for (const [name,rows] of Object.entries(points(meta.gesture,length,192))) {
        const [lo,hi]=controls[name];
        drivers[name]=rows.map(([at,value],i)=>({id:'point-'+(i+1),beat:beatAt(from+at),value:(value-lo)/(hi-lo)}));
        mapping[name]={base:lo,from:{[name]:hi-lo}};
      }
      check(Object.keys(drivers).length>0,'Move a controller during the loop to record a gesture');
      const phrase={id:'captured-gesture',from:first,to:last,drivers,mapping};
      edit={phrases:[...(track.phrases ?? []).filter(row=>row.id!==phrase.id &&
        (row.to<=first || row.from>=last)),phrase]};
    }
    changes.push({op:'score-take',take,revision:{tracks:{[lane]:edit}}});
  }
  let asset, micLane;
  if (meta.mic) {
    check(fields(meta.mic,['lane']) && (meta.mic.lane===undefined || id(meta.mic.lane)) && audio.length===length*4,
      'Microphone PCM must cover the full loop at the session sample rate');
    micLane=meta.mic.lane;
    if (micLane) check(own(session.audio,micLane) && pins?.[micLane]!=='all' &&
      !own(session.audio[micLane].takes,take),'Choose an editable recording lane');
    else {
      micLane='mic';
      let index=1;
      while (own(production.tracks,micLane) || own(session.audio,micLane) || own(session.mixer?.strips,micLane))
        micLane='mic-'+ ++index;
      changes.push({op:'audio-take',lane:micLane,take:'silence',source:{silence:true}});
    }
    const samples=new Float32Array(length);
    for (let i=0;i<length;i++) {
      const value=audio.readFloatLE(i*4);
      check(finite(value,-1,1),'Microphone PCM must be finite and normalized');
      samples[i]=value;
    }
    asset={name:take+'-mic',pcm:{sampleRate:rate,channels:1,samples}};
    changes.push({op:'audio-take',lane:micLane,take,source:{asset:asset.name,at:{samples:from}}});
  } else check(audio.length===0,'Unexpected recording audio');
  check(changes.length>0,'The pass has no captured material');
  return {take,changes,asset,micLane,range:{from,to},pass:meta.pass};
}

module.exports = {bodyBudget,unpack,capture,instrumentCore};
