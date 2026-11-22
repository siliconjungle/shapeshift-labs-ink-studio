/* Bounded, provider-owned I/O for PCM used by a live score. */
(function (P) {
  const {record,fields,id,check,integer,finite,db}=P.musicInstruments;
  function open(rate,raw={},readPage,pageSize=2048,maxPages=64) {
    check(record(raw) && Object.keys(raw).length<=128 && integer(pageSize,256,16384) &&
      integer(maxPages,2,256) && (!Object.keys(raw).length || typeof readPage==='function'),
    'Live PCM streams need a page reader and a bounded page cache');
    const streams=new Map(Object.entries(raw).map(([name,meta])=>{
      check(id(name) && fields(meta,['frames','sampleRate','channels','gain','pan','send','priority','foreground']) &&
        meta.sampleRate===rate && integer(meta.frames,1,rate*3600) && integer(meta.channels,1,2) &&
        finite(meta.gain ?? 0,-60,12) && finite(meta.pan ?? 0,-1,1) && finite(meta.send ?? 0,0,1) &&
        integer(meta.priority ?? 0,-100,100) && typeof (meta.foreground ?? false)==='boolean',
      'Invalid live PCM stream '+name+' (use the engine sample rate)');
      const pan=meta.pan ?? 0, gain=db(meta.gain ?? 0);
      return [name,{...meta,name,left:gain*Math.sqrt((1-pan)/2),right:gain*Math.sqrt((1+pan)/2),
        send:meta.send ?? 0,priority:meta.priority ?? 0,foreground:meta.foreground ?? false}];
    }));
    const pages=new Map();
    let touched=0, reads=0, failures=0, evicted=0;
    const key=(source,index)=>source.name+'/'+index;
    const lookup=(source,index)=>pages.get(key(source,index))?.samples;
    function prefetch(windows) {
      const selected=new Map();
      const add=(source,index)=>{if (selected.size<maxPages) selected.set(key(source,index),{source,index});};
      for (const {source,first,active} of windows) {
        if (active && first<source.frames) add(source,Math.floor(first/pageSize));
      }
      for (const {source,first,frames} of windows) {
        const stop=Math.min(source.frames,first+frames);
        for (let index=Math.floor(first/pageSize);index*pageSize<stop && selected.size<maxPages;index++) add(source,index);
        if (selected.size===maxPages) break;
      }
      const jobs=[];
      for (const [name,{source,index}] of selected) {
        let page=pages.get(name);
        if (!page) {
          if (pages.size===maxPages) {
            const discard=[...pages].filter(([candidate,row])=>!selected.has(candidate) && !row.inflight)
              .sort((a,b)=>a[1].used-b[1].used)[0];
            if (!discard) continue;
            pages.delete(discard[0]);
            evicted++;
          }
          page={used:++touched};
          pages.set(name,page);
          const first=index*pageSize, count=Math.min(pageSize,source.frames-first);
          reads++;
          page.inflight=Promise.resolve().then(()=>readPage(source.name,first,count)).then(samples=>{
            check(samples instanceof Float32Array && samples.length===count*source.channels &&
              samples.every(Number.isFinite),'Live PCM reader returned an invalid page');
            page.samples=new Float32Array(samples);
          }).catch(()=>{
            failures++;
            pages.delete(name);
          }).finally(()=>{page.inflight=null;});
        }
        page.used=++touched;
        if (page.inflight) jobs.push(page.inflight);
      }
      return Promise.all(jobs).then(()=>profile());
    }
    const ramp=Math.max(1,Math.round(rate*.004));
    function voice(source,first) {
      let gap=false, gain=0;
      const name=source.name;
      return {first,last:first+source.frames,read(at,out) {
        const frame=at-first, index=Math.floor(frame/pageSize), n=frame%pageSize;
        const data=lookup(source,index);
        if (!data) {
          const missing=!gap;
          out[0]=out[1]=0;
          gain=0;
          gap=true;
          return missing ? {name,frame} : null;
        }
        gap=false;
        gain=Math.min(ramp,gain+1);
        const left=data[n*source.channels], right=data[n*source.channels+source.channels-1];
        const remaining=Math.min(source.frames-frame,pageSize-n);
        const next=frame+remaining<source.frames && (remaining>ramp || lookup(source,index+1));
        const fade=Math.min(gain,next ? ramp : remaining)/ramp;
        out[0]=left*source.left*fade;
        out[1]=right*source.right*fade;
        return null;
      }};
    }
    function profile() {
      return {pages:pages.size,ready:[...pages.values()].filter(row=>row.samples).length,
        pending:[...pages.values()].filter(row=>row.inflight).length,maxPages,pageSize,reads,failures,evicted};
    }
    return {streams,prefetch,voice,profile};
  }
  P.musicLiveStreams=Object.freeze({open});
})(KIT.procedural);
