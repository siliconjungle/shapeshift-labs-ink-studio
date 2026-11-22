/* Short listening references and saved decisions are searchable by authored intent. */
(function (P) {
  const {fields,finite,integer,id,check,record}=P.musicInstruments;
  const clipFormat='ink-studio/critique-reference', decisionFormat='ink-studio/critique-decision';
  const prose=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
  const words=value=>value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalized=value=>words(value).join(' ');
  function audioHash(samples, transform=value=>value) {
    const point=new DataView(new ArrayBuffer(8));
    let hash=2166136261;
    for (const sample of samples) {
      point.setFloat64(0,transform(sample),true);
      hash=Math.imul(hash ^ point.getUint32(0,true),16777619);
      hash=Math.imul(hash ^ point.getUint32(4,true),16777619);
    }
    return (hash>>>0).toString(36);
  }
  const excerptHash=samples=>audioHash(samples,value=>Math.min(8388607,Math.round(value*8388608)) || 0);
  function assetSignature(assets) {
    return Object.keys(assets).sort().map(name=>{
      const {samples,channels,sampleRate}=P.mediaGraph.audio(assets[name]);
      return [name,sampleRate,channels,samples.length,audioHash(samples)];
    });
  }

  function tags(value) {
    check(Array.isArray(value) && value.length<=16 && Array.from(value).every(tag=>
      prose(tag,80) && words(tag).length>0) && new Set(value.map(normalized)).size===value.length,
    'Use up to sixteen distinct descriptive tags');
    return value.map(tag=>tag.trim());
  }
  function tag(input,settings) {
    const audio=P.mediaGraph.audio(input), {samples,sampleRate,channels}=audio, frames=samples.length/channels;
    check(fields(settings,['id','title','source','note','tags','firstSample','endSample']) && id(settings.id) &&
      prose(settings.title,160) && prose(settings.source,500) && prose(settings.note,1500) && channels<=2 &&
      integer(sampleRate,8000,96000),'Describe what to listen for in a short mono or stereo reference');
    const labels=tags(settings.tags ?? []), firstSample=settings.firstSample ?? 0, endSample=settings.endSample ?? frames;
    check(integer(firstSample,0,frames-1) && integer(endSample,firstSample+1,frames) &&
      (endSample-firstSample)/sampleRate<=30,'Choose an exact reference range of up to thirty seconds');
    const slice=samples.slice(firstSample*channels,endSample*channels);
    const reference={format:clipFormat,version:1,id:settings.id,title:settings.title,source:settings.source,note:settings.note,
      sourceAudioHash:audioHash(slice),
      tags:labels,range:{firstSample,endSample,start:firstSample/sampleRate,end:endSample/sampleRate,sampleRate,channels}};
    return {reference,value:{...audio,samples:slice}};
  }
  function search(entries,options={}) {
    check(Array.isArray(entries) && entries.length<=512 && fields(options,['text','tags','kind','limit']) &&
      (options.text===undefined || prose(options.text,160)) &&
      (options.kind===undefined || ['clip','decision'].includes(options.kind)) && integer(options.limit ?? 12,1,64),
    'Invalid listening reference search');
    const query=words(options.text ?? ''), required=tags(options.tags ?? []).map(normalized);
    const seen=new Set();
    const hits=Array.from(entries,entry=>{
      check(record(entry) && [clipFormat,decisionFormat].includes(entry.format) && entry.version===1 &&
        id(entry.id) && !seen.has(entry.id) && prose(entry.title,160),'Reference needs a unique ID, kind and title');
      seen.add(entry.id);
      const labels=tags(entry.tags ?? []), kind=entry.format===clipFormat ? 'clip' : 'decision';
      const note=kind==='clip' ? entry.note : entry.reason;
      check(prose(note,2000),'Reference needs its listening note or decision reason');
      if ((options.kind && kind!==options.kind) || !required.every(tag=>labels.map(normalized).includes(tag))) return null;
      const tagText=new Set(labels.flatMap(words)), titleText=new Set(words(entry.title));
      const description=new Set(words(note));
      if (!query.every(word=>tagText.has(word) || titleText.has(word) || description.has(word))) return null;
      const score=query.reduce((score,word)=>score+(tagText.has(word) ? 3 : titleText.has(word) ? 2 : 1),0);
      return {id:entry.id,kind,score,entry};
    }).filter(Boolean);
    return hits.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,options.limit ?? 12);
  }
  P.musicCritiqueReferences=Object.freeze({tag,search,tags,prose,audioHash,excerptHash,assetSignature,decisionFormat});
})(KIT.procedural);
