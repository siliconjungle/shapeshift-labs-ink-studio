/* Print scene roles through the same offline strip graph as music sessions. */
const WAV=require('./wav.js'),{sumVoices}=require('./scene-audio-mix.js');
const buses=Object.freeze(['dialogue','foley','effects','ambience','music']);
const legacy=Object.freeze(['timeline','spatial','tracks']);
function createScenePost(P,post,sampleRate) {
  const {fields,record,id,check,integer}=P.musicInstruments;
  check(fields(post,['strips','processors','assets','map','peakPolicy']) && integer(sampleRate,8000,96000) &&
    record(post.strips ?? {}) && record(post.assets ?? {}) &&
    Object.entries(post.assets ?? {}).every(([name,asset])=>id(name) && !buses.includes(name) &&
      typeof asset==='string' && asset.trim()),
  'Scene post needs mixer strips and named processor assets at 8000 to 96000 Hz');
  const definitions=Object.fromEntries([...buses,'master'].map(name=>[name,{}]));
  for (const [name,row] of Object.entries(post.strips ?? {})) {
    check(id(name) && fields(row,['inserts','fader','pan','sends','output']),
      'Scene post strips may configure routing and inserts. Place source clips in the soundtrack');
    definitions[name]=row;
  }
  const taps=Object.fromEntries(buses.map(name=>[name,{strip:name}]));
  function prepare(voices,resolve,{start,end,gain},collect=false) {
    check(start>=0 && end>start && end*2*buses.length<=32e6,'Scene post needs a nonnegative, bounded timeline range');
    const classified=voices.map(row=>({...row,stem:row.bus ?? (
      row.stem==='music' ? 'music' : row.stem==='tracks' || row.stem==='spatial' && row.loop ? 'ambience' : 'effects')}));
    const cues=collect ? [] : undefined;
    const {stems,statistics}=sumVoices(classified,resolve,{start:0,end,sampleRate,gain,cues,parametric:P.audioParametric},buses);
    const assets=Object.fromEntries(Object.entries(post.assets ?? {}).map(([name,asset])=>[name,resolve(asset)]));
    const strips={...definitions}, premix=new Map();
    for (const [name,samples] of stems) {
      if (!statistics[name].voices) continue;
      premix.set(name,samples);
      strips[name]={...strips[name],clips:[{id:'scene',source:name}]};
    }
    const mixer={id:'scene-post',sampleRate,end:{samples:end},tail:'cut',output:'master',strips,taps,
      ...(post.map!==undefined && {map:post.map}),...(post.processors!==undefined && {processors:post.processors}),
      ...(post.peakPolicy!==undefined && {peakPolicy:post.peakPolicy})};
    return {mixer,assets,premix,statistics,cues};
  }
  function render(voices,resolve,{start,end,gain},selection) {
    const {mixer,assets,premix,statistics}=prepare(voices,resolve,{start,end,gain});
    const stage=P.mediaGraph.mixer.renderPremix(mixer,assets,premix);
    const slice=audio=>({...audio,samples:audio.samples.subarray(start*2,end*2)});
    const value=slice(stage.value), printed=Object.fromEntries(Object.entries(stage.taps).map(([name,sound])=>[name,slice(sound)]));
    const peak=audio=>{
      let max=0;
      for (const sample of audio.samples) max=Math.max(max,Math.abs(sample));
      return max/stage.report.headroom;
    };
    const report={sampleRate,channels:2,firstSample:start,endSample:end,frames:end-start,headroom:stage.report.headroom,
      peak:peak(value),stems:Object.fromEntries(Object.entries(printed).map(([name,sound])=>
        [name,{voices:statistics[name].voices,peak:peak(sound)}])),post:stage.report};
    if (selection) return {value:selection.name==='mix' ? value : printed[selection.name],report};
    const waves=Object.fromEntries(Object.entries({...printed,mix:value})
      .map(([name,sound])=>[name,WAV.encode(sound,{encoding:'pcm24'})]));
    return {waves,report};
  }
  return {render,prepare};
}
module.exports={createScenePost,buses,legacy};
