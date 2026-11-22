const fs=require('node:fs'),path=require('node:path');
const {readAudioSource}=require('./sound-source.js'),MIDI=require('./midi-notes.js');
const {json}=require('./asset-files.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const filename=value=>typeof value==='string' && value.trim();

function importNotes(input,folder,P) {
  const {fields,integer,finite,id,check}=P.musicInstruments;
  check(fields(input,['kind','file','lanes']) && filename(input.file),'MIDI extraction needs a file and optional lane selectors');
  const {notes,...source}=MIDI.read(path.resolve(folder,input.file));
  const lanes=input.lanes ?? [{lane:'mix'}];
  check(Array.isArray(lanes) && integer(lanes.length,1,32),'Use one to thirty-two MIDI lane selectors');
  for (const row of lanes) {
    const {channel,track,notes,velocity,articulation}=row ?? {};
    check(fields(row,['lane','channel','track','notes','velocity','articulation']) && id(row.lane) &&
      (articulation===undefined || id(articulation)) &&
      (channel===undefined || integer(channel,1,16)) && (track===undefined || integer(track,0,source.tracks-1)) &&
      (notes===undefined || Array.isArray(notes) && integer(notes.length,1,128) &&
        Array.from(notes).every(pitch=>integer(pitch,0,127))) &&
      (velocity===undefined || Array.isArray(velocity) && velocity.length===2 && finite(velocity[0],0,1) &&
        finite(velocity[1],velocity[0],1)),'Invalid MIDI groove lane selector');
  }
  const events=[];
  for (const {channel,track,pitch,...note} of notes) for (const selector of lanes) {
    if (selector.channel!==undefined && selector.channel!==channel ||
        selector.track!==undefined && selector.track!==track ||
        selector.notes && !selector.notes.includes(pitch) ||
        selector.velocity && !finite(note.velocity,...selector.velocity)) continue;
    check(events.length<16384,'MIDI groove routing exceeds its note budget');
    events.push({lane:selector.lane,...note,midi:pitch,
      ...(selector.articulation!==undefined && {articulation:selector.articulation})});
  }
  return {source,events};
}

function extract(file,kit) {
  const P=kit.KIT.procedural,{fields,record,id,check}=P.musicInstruments;
  const recipe=read(file), folder=path.dirname(path.resolve(file));
  check(fields(recipe,['input','grid','detect','gate']) &&
    ['audio','midi','events'].includes(recipe.input?.kind),'Choose audio lanes, MIDI, or measured note events');
  const {input,grid,detect,gate}=recipe;
  let result;
  if (input.kind==='audio') {
    check(fields(input,['kind','lanes']) && record(input.lanes) &&
      Object.keys(input.lanes).length<=32 && Object.entries(input.lanes).every(([key,row])=>id(key) &&
        (filename(row) || fields(row,['file','lane','articulation']) && filename(row.file))),
      'Provide named audio lanes in the recipe');
    let samples=0;
    const sources=Object.fromEntries(Object.entries(input.lanes).map(([key,row])=>{
      const tagged=record(row), file=tagged ? row.file : row;
      const audio=readAudioSource(path.resolve(folder,file),P);
      samples+=audio.samples.length;
      check(samples<=32e6,'Audio groove sources exceed their sample budget');
      return [key,tagged ? {audio,lane:row.lane,articulation:row.articulation} : audio];
    }));
    result=P.mediaGraph.extractGroove(sources,{grid,detect,gate});
  } else {
    check(detect===undefined && gate===undefined,'Transient and envelope settings apply to audio sources');
    if (input.kind==='midi') {
      const {source,events}=importNotes(input,folder,P);
      result=P.performanceGroove.fit(events,grid);
      Object.assign(result.report,{source:'midi',midi:source});
    } else {
      check(fields(input,['kind','file']) && filename(input.file),'Event extraction needs a measured note file');
      result=P.performanceGroove.fit(read(path.resolve(folder,input.file)),grid);
      result.report.source='events';
    }
  }
  return {template:result.value,take:result.take,report:result.report};
}

module.exports=function grooveCommand([mode,file],opt,kit) {
  if (mode!=='extract' || !file) throw new TypeError('Use music groove extract recipe.json');
  const result=extract(file,kit);
  if (typeof opt.out==='string') json(opt.out,result);
  else process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
};
