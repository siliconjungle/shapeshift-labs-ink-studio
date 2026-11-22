/* A latest-state handoff with effects only on contiguous live updates. */
(function(K) {
  const W=K.world,P=K.procedural,{check,id,record,copy}=W.data,{freeze}=P.data;
  const format='ink-studio/live-snapshot', maxEffects=10000;
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const validCursor=value=>record(value)&&Object.keys(value).length===3&&
    id(value.stream)&&integer(value.revision)&&integer(value.tick);
  const equal=(a,b)=>a===b||Boolean(a&&b&&a.stream===b.stream&&a.revision===b.revision&&a.tick===b.tick);
  const next=(a,b)=>a&&b&&a.stream===b.stream&&b.revision===a.revision+1&&b.tick===a.tick+1;
  const frameOK=P.graphTypes.validator('worldFrame');

  function effectsOK(effects,state) {
    return Array.isArray(effects)&&effects.length<=maxEffects&&effects.every(row=>record(row)&&
      row.version===1&&W.committedEvents.eventId(row.id)&&id(row.kind)&&id(row.system)&&
      row.tick===state.tick&&W.committedEvents.tickOf(row.id)===row.tick&&
      row.world===state.world&&row.branch===state.branch&&record(row.payload))&&
      new Set(effects.map(row=>row.id)).size===effects.length;
  }

  function validPacket(packet) {
    if (!record(packet)||packet.format!==format||packet.version!==1||!validCursor(packet.cursor)||
      packet.base!==null&&!validCursor(packet.base)) return false;
    const {kind,base,cursor,state,effects,reason}=packet;
    if (kind==='idle') return equal(base,cursor)&&state===undefined&&effects===undefined&&reason===undefined;
    if (!state||!frameOK(state)||state.tick!==cursor.tick||state.events.length||
      state.eventFrom!==state.tick+1||!Array.isArray(effects)||effects.length>maxEffects) return false;
    if (kind==='snapshot') return effects.length===0&&(reason===undefined||reason===
      (base===null?'join':base.stream===cursor.stream?'gap':'stream-changed'));
    return kind==='live'&&reason===undefined&&next(base,cursor)&&effectsOK(effects,state);
  }

  function create({stream}={}) {
    check(id(stream),'Live snapshots need a stream ID');
    let head, previous;
    function publish(frame) {
      check(frame&&frameOK(frame)&&(!head||frame.tick>head.cursor.tick),'Live snapshots need increasing committed ticks');
      const cursor={stream,revision:head?head.cursor.revision+1:0,tick:frame.tick};
      const {events,...rest}=frame;
      const state=freeze({...copy(rest),eventFrom:frame.tick+1,events:[]});
      const effects=freeze(copy(events));
      const candidate={format,version:1,kind:'live',base:head?.cursor??null,cursor,state,effects};
      check(effectsOK(effects,state),'Invalid committed live effects');
      previous=head?.cursor;
      head=freeze(candidate);
      return head.cursor;
    }
    function pull(after=null) {
      check(after===null||validCursor(after),'Invalid live cursor');
      check(head,'Live stream has no committed snapshot');
      const {cursor,state}=head;
      if (equal(cursor,after)) return freeze({format,version:1,kind:'idle',base:cursor,cursor});
      if (equal(previous,after)&&next(after,cursor)) return head;
      const reason=after===null?'join':after.stream!==stream?'stream-changed':'gap';
      return freeze({format,version:1,kind:'snapshot',base:after===null?null:copy(after),cursor,state,effects:[],reason});
    }
    return Object.freeze({publish,pull,cursor:()=>head?.cursor??null});
  }

  function receiver() {
    let cursor=null, state=null, origin;
    function result(status,reason) {
      return {value:state,report:{status,cursor,...(reason&&{reason}),effects:0}};
    }
    function apply(packet) {
      if (packet===null) return result(cursor?'waiting':'missing');
      check(validPacket(packet),'Invalid live snapshot packet');
      const {base,kind}=packet, target=packet.cursor;
      if (equal(cursor,target)) return result(kind==='idle'?'idle':'duplicate');
      if (cursor?.stream===target.stream&&target.revision<=cursor.revision) return result('stale');
      if (kind==='idle'||!equal(cursor,base)) return result('resync','baseline differs from applied cursor');
      if (cursor?.stream===target.stream&&target.tick<=cursor.tick)
        return result('stale','tick did not advance');
      if (cursor?.stream!==target.stream||state.branch!==packet.state.branch) origin={};
      state=freeze(copy(packet.state));
      cursor=freeze(copy(target));
      const effects=packet.effects;
      const value=effects.length?freeze({...state,eventFrom:state.tick,events:copy(effects)}):state;
      W.graphPorts.tagFrame(state,origin);
      if(value!==state)W.graphPorts.tagFrame(value,origin);
      return {value,report:{status:kind,cursor,effects:effects.length,...(packet.reason&&{reason:packet.reason})}};
    }
    return Object.freeze({apply,cursor:()=>cursor,clear(){cursor=state=null;origin=undefined;}});
  }

  W.liveSnapshots=Object.freeze({format,create,receiver,validPacket,validCursor,equal});
  P.graph.operations=Object.freeze({...P.graph.operations,'sim.liveWorld':Object.freeze({
    description:'Apply live world snapshots and expose effects only for newly received contiguous updates.',
    inputs:{packet:{type:'liveSnapshot',default:null}},outputs:{value:'worldFrame',report:'record'},time:true,
    instantiate(){
      const mirror=receiver(), run=({packet})=>mirror.apply(packet);
      run.clear=mirror.clear;
      return run;
    }
  })});
})(KIT);
