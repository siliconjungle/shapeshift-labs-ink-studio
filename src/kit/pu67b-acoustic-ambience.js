/* Convert the world heard at a listener into replayable acoustic bed levels. */
(function (K) {
  const W=K.world, {endpoint,read,selector}=W.data, {clamp,bounds}=W.fields;
  const {fields,record,finite,id,check,integer}=K.procedural.musicInstruments;
  const {validBands,validGains}=K.procedural.musicAmbience;
  const {bands,point}=W.acousticPropagation;
  const silent=Object.freeze([0,0,0]);
  const site=value=>point(value) || (record(value) && (value.entity===undefined ?
    point(value.point) && value.socket===undefined : W.data.id(value.entity) &&
      (value.socket===undefined || W.data.id(value.socket))));

  function binding(raw,cover=false) {
    if (raw===undefined) return null;
    check(fields(raw,['field','at','path','range','default',...(cover ? ['shelteredBands'] : [])]),
      'Invalid ambience weather or shelter binding');
    const {field,at,range=[0,1],default:fallback=0,shelteredBands=[.45,.2,.05]}=raw;
    endpoint(field);
    check((at===undefined || site(at)) && W.data.vector(range,2) && range[0]!==range[1] &&
      Number.isFinite(range[1]-range[0]) && finite(fallback,0,1) && validBands(shelteredBands),
    'Invalid ambience signal normalization or sheltered band gains');
    return {field,at,range,fallback,shelteredBands,path:raw.path===undefined ? undefined : selector(raw.path)};
  }

  function acousticAmbience(config) {
    check(fields(config,['listener','hearing','zones','epsilon']) && site(config.listener) && record(config.zones) &&
      integer(Object.keys(config.zones).length,1,64) && finite(config.epsilon ?? .002,0,.05),
    'Acoustic ambience needs a listener and up to 64 named stem zones');
    const {listener,hearing='acoustics/audible',epsilon=.002}=config;
    endpoint(hearing);
    const zones=Object.entries(config.zones).map(([part,row])=>{
      check(id(part) && fields(row,['from','fromRoom','gain','bounds','feather','weather','cover','ramp']) &&
        site(row.from) && (row.fromRoom===undefined || W.data.id(row.fromRoom)) &&
        finite(row.gain ?? 1,0,1) && finite(row.ramp ?? .12,0,30) &&
        finite(row.feather ?? 0,0,1e6) && (row.feather===undefined || row.bounds!==undefined),
      'Invalid acoustic ambience zone '+part);
      const {from,fromRoom,gain=1,feather=0,ramp=.12}=row;
      return {part,from,fromRoom,gain,feather,ramp,bounds:row.bounds===undefined ? undefined : bounds(row.bounds),
        weather:binding(row.weather),cover:binding(row.cover,true)};
    });
    const cache=new WeakMap();
    function signal(query,spec,at,fallback) {
      if (!spec) return fallback;
      const row=query.probe(spec.field,spec.at ?? at);
      const raw=spec.path ? read(row.value,spec.path) : row.value;
      const sample=typeof raw==='boolean' ? Number(raw) : raw, [low,high]=spec.range;
      return row.status==='ok' && Number.isFinite(sample) ? clamp((sample-low)/(high-low),0,1) : spec.fallback;
    }
    function coverage(point,zone) {
      if (!zone.bounds) return 1;
      const {min,max}=zone.bounds;
      const distance=Math.hypot(...point.map((p,i)=>Math.max(min[i]-p,0,p-max[i])));
      return distance===0 ? 1 : zone.feather===0 ? 0 : clamp(1-distance/zone.feather,0,1);
    }
    function mix(query) {
      if (cache.has(query)) return cache.get(query);
      const target=query.target(listener)?.point;
      const result={listener:target ?? null,zones:Object.fromEntries(zones.map(zone=>{
        const weather=signal(query,zone.weather,zone.from,1), shelter=signal(query,zone.cover,listener,0);
        const weight=target ? coverage(target,zone) : 0, base=zone.gain*weather*weight;
        const ray=target ? query.probe(hearing,listener,{
          from:zone.from,...(zone.fromRoom!==undefined && {fromRoom:zone.fromRoom})
        }) : null;
        const path=ray?.status==='ok' ? ray.value : null;
        const gains=path ? bands.map((name,k)=>path.bands[name].gain*base*
          (1-shelter*(1-(zone.cover?.shelteredBands[k] ?? 1)))) : silent;
        return [zone.part,{bands:gains,weather,shelter,weight,status:path?.status ?? ray?.status ?? 'missing',
          fromRoom:path?.fromRoom ?? null,toRoom:path?.toRoom ?? null,apparentSource:path?.apparentSource ?? null}];
      }))};
      const value=K.procedural.data.freeze(result);
      cache.set(query,value);
      return value;
    }
    return {
      initial:()=>({}),
      contract:{emits:['music-ambience']},
      checkFields(query) {
        check(query.field(hearing)?.role==='acoustic-hearing','Acoustic ambience needs an acoustic-hearing field');
        for (const zone of zones) for (const spec of [zone.weather,zone.cover]) {
          if (!spec) continue;
          const field=query.field(spec.field);
          check(field && (spec.path || ['number','bool','boolean'].includes(field.type)),
            'Invalid acoustic ambience signal field '+spec.field);
        }
      },
      validateState(state) {
        check(validGains(state) && Object.keys(state).every(part=>Object.hasOwn(config.zones,part)),
          'Invalid saved acoustic ambience gains');
      },
      step(state,ctx) {
        const view=mix(ctx.query), changes={};
        let next=state;
        for (const {part,ramp} of zones) {
          const {bands}=view.zones[part], before=Object.hasOwn(state,part) ? state[part] : null;
          if (before && bands.every((gain,k)=>gain===before[k] ||
            (gain>0 && gain<1 && Math.abs(gain-before[k])<epsilon))) continue;
          if (next===state) next={...state};
          next[part]=bands;
          changes[part]={bands,ramp};
        }
        if (next!==state) ctx.emit('music-ambience',{time:ctx.time,zones:changes});
        return next;
      },
      fields:{mix:{type:'record',read:({query})=>W.query.ok(mix(query))}}
    };
  }
  W.runtime.register('acoustic-ambience',acousticAmbience);
})(KIT);
