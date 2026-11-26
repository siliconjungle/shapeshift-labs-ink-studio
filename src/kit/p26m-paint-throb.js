/* Independent animation lanes for retained paint. */
(function (K) {
  const P=K.procedural, format='ink-studio/paint-throb';
  const channels=Object.freeze({width:[.05,4],height:[.05,4],coverage:[0,1],emission:[0,8]});
  const fields=(row,keys)=>K.world.data.record(row) && Object.keys(row).every(key=>keys.includes(key));
  const range=(n,lo,hi)=>Number.isFinite(n) && n>=lo && n<=hi;
  const name=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const supported=Object.keys(channels), audioKeys=['type','file','measure','channel','rate','gain','offset','envelope'];

  function audioOptions(row) {
    const {measure='rms',channel='all',rate=48,gain=1,offset=0}=row;
    if (!fields(row,audioKeys) || !['rms','peak'].includes(measure) ||
        !['all','mix'].includes(channel) && (!Number.isInteger(channel) || !range(channel,0,63)) ||
        !Number.isInteger(rate) || !range(rate,1,120) || !range(gain,0,64) || !range(offset,-600,600) ||
        row.file!==undefined && (typeof row.file!=='string' || !/\.wav$/i.test(row.file) || row.file.length>240))
      throw new RangeError('An audio driver needs WAV, RMS or peak, channel selection, envelope rate, gain and offset');
    return {measure,channel,rate,gain,offset};
  }

  function audioEnvelope(input,row) {
    const {measure,channel,rate}=audioOptions(row);
    const duration=input.samples.length/(input.sampleRate*input.channels), count=Math.ceil(duration*rate);
    if (!range(duration,.000001,600) || count>14400) throw new RangeError('Audio exceeds the envelope duration or frame budget');
    const values=P.mediaGraph.series(input,{fps:rate,count,channel}).map(frame=>K.clamp(frame[measure],0,1));
    return {duration,values};
  }

  function header(raw) {
    if (!fields(raw,['format','version','id','painting','marks','drivers','channels']) ||
        raw.format!==format || raw.version!==1 || !name(raw.id) || !name(raw.painting) ||
        !Array.isArray(raw.marks) || !range(raw.marks.length,1,128) || !Array.from(raw.marks).every(name) ||
        new Set(raw.marks).size!==raw.marks.length ||
        !K.world.data.record(raw.drivers) || !range(Object.keys(raw.drivers).length,1,8) || !Object.keys(raw.drivers).every(name) ||
        !fields(raw.channels,supported) || !Object.keys(raw.channels).length)
      throw new TypeError('Use a version 1 paint throb plan with named drivers, channels and selected marks');
  }

  function bake(raw,readAudio) {
    header(raw);
    return {...raw,drivers:Object.fromEntries(Object.entries(raw.drivers).map(([id,row])=>{
      if (row?.type!=='audio' || row.envelope!==undefined) return [id,row];
      audioOptions(row);
      if (!row.file) throw new TypeError('An unbaked audio driver needs a WAV file');
      return [id,{...row,envelope:audioEnvelope(readAudio(row.file),row)}];
    }))};
  }

  function prepare(raw, timeline) {
    header(raw);
    const drivers=new Map();
    for (const [id,row] of Object.entries(raw.drivers)) {
      if (row?.type==='oscillator') {
        const {frequency=1,phase=0,shape='sine'}=row;
        if (!fields(row,['type','frequency','phase','shape']) || !range(frequency,.01,120) ||
            !range(phase,-100,100) || !['sine','triangle'].includes(shape))
          throw new RangeError('An oscillator needs frequency, phase in turns and a sine or triangle shape');
        drivers.set(id,{duration:1/frequency,sample(time){
          const cycle=time*frequency+phase, turn=cycle-Math.floor(cycle);
          return shape==='sine' ? .5-.5*Math.cos(2*Math.PI*turn) : 1-Math.abs(2*turn-1);
        }});
      } else if (row?.type==='cue') {
        if (!fields(row,['type','timeline','cues','keys','duration']) ||
            row.timeline!==undefined && typeof row.timeline!=='boolean' ||
            row.timeline && !timeline || row.cues!==undefined && !K.world.data.record(row.cues) ||
            !Array.isArray(row.keys) || !Array.from(row.keys).every(key=>range(key?.value,0,1)))
          throw new TypeError('A cue driver needs a cue track with values from 0 to 1');
        const duration=row.duration??(row.timeline?timeline.duration:undefined), names=new Map();
        if (row.timeline) for (const cue of [...timeline.markers,...timeline.events]) {
          const key=[...cue.path,cue.id].join('/');
          if (names.has(key) && names.get(key)!==cue.time) names.set(key,undefined);
          else names.set(key,cue.time);
        }
        const cues=Object.fromEntries(names);
        const assigned=Object.fromEntries(row.keys.filter(key=>key.cue!==undefined && Object.hasOwn(cues,key.cue))
          .map(key=>[key.cue,cues[key.cue]]));
        const track=P.animationGraph.cueTrack({duration,cues:{...assigned,...row.cues},keys:row.keys});
        drivers.set(id,{duration,sample:track.sample});
      } else if (row?.type==='audio') {
        const {offset,gain,rate}=audioOptions(row), {envelope}=row;
        if (!fields(envelope,['duration','values']) || !range(envelope.duration,.000001,600) ||
            !Array.isArray(envelope.values) || !range(envelope.values.length,1,14400) ||
            envelope.values.length!==Math.ceil(envelope.duration*rate) || !Array.from(envelope.values).every(n=>range(n,0,1)))
          throw new RangeError('An audio driver needs a baked envelope. Run paint-throb apply with its WAV file.');
        drivers.set(id,{duration:Math.max(0,offset+envelope.duration),sample(time){
          const local=time-offset;
          if (local<0 || local>=envelope.duration) return 0;
          const x=K.clamp(local*rate-.5,0,envelope.values.length-1), i=Math.floor(x);
          const level=K.mix(envelope.values[i],envelope.values[Math.min(i+1,envelope.values.length-1)],x-i);
          return K.clamp(level*gain,0,1);
        }});
      } else throw new TypeError('Choose a cue, oscillator or audio driver for '+id);
    }
    for (const [channel,lane] of Object.entries(raw.channels)) {
      if (!fields(lane,['driver','range']) || !drivers.has(lane.driver) || !Array.isArray(lane.range) ||
          lane.range.length!==2 || !Array.from(lane.range).every(n=>range(n,...channels[channel])))
        throw new RangeError('Invalid '+channel+' lane. Choose a driver and low/high multipliers in '+channels[channel].join('–'));
    }
    const used=[...new Set(Object.values(raw.channels).map(row=>row.driver))];
    return {duration:Math.max(...used.map(id=>drivers.get(id).duration)),sample(time){
      const values=Object.fromEntries(used.map(id=>[id,drivers.get(id).sample(time)]));
      return {drivers:values,channels:Object.fromEntries(Object.entries(raw.channels).map(([name,lane])=>
        [name,K.mix(...lane.range,values[lane.driver])]))};
    }};
  }

  function scene(source,time=0) {
    const targets=new Map();
    if (source.paintThrobs===undefined) return {targets};
    if (!Array.isArray(source.paintThrobs) || source.paintThrobs.length>32)
      throw new TypeError('A scene supports up to 32 paint throbs');
    const rows=source.paintThrobs, ids=new Set();
    const needsTimeline=rows.some(row=>Object.values(row?.drivers??{}).some(driver=>driver?.type==='cue' && driver.timeline===true));
    const timeline=needsTimeline && source.timeline!==undefined ? K.timeline.compile(source.timeline) : undefined;
    const plans=rows.map(row=>{
      const plan=prepare(row,timeline);
      if (ids.has(row.id)) throw new RangeError('Duplicate paint throb '+row.id);
      ids.add(row.id);
      return {row,plan};
    });
    const samples=at=>plans.map(({row,plan})=>({id:row.id,painting:row.painting,marks:row.marks,...plan.sample(at)}));
    const reports=samples(time);
    for (const {painting,marks,channels:values} of reports) {
      const placement=source.paintings3d?.find(row=>row.id===painting);
      for (const mark of marks) {
        const authored=placement?.painting?.marks?.find(row=>row.id===mark), id='paint.'+painting+'.'+mark;
        if (!authored || authored.enabled===false) throw new RangeError('Paint throb needs an enabled mark '+id);
        const prior=targets.get(id)??{};
        if (Object.keys(values).some(name=>Object.hasOwn(prior,name)))
          throw new RangeError('Assign each paint throb channel once on '+id);
        targets.set(id,{...prior,...values});
      }
    }
    const at=time=>JSON.stringify(samples(time).map(row=>row.channels));
    return {targets,reports,at,key:at(time),duration:Math.max(0,...plans.map(row=>row.plan.duration))};
  }

  P.paintThrob=Object.freeze({format,bake,prepare,scene});
})(KIT);
