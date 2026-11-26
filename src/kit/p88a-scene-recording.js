/* Timed headless manipulation capture using native timeline tracks. */
(function (K) {
  const planFormat='ink-studio/scene-recording-plan', takeFormat='ink-studio/scene-recording-take';
  const planKeys=['format','version','id','channels','from','to','countIn','mode','punch'];
  const commands=['poses','camera','effects'];
  const maxPackets=10000, maxKeys=8192;
  const fields=(row,keys)=>K.world.data.record(row)&&Object.keys(row).every(key=>keys.includes(key));
  const range=(value,lo,hi)=>Number.isFinite(value)&&value>=lo&&value<=hi;
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const at=seconds=>Math.round(seconds*1e9)/1e9;
  const key=target=>JSON.stringify(target);
  const copy=value=>K.procedural.data.clone(value);
  const path=value=>K.world.data.selector(value).map(String);

  function bind(scene,channel) {
    function binding(target) {
      const result=commands.includes(target[0])&&channel(target);
      if (!result) throw new RangeError('Unknown scene recording channel /'+target.join('/'));
      return result;
    }
    function validate({size,mode,validate},value) {
      if (!(
        (size ? Array.isArray(value)&&value.length===size&&Array.from(value).every(Number.isFinite) :
          mode==='step'||Number.isFinite(value)&&(mode!=='positive'||value>0))&&(!validate||validate(value))
      )) throw new TypeError('Value does not match the armed timeline channel');
    }
    function plan(raw) {
      if (!fields(raw,planKeys)||raw.format!==planFormat||raw.version!==1||!id(raw.id)||
          !Array.isArray(raw.channels)||!range(raw.channels.length,1,64))
        throw new TypeError('Use a version 1 scene recording plan with an ID and armed channels');
      const {from=0,to,countIn=0,mode='overdub',punch}=raw;
      if (!range(from,0,3600)||!range(to,from,3600)||at(to-from)<.001||!range(countIn,0,60)||
          !['overdub','punch'].includes(mode)||
          (mode==='punch'? !Array.isArray(punch)||punch.length!==2||!Array.from(punch).every(n=>range(n,from,to))||
            at(punch[1]-punch[0])<.001:punch!==undefined))
        throw new RangeError('Choose a rolling interval, count-in and optional punch range inside the interval');
      const channels=Array.from(raw.channels,path), keys=channels.map(key);
      if (new Set(keys).size!==keys.length) throw new RangeError('Arm a channel only once');
      const selected=new Map(channels.map((target,i)=>[keys[i],{target,schema:binding(target),keys:[]}]));
      return {id:raw.id,from:at(from),to:at(to),countIn:at(countIn),mode,punch:punch?.map(at),channels,selected};
    }

    function capture(raw) {
      const prepared=plan(raw), {id,from,to,countIn,mode,punch,selected,channels}=prepared;
      const [start,end]=punch??[from,to];
      const ignored={countIn:0,outside:0,unarmed:0}, stats={packets:0,keys:0,coalesced:0,ignored};
      let last=-Infinity;
      function push(packet,elapsed) {
        if (!fields(packet,['changes'])||!Array.isArray(packet.changes)||!range(packet.changes.length,1,64)||
            !range(elapsed,0,1e6)||elapsed<last)
          throw new TypeError('Send ordered scene changes on a nonnegative elapsed clock');
        if (stats.packets>=maxPackets) throw new RangeError('Scene recording exceeds 10,000 input packets');
        stats.packets++;
        last=elapsed;
        const time=at(from+elapsed-countIn);
        const captureTime=at(elapsed)>=countIn&&time>=start&&time<end;
        if (!captureTime) {
          ignored[at(elapsed)<countIn?'countIn':'outside']+=packet.changes.length;
          return;
        }
        for (const change of packet.changes) {
          if (!fields(change,['target','value'])||!Object.hasOwn(change,'value'))
            throw new TypeError('Each manipulation needs a target path and value');
          const target=path(change.target), armed=selected.get(key(target));
          if (!armed) { ignored.unarmed++; continue; }
          validate(armed.schema,change.value);
          const row={time,value:copy(change.value)}, previous=armed.keys.at(-1);
          if (previous?.time===time) { armed.keys[armed.keys.length-1]=row; stats.coalesced++; }
          else {
            if (stats.keys>=maxKeys) throw new RangeError('Scene recording exceeds 8,192 keys');
            armed.keys.push(row);
            stats.keys++;
          }
        }
      }
      function finish() {
        const tracks=[...selected.values()].filter(row=>row.keys.length).map(({target,keys})=>({target,keys}));
        if (!tracks.length) throw new RangeError('The rolling window captured no armed scene changes');
        const take={format:takeFormat,version:1,id,scene:scene.id,from,to,countIn,mode,channels,
          ...(punch&&{punch}),tracks};
        apply(take);
        return {take:copy(take),stats:copy(stats)};
      }
      return {push,finish,clock:{from,to,countIn,mode,...(punch&&{punch})}};
    }

    function apply(take) {
      if (!fields(take,[...planKeys,'scene','tracks'])||take.format!==takeFormat||take.scene!==scene.id||
          !Array.isArray(take.tracks)||!range(take.tracks.length,1,64))
        throw new TypeError('Use a scene recording take for this scene');
      const {tracks,scene:_,...header}=take;
      const {id,mode,from,to,punch,selected}=plan({...header,format:planFormat});
      const [start,end]=punch??[from,to], windows=new Map(), touched=new Set();
      let samples=0;
      for (const row of tracks) {
        if (!fields(row,['target','keys'])||!Array.isArray(row.keys)||!row.keys.length||(samples+=row.keys.length)>maxKeys)
          throw new RangeError('A take needs up to 8,192 captured keys with armed targets');
        const target=path(row.target), name=key(target), binding=selected.get(name);
        if (!binding||touched.has(name)) throw new RangeError('A take track must match one distinct armed channel');
        touched.add(name);
        let previous=-Infinity;
        const keys=Array.from(row.keys,input=>{
          if (!fields(input,['time','value'])||!range(input.time,start,end)||input.time>=end||input.time<=previous||
              !Object.hasOwn(input,'value')) throw new RangeError('Captured keys must increase inside the recording window');
          previous=input.time;
          validate(binding.schema,input.value);
          return input;
        });
        const meet=mode==='punch'?start:keys[0].time;
        if (!windows.has(meet)) windows.set(meet,[]);
        windows.get(meet).push({target,keys:keys.map(({time,value})=>({time:time-meet,value:copy(value),
          ease:binding.schema.mode==='step'?'step':'linear'}))});
      }

      const base=scene.timeline??{}, sequences={...base.sequences}, clips=(base.clips??[]).slice();
      const summary=[];
      let index=0, required=0;
      for (const [time,tracks] of windows) {
        const name='record-'+id+'-'+(++index), duration=end-time;
        if (Object.hasOwn(sequences,name)||clips.some(clip=>clip.id===name)||Object.hasOwn(base.cueTracks??{},name))
          throw new RangeError('Recording ID is already in use: '+id);
        sequences[name]={duration,tracks};
        clips.push({id:name,sequence:name,time});
        summary.push({clip:name,from:time,to:end,tracks:tracks.map(row=>row.target)});
        required=Math.max(required,time+duration);
      }
      const duration=K.timeline.compile(base,{channel}).duration;
      const timeline={...base,sequences,clips,...(base.duration!==undefined&&required>duration&&{duration:required})};
      K.timeline.compile(timeline,{channel});
      return {scene:{...scene,timeline},clips:summary};
    }

    return Object.freeze({capture,apply});
  }

  K.sceneRecording=Object.freeze({planFormat,takeFormat,bind});
})(KIT);
