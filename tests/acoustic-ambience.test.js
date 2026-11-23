const test=require('node:test'), assert=require('node:assert/strict');
const {KIT}=require('..').load(), live=KIT.music.production.live;
const rate=8000, frames=2048;
const source={arrangement:{score:{tempoMap:{tempo:120},key:{root:'C4'},
  harmonies:{home:{root:'C4',quality:'unison'}}},motifs:{},parts:{ref:{role:'lead'}},
  sections:[{id:'hall',bars:1,harmony:'home'}]},patches:{ref:{type:'fm'}},
  tracks:{ref:{patch:'ref',clips:[{id:'silence',beat:0,length:4,voices:[{id:'player',notes:[]}]}]}}};
const sources={silence:source}, timeline={entry:'hall',segments:{hall:{source:'silence'}}};
const layout=require('../examples/world-acoustic-hatch.json');
const bands=(query,part)=>query.probe('ambience/mix').value.zones[part];
const at={entity:'listener'};
const region={id:'storm',bounds:{min:[-10,-10],max:[10,10]}};
const change=(tick,port,value)=>({tick,action:'world/input',args:{port,value}});
const paint=(tick,field,value)=>({tick,action:'weather/set',args:{field,region:{...region,value}}});
const move=(tick,value)=>({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/listener/position',value}]}});
function stems(names) {
  return {sampleRate:rate,masterGain:0,
    streams:Object.fromEntries(names.map((name,i)=>[name,{sampleRate:rate,channels:1,frames,pan:i===0?-1:1}])),
    stemGroups:{landscape:{frames,parts:Object.fromEntries(names.map(name=>[name,{stream:name}]))}},
    readPage:async(name,first,count)=>Float32Array.from({length:count},(_,i)=>.24*Math.sin((first+i)*Math.PI/16))
  };
}

test('acoustic ambience samples listener location, sealed doors, weather and local shelter',async()=>{
  const world={id:'test-ambience',dt:.1,entities:{listener:{position:[-2,1,0]}},systems:{
    air:layout.systems.air,acoustics:{kind:'acoustics',config:{layout:'air/acoustic-layout',referenceDistance:5,
      openings:{hatch:{sealed:true}}}},
    weather:{kind:'fields',config:{fields:{
      rain:{axes:'xz',default:5},roof:{axes:'xz',default:0,regions:[{id:'awning',
        bounds:{min:[-4,-1],max:[-3,1]},value:1}]}
    }}},
    score:{kind:'adaptive-music',config:{entry:'hall',sections:{hall:{resource:'hall'}}}},
    ambience:{kind:'acoustic-ambience',config:{listener:at,epsilon:0,zones:{
      rain:{from:[-1,1,0],weather:{field:'weather/rain',range:[0,20]},
        cover:{field:'weather/roof',shelteredBands:[.5,.2,.02]},
        bounds:{min:[-3,0,-1],max:[-.5,2,1]},feather:2,ramp:.1},
      motor:{from:[2,1,0],ramp:.1}
    }}}
  },commands:[paint(2,'rain',20),change(4,'air/opening.hatch',0),move(6,[-3.5,1,0]),
    change(9,'air/opening.hatch',.35)]};
  const run=KIT.world.runtime.create(world);
  const initial=bands(run.query(),'rain');
  assert.equal(initial.weather,.25);
  assert.equal(bands(run.query(),'motor').fromRoom,'machine-room');
  assert(bands(run.query(),'motor').bands[2]>.8);
  run.advance(3);
  assert.equal(bands(run.query(),'rain').weather,1);
  run.advance(5);
  assert.equal(bands(run.query(),'motor').status,'blocked');
  assert.deepEqual(bands(run.query(),'motor').bands,[0,0,0]);
  run.advance(8);
  const protectedRain=bands(run.query(),'rain');
  assert.equal(protectedRain.shelter,1);
  assert.equal(protectedRain.weight,.75);
  assert(protectedRain.bands[0]>.36 && protectedRain.bands[2]<.016);
  run.advance(12);
  const reopened=bands(run.query(),'motor');
  assert(reopened.bands[2]>0 && reopened.bands[2]<reopened.bands[0]);
  assert.equal(reopened.toRoom,'hall');
  const capture=KIT.music.production.rehearsal.capture(run.recording(),{id:'hearing',ambience:'ambience'});
  assert.deepEqual(capture.ambienceGains.rain,initial.bands);
  assert(capture.intents.some(row=>row.kind==='music-ambience' && row.zones.motor?.bands.every(gain=>gain===0)));
  const route=live.fromTrace(JSON.parse(JSON.stringify(capture)));
  const mixed=await live.replay(sources,timeline,route,stems(['rain','motor']));
  const reblocked=await live.replay(sources,timeline,{...route,blockFrames:173},stems(['rain','motor']));
  assert.deepEqual(reblocked.value.samples,mixed.value.samples);
  assert.equal(mixed.report.profile.streamGaps,0);
  for (let frame=.65*rate;frame<.85*rate;frame++) assert.equal(mixed.value.samples[2*frame+1],0);
  assert.deepEqual(mixed.report.ambienceGains.motor.target,reopened.bands);
  assert.throws(()=>live.open(sources,timeline,{...stems(['rain']),ambienceGains:{motor:[1,1,1]}}),
    /declared PCM stem parts/);
});

test('acoustic beds keep their phase and their own bus during score silence',async()=>{
  const settings={...stems(['wind']),ambienceGains:{wind:[1,1,1]}};
  const change=(time,bands,ramp)=>({kind:'music-ambience',time,zones:{wind:{bands,ramp}}});
  const event=(intent,observedAt=intent.time)=>({intent,observedAt});
  const route={end:.8,events:[event(change(.15,[.5,.1,0],.2)),event(change(.29,[1,1,1],.15)),
    event(change(.18,[0,0,0],0),.4),event({kind:'music-cue',time:.5,cue:'hold'})]};
  const withSpace={...timeline,scoring:{cues:{hold:{space:{attack:0,hold:.18,release:0}}}}};
  const mixed=await live.replay(sources,withSpace,route,settings);
  const bypassed=await live.replay(sources,timeline,{...route,events:route.events.slice(0,3)},settings);
  assert.deepEqual(mixed.value.samples,bypassed.value.samples);
  const [fade,redirect]=mixed.report.trace.filter(row=>row.kind==='ambience-gain');
  assert.equal(fade.zones.wind.endFrame,2800);
  assert.equal(redirect.zones.wind.startFrame,2320);
  assert(Math.abs(redirect.zones.wind.from[0]-.65)<1e-10);
  assert(mixed.report.trace.some(row=>row.kind==='ambience-ignored' && row.reason==='stale-intent'));
  const steady=await live.replay(sources,timeline,{end:.8,events:[]},settings);
  assert.deepEqual(mixed.value.samples.slice(.45*rate*2),steady.value.samples.slice(.45*rate*2));
});

test('sheltered bands attenuate high frequencies more than the low bed',async()=>{
  const low=125, high=3125;
  const settings={...stems(['rain']),readPage:async(name,first,count)=>Float32Array.from({length:count},(_,i)=>{
    const t=(first+i)/rate;
    return .2*(Math.sin(2*Math.PI*low*t)+Math.sin(2*Math.PI*high*t));
  })};
  const dry=await live.replay(sources,timeline,{end:.2,events:[]},{
    ...settings,ambienceGains:{rain:[1,1,1]}
  });
  const covered=await live.replay(sources,timeline,{end:.2,events:[]},{
    ...settings,ambienceGains:{rain:[.8,.16,.02]}
  });
  function amplitude({value},frequency) {
    let real=0, imaginary=0;
    for (let frame=1024;frame<1536;frame++) {
      const phase=2*Math.PI*frequency*frame/rate, sample=value.samples[frame*2];
      real+=sample*Math.cos(phase);
      imaginary+=sample*Math.sin(phase);
    }
    return Math.hypot(real,imaginary);
  }
  assert(amplitude(covered,low)/amplitude(dry,low)>.7);
  assert(amplitude(covered,high)/amplitude(dry,high)<.16);
});
