/* One scene clock and one retained mask model for the five paint effects. */
(function (K) {
  const P=K.procedural, {clamp}=K;
  const format='ink-studio/paint-effects-track', kinds=['boil','flow','wave','evaporate','throb'];
  const record=value=>K.world.data.record(value);
  const fields=(row,keys)=>record(row)&&Object.keys(row).every(key=>keys.includes(key));
  const range=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  const name=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(id);
  const ease=x=>{ const u=clamp(x,0,1); return u*u*(3-2*u); };
  const particlesId=(track,clip)=>'track-'+P.data.hash(track+'/'+clip).toString(16);

  function header(track,source) {
    if (!fields(track,['format','version','id','cues','clips','time']) || track.format!==format || track.version!==1 ||
        !name(track.id) || !Array.isArray(track.clips) || !range(track.clips.length,1,32) ||
        track.time!==undefined&&!range(track.time,0,60) ||
        track.cues!==undefined&&(!record(track.cues)||Object.keys(track.cues).length>128||
          Object.values(track.cues).some(n=>!range(n,0,60))))
      throw new TypeError('Use a version 1 paint effects track with a named list of up to 32 clips');
    const timeline=source.timeline && K.timeline.compile(source.timeline);
    const cues=new Map();
    for (const row of [...(timeline?.markers??[]),...(timeline?.events??[])]) {
      const key=[...row.path,row.id].join('/');
      cues.set(key,cues.has(key)&&cues.get(key)!==row.time?undefined:row.time);
    }
    for (const [id,time] of Object.entries(track.cues??{})) cues.set(id,time);
    function point(raw) {
      if (range(raw,0,60)) return raw;
      const {cue,offset=0}=typeof raw==='string'?{cue:raw}:raw??{};
      const time=cues.get(cue)+offset;
      if ((typeof raw!=='string'&&!fields(raw,['cue','offset'])) || !range(offset,-60,60)||!range(time,0,60))
        throw new RangeError('Unknown or out-of-range paint cue '+cue);
      return time;
    }
    const ids=new Set();
    const entries=Array.from(track.clips,row=>{
      if (!fields(row,['id','kind','painting','marks','range','fade','weight','after','mask','erasers','effect']) ||
          !name(row.id)||ids.has(row.id)||!kinds.includes(row.kind)||!name(row.painting)||!Array.isArray(row.marks)||
          !range(row.marks.length,1,128)||!Array.from(row.marks).every(name)||new Set(row.marks).size!==row.marks.length||
          !Array.isArray(row.range)||row.range.length!==2||!record(row.effect))
        throw new TypeError('A paint effects clip needs a unique ID, effect, painting, marks and cue range');
      ids.add(row.id);
      const start=point(row.range[0]),end=point(row.range[1]),duration=end-start;
      const {after='reset',fade=[0,0],weight=1}=row;
      if (!(duration>0)||!['reset','hold'].includes(after)||!Array.isArray(fade)||fade.length!==2||
          !Array.from(fade).every(n=>range(n,0,duration))||fade[0]+fade[1]>duration||
          after==='hold'&&fade[1]>0||!range(weight,0,1))
        throw new RangeError('Clip ranges need positive duration, bounded fades, weight and reset or hold');
      const placement=source.paintings3d?.find(item=>item.id===row.painting);
      const marks=Array.from(row.marks,id=>{
        const mark=placement?.painting?.marks?.find(item=>item.id===id);
        if (!mark || mark.enabled===false) throw new RangeError('Unknown or disabled paint effects mark '+row.painting+'/'+id);
        return mark;
      });
      const spatial=mask(row);
      return {row,start,end,duration,placement,marks,spatial,
        level(time) {
          if (time<start||time>=end&&after==='reset') return 0;
          return weight*(fade[0]?ease((time-start)/fade[0]):1)*(fade[1]?ease((end-time)/fade[1]):1);
        },
        local:time=>clamp(time-start,0,duration)};
    });
    return {entries,timeline,duration:Math.max(...entries.map(row=>row.end))};
  }

  function mask({mask,erasers}) {
    if (mask!==undefined&&!fields(mask,['points','radius','feather']))
      throw new TypeError('A paint effect mask needs XYZ points, radius and optional feather');
    const brush=mask&&P.channelEraser.surface([{...mask,id:'effects-mask',channels:['paint']}]);
    if (erasers!==undefined&&(!Array.isArray(erasers)||Array.from(erasers).some(row=>
      !fields(row,['id','points','radius','feather','strength','enabled']))))
      throw new TypeError('Paint effect erasers need named XYZ brush paths');
    const erase=P.channelEraser.surface(erasers?.map(row=>({...row,channels:['paint']})));
    return point=>(brush?1-brush.remaining('paint',point):1)*(erase?.remaining('paint',point)??1);
  }

  function paintSpace(source,placement,mark) {
    const graph=K.sceneGraph, frame=graph.transform(placement.transform), slot=mark.attachment?.slot;
    const host=mark.attachment?.kind==='surface'&&source.solids?.find(s=>s.id===placement.bindings?.[slot]);
    return host?graph.compose(K.diorama.solidFrames.rest(host),frame):frame;
  }

  function native(track,row) {
    const {kind,painting,marks,effect}=row, id=particlesId(track.id,row.id);
    const api=kind==='throb'?P.paintThrob:P.paintEvaporation;
    return {...effect,format:api.format,version:1,id,painting,marks};
  }

  function scene(source, time=0) {
    const track=source.paintEffects, graph=K.sceneGraph;
    if (track===undefined) return {spec:source,marks:new Map(),origins:new Map(),layers:[]};
    const {entries,timeline,duration}=header(track,source), at=track.time??time, edits=new Map(), layers=[], bindings=new Map();
    const reports=[];
    let playback=duration;
    for (const entry of entries) {
      const {row,placement,marks,spatial,start}=entry, {effect,kind}=row, level=entry.level(at), local=entry.local(at);
      const gain=point=>spatial(point)*level;
      reports.push({id:row.id,kind,range:[start,entry.end],time:local,weight:level});
      if (kind==='flow') {
        if (!fields(effect,['field','chart','speed','step','spacing','wrap','seam','edge','obstructions']))
          throw new TypeError('Invalid track flow settings');
        const {field,...plan}=effect;
        const asset=typeof field==='string' ? placement.painting.flowMaps?.[field] : field;
        if (!asset) throw new RangeError('Unknown paint track flow map '+field);
        const current=bindings.get(placement.id)??new Map(placement.painting.marks.map(mark=>[mark.id,[mark]]));
        const selected=marks.flatMap(mark=>current.get(mark.id)??[]);
        if (!selected.length) continue;
        const spaces=new Map(selected.map(mark=>[mark.id,paintSpace(source,placement,mark)]));
        const owner=new Map();
        for (const [id,rows] of current) for (const mark of rows) owner.set(mark.id,id);
        const input={...placement,painting:{...placement.painting,marks:[...current.values()].flat()}};
        const flow=P.paintFlow.prepare({...plan,marks:selected.map(mark=>mark.id)},asset,input,
          (mark,point)=>gain(graph.point(spaces.get(mark.id),point)));
        if (level&&local) {
          const {marks:moved,report}=flow.sample(local);
          const ids=new Map(report.flatMap(row=>row.fragments.map(fragment=>[fragment,owner.get(row.id)])));
          const result=new Map([...current.keys()].map(id=>[id,[]]));
          for (const mark of moved) result.get(ids.get(mark.id)??owner.get(mark.id)).push(mark);
          bindings.set(placement.id,result);
        }
        continue;
      }
      if (kind==='evaporate') {
        const sample=native(track,row), plan=P.paintEvaporation.prepare(sample,true);
        if (marks.some(mark=>{const {relief}=style(mark); return relief?.mode==='volume'&&relief.height<0;}))
          throw new RangeError('Evaporation clips need additive or surface paint');
        if (plan.end>entry.duration) throw new RangeError('Particle births must be inside clip '+row.id);
        if (row.after==='hold') playback=Math.max(playback,start+plan.end+plan.life);
        const removed=plan.removedAt(local);
        if (level&&removed) {
          for (const mark of marks) push(mark,{kind,gain,removed});
        }
        layers.push({plan,particles:sample.particles,start,weight:(time,point)=>entry.level(track.time??time)*spatial(point),
          ...(track.time!==undefined&&{time:track.time})});
        continue;
      }
      if (kind==='boil') {
        const plan=P.paintBoil.prepare(effect);
        if (level&&plan.active) for (const mark of marks) push(mark,{kind,plan,gain,drawing:P.paintBoil.state(plan,local).drawing});
        continue;
      }
      if (kind==='wave') {
        const {mode,...settings}=effect, target={mode:mode??'pigment',painting:row.painting,marks:row.marks};
        if (settings.time!==undefined) throw new TypeError('Wave clips use the track clock');
        const plan=P.paintWave.prepare({...settings,format:P.paintWave.format,version:1,id:row.id,target});
        for (const mark of marks) {
          const {relief,finish,looseness}=style(mark);
          const attached=mark.attachment?.kind==='surface'&&mark.attachment.snap?.mode==='surface';
          if (target.mode==='raised' ? !(relief?.mode==='volume'&&relief.height>0) :
            !attached||relief?.mode==='volume'||!relief&&!finish&&looseness?.silhouetteAllowance!==0)
            throw new RangeError('Wave clip needs compatible pigment or raised relief on '+mark.id);
          if (level) push(mark,{kind,plan,map:plan.frame(local),gain:point=>gain(graph.point(paintSpace(source,placement,mark),point))});
        }
        continue;
      }
      const values=P.paintThrob.prepare(native(track,row),timeline).sample(local).channels;
      for (const mark of marks) {
        const {relief,finish}=style(mark);
        if (values.height!==undefined&&(!relief||relief.mode==='flat') ||
            values.emission!==undefined&&!finish?.emission ||
            values.coverage!==undefined&&relief?.mode==='volume'&&relief.height<0)
          throw new RangeError('Throb clip needs compatible relief, finish emission or additive paint on '+mark.id);
        if (level) push(mark,{kind,values,gain});
      }
      function style(mark) { return {...placement.painting.presets?.[mark.preset],...mark}; }
      function push(mark,data) {
        const id='paint.'+row.painting+'.'+mark.id;
        if (!edits.has(id)) edits.set(id,[]);
        edits.get(id).push(data);
      }
    }
    const origins=new Map();
    const paintings=source.paintings3d?.map(placement=>{
      const map=bindings.get(placement.id);
      if (!map) return placement;
      const prefix='paint.'+placement.id+'.';
      const marks=[...map].flatMap(([id,rows])=>rows.map(mark=>{
        origins.set(prefix+mark.id,prefix+id);
        return mark;
      }));
      const slots=new Set(marks.map(mark=>mark.attachment?.slot));
      const slotsUsed=Object.fromEntries(Object.entries(placement.bindings??{}).filter(([slot])=>slots.has(slot)));
      return {...placement,bindings:slotsUsed,painting:{...placement.painting,marks}};
    });
    return {spec:bindings.size?{...source,paintings3d:paintings}:source,marks:edits,origins,layers,reports,duration:playback,
      time:at,animated:track.time===undefined};
  }

  P.paintEffects=Object.freeze({format,header,native,scene});
})(KIT);
