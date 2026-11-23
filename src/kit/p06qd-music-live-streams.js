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
      function addRange(source,first,stop) {
        for (let index=Math.floor(first/pageSize);index*pageSize<stop && selected.size<maxPages;index++)
          add(source,index);
      }
      for (const {source,first,active} of windows) {
        if (active && first<source.frames) add(source,Math.floor(first/pageSize));
      }
      for (const {source,first,frames,loop} of windows) {
        const end=loop?.end ?? source.frames;
        addRange(source,first,Math.min(end,first+frames));
        if (loop && first+frames>end)
          addRange(source,loop.start,Math.min(end,loop.start+first+frames-end));
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
    function reader(source,start,frames,loop) {
      let gap=false, gain=loop ? ramp : 0;
      const name=source.name;
      return (position,out)=>{
        const frame=start+position, index=Math.floor(frame/pageSize), n=frame%pageSize;
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
        const remaining=Math.min(frames-position,pageSize-n);
        const nextFrame=position+remaining<frames ? frame+remaining : loop ? start : null;
        const next=nextFrame!==null && (remaining>ramp || lookup(source,Math.floor(nextFrame/pageSize)));
        const fade=Math.min(gain,next ? ramp : remaining)/ramp;
        out[0]=left*source.left*fade;
        out[1]=right*source.right*fade;
        return null;
      };
    }
    function voice(source,first) {
      const read=reader(source,0,source.frames,false);
      return {first,last:first+source.frames,read:(at,out)=>read(at-first,out)};
    }
    function stemGroups(raw={}) {
      check(record(raw) && Object.keys(raw).length<=16,'Live score accepts up to 16 stem groups');
      const names=new Set();
      return Object.entries(raw).map(([name,group])=>{
        check(id(name) && fields(group,['frames','phaseFrames','parts']) && integer(group.frames,1,rate*3600) &&
          (group.phaseFrames===undefined || integer(group.phaseFrames,0,group.frames-1)) && record(group.parts) &&
          integer(Object.keys(group.parts).length,1,64),'Invalid live stem group '+name);
        const {frames,phaseFrames=0}=group;
        const parts=Object.entries(group.parts).map(([part,row])=>{
          check(id(part) && !names.has(part) && names.size<64 && fields(row,['stream','startFrame']),
            'Live stem parts need unique names (up to 64 parts)');
          const source=streams.get(row.stream), {startFrame:start=0}=row;
          check(source && integer(start,0,source.frames-frames),
            'Live stem '+part+' needs a stream containing the full loop range');
          names.add(part);
          return {part,source,start,end:start+frames,read:reader(source,start,frames,true)};
        });
        return {name,frames,phaseFrames,parts,position:frame=>(frame+phaseFrames)%frames};
      });
    }
    function prefetchStems(groups,frame,ahead,windows) {
      for (const group of groups) {
        const position=group.position(frame);
        for (const {source,start,end} of group.parts) {
          windows.push({source,first:start+position,frames:ahead+ramp,active:true,loop:{start,end}});
        }
      }
    }
    function profile() {
      return {pages:pages.size,ready:[...pages.values()].filter(row=>row.samples).length,
        pending:[...pages.values()].filter(row=>row.inflight).length,maxPages,pageSize,reads,failures,evicted};
    }
    return {streams,prefetch,voice,profile,stemGroups,prefetchStems};
  }
  P.musicLiveStreams=Object.freeze({open});
})(KIT.procedural);
