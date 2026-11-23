/* Map recorded audio faults onto the same exact frames as show diagnostics. */
const {reportFile,showRate}=require('./show-beat-diagnostics.js');
const {format:playbackFormat}=require('./scene-audio-receipts.js');

const liveFormat='ink-studio/music-live-report';
const kinds=['missed-audio-cue','audio-underrun','late-musical-join'];
const sample=n=>Number.isSafeInteger(n) && n>=0;
const record=value=>value && Object.getPrototypeOf(value)===Object.prototype;
const fields=(value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
const cue=value=>typeof value==='string' && value.length>0 && value.length<=512;

function playback(row,index,report,W) {
  const {beatId,cue:name,bus,asset,requestedSample,plannedSample,actualSample,outcome,reason,lateBySamples}=row ?? {};
  W.data.check(record(row) && W.inspectionLinks.parse(beatId) && cue(name) && cue(bus) &&
    sample(requestedSample) && sample(plannedSample) && (actualSample===null || sample(actualSample)) &&
    ['played','late','dropped','muted','outside-window'].includes(outcome),
  'Invalid audio playback receipt');
  const missed=outcome==='late' || (outcome==='dropped' && reason!=='withheld') ||
    (outcome==='muted' && ['unavailable','no-playable-samples'].includes(reason));
  if (!missed) return;
  W.data.check(actualSample===null || actualSample>=plannedSample && actualSample<report.endSample,
    'Playback receipt needs a valid actual sample');
  return {kind:'missed-audio-cue',fromSample:plannedSample,toSample:(actualSample ?? plannedSample)+1,beatId,
    cue:name,bus,asset,requestedSample,plannedSample,actualSample,status:outcome,reason,lateBySamples,
    sourcePointer:'/receipts/'+index};
}

function load(K,entries,directory,rate,frames) {
  const W=K.world, T=K.procedural.takeTime, fps=showRate(T,rate), files=[], findings=[], omitted={}, retained={};
  W.data.check(Array.isArray(entries) && entries.length<=32,'Show needs up to 32 audio reports');
  for (const spec of entries) {
    W.data.check(fields(spec,['file','atFrame','fromSample','toSample']),'Invalid show audio report placement');
    const {report,file}=reportFile(directory,spec.file,'audioReports');
    const {sampleRate,firstSample,endSample,format,version}=report ?? {};
    const {atFrame=0,fromSample=firstSample,toSample=endSample}=spec;
    W.data.check(version===1 && [playbackFormat,liveFormat].includes(format) && sample(sampleRate) &&
      sampleRate>=8000 && sampleRate<=192000 && [firstSample,endSample,fromSample,toSample,atFrame].every(sample) &&
      firstSample<=fromSample && fromSample<toSample && toSample<=endSample && atFrame<frames,
    'Audio report needs its sample rate, coverage, and an in-range show placement');
    files.push(file);
    const scale=T.div(fps,T.read(sampleRate));
    const local=at=>T.mul(T.read(at-fromSample),scale);
    const floor=at=>atFrame+T.index(T.roundDown(local(at)));
    const ceil=at=>atFrame-T.index(T.roundDown(T.sub(T.read(0),local(at))));
    function place(row) {
      if (!row || row.toSample<=fromSample || row.fromSample>=toSample) return;
      const first=Math.max(fromSample,row.fromSample), end=Math.min(toSample,row.toSample);
      const fromFrame=floor(first), toFrame=Math.min(frames,ceil(end));
      if (fromFrame>=toFrame) return;
      const {kind,beatId,...detail}=row, alignment=format===playbackFormat?'audio-receipt':'audio-live';
      if ((retained[kind] ?? 0)>=256) {
        omitted[kind]=(omitted[kind] ?? 0)+1;
        return;
      }
      retained[kind]=(retained[kind] ?? 0)+1;
      findings.push({kind,fromFrame,toFrame,detail:{...detail,sampleRate,sourceReport:spec.file,atFrame},
        ...(beatId && {direct:{beatId,fromFrame,toFrame,alignment}})});
    }
    if (format===playbackFormat) {
      W.data.check(Array.isArray(report.receipts) && report.receipts.length<=16384,'Invalid audio playback receipt list');
      report.receipts.forEach((row,i)=>place(playback(row,i,report,W)));
    } else {
      const {findings:rows,omitted:counts}=report.audioDiagnostics ?? {};
      W.data.check(Array.isArray(rows) && rows.length<=768 && fields(counts,kinds) &&
        Object.values(counts).every(sample),'Invalid live audio report diagnostics');
      rows.forEach((row,i)=>{
        W.data.check(record(row) && kinds.includes(row.kind) && sample(row.fromSample) && sample(row.toSample) &&
          row.fromSample>=firstSample && row.fromSample<row.toSample && row.toSample<=endSample &&
          (row.beatId===undefined || W.inspectionLinks.parse(row.beatId)), 'Invalid live audio finding');
        place({...row,sourcePointer:'/audioDiagnostics/findings/'+i});
      });
      if (fromSample===firstSample && toSample===endSample && ceil(endSample)<=frames)
        for (const [kind,count] of Object.entries(counts)) omitted[kind]=(omitted[kind] ?? 0)+count;
    }
  }
  return {files,findings,omitted};
}

module.exports={load,kinds};
