/* Playback evidence collected on the absolute scene sample grid. */
const {playbackStart}=require('./scene-audio-mix.js');

const format='ink-studio/audio-playback-receipts';
function positionAt(track,sample,fallback) {
  const points=track?.points;
  if (!points?.length) return fallback;
  const index=points.findLastIndex(row=>row.sample<=sample);
  const a=points[index], b=points[index+1];
  if (!a?.position || !b?.position) return a?.position ?? b?.position ?? fallback;
  const progress=(sample-a.sample)/(b.sample-a.sample);
  return a.position.map((value,k)=>value+(b.position[k]-value)*progress);
}
function createPlaybackReceipts({sampleRate,end,post}) {
  const candidates=[];
  function add(source,{cue,asset,stem,bus,requestedSample,plannedSample,observedSample,
    voice,track,audit,reason,placed}) {
    if (!source?.beatId || requestedSample>=end) return;
    if (candidates.length>=16384) throw new RangeError('Story audio exceeds its playback receipt budget');
    const selection=voice?.selection;
    const receipt={
      beatId:source.beatId,cue,asset,requestedSample,plannedSample,observedSample,
      bus:post ? bus ?? (stem==='music' ? 'music' : 'effects') : stem,
      variant:selection ? {family:selection.family,take:selection.take,binding:selection.binding,rule:selection.rule,
        ...(selection.layer && {layer:selection.layer.at}),...selection.variation} : null,
      spatialSource:voice?.sourceAt===undefined && !voice?.position ? null : {
        selector:voice.sourceAt ?? null,position:voice.position ?? null,
        apparentSource:voice.apparentSource ?? voice.position ?? null
      }
    };
    candidates.push({receipt,track,audit,reason,placed});
  }
  function finish(resolve,gain) {
    return candidates.map(({receipt,track,audit,reason,placed})=>{
      const {plannedSample}=receipt, allocation=audit?.voiceBudget;
      let actualSample=null, outcome;
      if (plannedSample>=end) {
        outcome='outside-window';
        reason='past-render-end';
      } else if (allocation?.action==='dropped') {
        outcome='dropped';
        reason=allocation.reason;
      } else if (reason) {
        outcome=reason==='outside-production-window' ? 'outside-window' :
          ['unavailable','out-of-range','blocked','zero-gain'].includes(reason) ? 'muted' : 'dropped';
      } else if (!gain) {
        outcome='muted';
        reason='zero-gain';
      } else {
        if (placed) actualSample=plannedSample;
        else if (track) actualSample=playbackStart(track,resolve(track.asset),sampleRate,end);
        if (actualSample===null) {
          outcome='muted';
          reason=track && (track.gain===0 || track.points?.length && track.points.every(point=>point.gain===0)) ?
            'zero-gain' : 'no-playable-samples';
        } else outcome=actualSample>plannedSample ? 'late' : 'played';
      }
      const spatialSource=receipt.spatialSource && {...receipt.spatialSource,
        ...(actualSample!==null && {actualPosition:positionAt(track,actualSample,receipt.spatialSource.position)})};
      const result={...receipt,spatialSource,actualSample,lateBySamples:actualSample===null ? null : actualSample-plannedSample,outcome,
        ...(reason && {reason}),...(allocation && {voiceBudget:allocation})};
      if (audit) {
        const {beatId,cue,asset,...evidence}=result;
        audit.playback=evidence;
      }
      return result;
    });
  }
  return {add,finish};
}

module.exports={format,createPlaybackReceipts};
