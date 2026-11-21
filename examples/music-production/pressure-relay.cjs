/* Render: node examples/music-production/pressure-relay.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ink=require('../..'), kit=ink.load(), K=kit.KIT, T=K.procedural.takeTime;
const sampleRate=32000, end=12;
const folder=path.resolve(process.argv[2] ?? 'pressure-relay');
const motif=(notes,length=4)=>({length,events:notes.map(([beat,duration,midi,velocity])=>({beat,duration,midi,velocity}))});

const production={
  seed:72,
  arrangement:{
    score:{key:{root:'D4',mode:'minor'},tempoMap:{tempo:100,swing:.54},endFade:.35,harmonies:{
      dark:{root:'D4',quality:'minor',notes:[38,62,65,69]},
      rust:{root:'Bb3',quality:'major7',notes:[34,58,62,69]},
      air:{root:'F4',quality:'major7',notes:[41,60,65,69]}
    }},
    motifs:{
      stalk:motif([[0,.52,38,.79],[1.25,.27,38,.6],[2,.55,45,.74],[2.75,.26,36,.54],[3.5,.38,38,.68]]),
      answer:motif([[0,.76,34,.82],[1.5,.37,41,.67],[2.5,.46,36,.58],[3.25,.54,33,.63]]),
      glass:motif([[.75,.36,77,.65],[2.5,.27,76,.43],[3.25,.52,69,.73]]),
      question:motif([[.5,.26,72,.56],[1.5,.4,77,.71],[2.75,.72,81,.65]]),
      clear:motif([[0,1.2,41,.78],[2,1.3,36,.63],[4,2.9,38,.77]],8),
      resolve:motif([[.25,.65,77,.76],[1.5,.43,79,.55],[2.25,1.2,81,.8],[4.25,.63,77,.68],
        [5.5,.42,76,.63],[6.25,1.2,74,.81]],8)
    },
    parts:{bass:{role:'bass',material:'stalk'},keys:{role:'lead',material:'glass'},
      haze:{role:'pad',material:{sustain:true}},rim:{role:'percussion'}},
    sections:[
      {id:'listen',bars:1,harmony:'dark'},
      {id:'call',bars:1,harmony:'rust',parts:{bass:'answer',keys:'question'}},
      {id:'pressure',bars:1,harmony:'dark',parts:{bass:'stalk',keys:'glass'}},
      {id:'light',bars:2,harmony:'air',parts:{bass:'clear',keys:'resolve'}}
    ]
  },
  patches:{
    sub:{type:'analog',body:.48,drive:1.38,env:{attack:.012,decay:.23,sustain:.55,release:.13}},
    tine:{type:'keys',tine:.85,bite:.56,wear:.3,dust:.045,env:{attack:.009,decay:.48,sustain:.25,release:.25},
      echo:{delay:.265,feedback:.34,send:.17,width:.64,wow:.15,flutter:.08}},
    fog:{type:'fm',ratio:1.997,index:1.05,body:.13,width:12,color:.5,env:{attack:.31,decay:.91,sustain:.49,release:.46}},
    steel:{type:'drum',kind:'rim',tune:213,decay:.225,click:.53,
      articulations:{muted:{tune:328,decay:.12,click:.42}}}
  },
  tracks:{
    bass:{patch:'sub',gain:-12,highpass:27,lowpass:760},
    keys:{patch:'tine',gain:-14,pan:-.19,highpass:130,send:.46},
    haze:{patch:'fog',gain:-22,pan:.21,highpass:152,lowpass:2150,send:.55,
      pad:{voices:3,low:'F3',high:'D5',anchor:'A4',spread:.047}},
    rim:{patch:'steel',gain:-8,pan:.24,highpass:152,send:.18,choke:'metal'}
  },
  room:{size:1.22,decay:.58,damping:.53,gain:-15}
};

function resonances(duration,partials) {
  const part=([frequency,gain,decay,start=0,drop=0],time)=>{
    const age=time-start;
    if (age<0) return 0;
    const phase=frequency*age+drop*(1-Math.exp(-27*age))/27;
    return gain*Math.sin(2*Math.PI*phase)*Math.exp(-age*decay)*Math.min(age*2200,1);
  };
  const samples=Float32Array.from({length:Math.round(duration*sampleRate)},(_,i)=>{
    const time=i/sampleRate;
    const signal=partials.reduce((sum,row)=>sum+part(row,time),0);
    return signal*Math.min(1,(duration-time)*80);
  });
  return {sampleRate,channels:1,samples};
}
const sounds={
  click:resonances(.14,[[1120,.20,40],[1891,.18,66],[2843,.11,95],[394,.075,20,.011]]),
  latch:resonances(.47,[[142,.21,7,0,39],[762,.2,19],[2117,.17,52],[121,.22,8,.077,24],
    [981,.13,26,.077],[2791,.09,39,.114],[485,.047,8,.13]])
};

const relays=[94,177,263,348,418,487,556,611,708,827,944,1061];
const world={id:'pressure-relay',dt:.01,takeClock:{simulationRate:100},
  systems:{score:{kind:'adaptive-music',config:{tempo:100,entry:'approach',
    sections:{approach:{resource:'approach'},reveal:{resource:'reveal'}},parameters:{open:{default:0}},
    transitions:[{id:'open',from:'approach',to:'reveal',quantize:'none',
      when:{path:'/parameters/open',op:'gte',value:1}}]}}},
  timeline:{duration:end,audio:[{id:'steel-latch',cue:'latch',time:6.72}]},
  commands:[...relays.map((tick,i)=>({tick,action:'world/event',args:{kind:'audio-cue',cue:'relay',
    at:[i%2 ? -1 : 1,0,-.7]}})),
    {tick:720,action:'world/input',args:{port:'score/parameter.open',value:1}}]
    .sort((a,b)=>a.tick-b.tick)
};
const timeline={entry:'approach',end,segments:{
  approach:{source:'relay-score',end:{bar:3},loop:false},
  reveal:{source:'relay-score',start:{bar:3},loop:false}
},transitions:[{from:'approach',to:'reveal',fadeIn:.1}]};
const rules={
  rhythms:[{id:'rim-reply',cue:'relay',track:'rim',segments:['approach'],grid:.25,delay:.078,
    hits:[{beat:0,level:.94},{beat:.5,level:.38,articulation:'muted'}]}],
  space:[{id:'let-the-relay-click',cue:'relay',attack:.04,hold:.035,release:.13,tracks:['keys','haze','room'],level:.46},
    {id:'pull-the-score-for-latch',cue:'latch',attack:.25,hold:.48,release:.14}]
};
function render(decorations) {
  const score=ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate,
    spatial:{distance:{reference:2.2},cues:{relay:{asset:'click',gain:.84}}},
    music:{system:'score',production:{sources:{'relay-score':production},timeline,...decorations}}},
    {kit,resolveAsset:name=>sounds[name],runtime:()=>K.world.runtime.create(world)});
  return score.render({startPoint:T.read(0),endPoint:T.read(end)});
}

const baseline=render({}), demo=render({world:rules}), {worldScore}=demo.report;
assert.deepEqual(baseline.waves.spatial,demo.waves.spatial);
assert.deepEqual(baseline.waves.timeline,demo.waves.timeline);
assert(worldScore.responses.length>4 && worldScore.responses.every(row=>row.time<7.2));
assert(!ink.decodeWav(demo.waves.music).samples.slice(sampleRate*2*6.8,sampleRate*2*7.15).some(Boolean));
fs.mkdirSync(folder,{recursive:true});
for (const name of ['mix','music','spatial','timeline'])
  fs.writeFileSync(path.join(folder,name+'.wav'),demo.waves[name]);
fs.writeFileSync(path.join(folder,'comparison-rules-off.wav'),baseline.waves.mix);
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(demo.report,null,2)+'\n');
console.log(`Pressure Relay · ${worldScore.responses.length} percussion hits · ${worldScore.windows.length} gain envelopes`);
