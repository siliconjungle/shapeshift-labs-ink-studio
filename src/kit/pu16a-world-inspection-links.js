/* Share event identity across inspectors without changing native checkpoints. */
(function(K){
  const W=K.world,{id,check}=W.data;
  const native='ink:beat:', projected='ink:public-beat:';
  const identity=row=>row&&[row.world,row.branch,row.id].every(id);
  function parse(value) {
    if(typeof value!=='string')return;
    const prefix=value.startsWith(native)?native:value.startsWith(projected)?projected:null;
    if(!prefix)return;
    const parts=value.slice(prefix.length).split('/');
    if(parts.length!==3)return;
    const [world,branch,event]=parts, result={world,branch,id:event,projected:prefix===projected};
    return identity(result)?result:undefined;
  }
  function make(row,publicView=false) {
    check(identity(row),'Inspection link needs a world, branch and event ID');
    return (publicView?projected:native)+[row.world,row.branch,row.id].join('/');
  }
  function identify(row,publicView=false) {
    if(!identity(row))return;
    if(row.beatId===undefined)return make(row,publicView);
    const ref=parse(row.beatId);
    check(ref&&(!publicView||ref.projected)&&make(row,ref.projected)===row.beatId,'Beat ID differs from its event identity');
    return row.beatId;
  }
  const isPublic=value=>['spectator','faction'].includes(value?.visibility?.kind);
  function references(value) {
    const rows=value?.format==='ink-studio/event-log'?value.entries:
      value?.format==='ink-studio/world-graph-frame'&&Array.isArray(value.events)?value.events.map(event=>({event})):undefined;
    const publicView=isPublic(value);
    const links=new Map();
    for(const row of Array.isArray(rows)?rows:[]){
      const {event,at}=row??{};
      if(event?.version!==1)continue;
      const beatId=identify(event,publicView);
      if(beatId&&!links.has(beatId))links.set(beatId,{beatId,...(Number.isSafeInteger(event.tick)&&{tick:event.tick}),
        ...(id(event.kind)&&{kind:event.kind}),...(at!==undefined&&{at})});
    }
    return [...links.values()];
  }
  W.inspectionLinks=Object.freeze({parse,make,identify,references,isPublic});
})(KIT);
