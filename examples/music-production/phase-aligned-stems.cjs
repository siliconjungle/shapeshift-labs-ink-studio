/* Night Relay: printed loops and a live melody on one transport. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), WAV=require('../../cli/wav');

const tempo=120, sampleRate=32000, seconds=4, frames=seconds*sampleRate, end=12;
const dir=path.resolve(process.argv[2] ?? 'night-relay');
fs.mkdirSync(path.join(dir,'stems'),{recursive:true});
function write(name,value) {
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
function source(rows,seed) {
  return {seed,arrangement:{score:{tempoMap:{tempo},key:{root:'D3',mode:'minor'},
    harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},
    parts:Object.fromEntries(Object.entries(rows).map(([part,row])=>[part,{role:row.role}])),
    sections:[{id:'relay',bars:2,harmony:'home'}]},
  patches:Object.fromEntries(Object.entries(rows).map(([part,row])=>[part,row.patch])),
  tracks:Object.fromEntries(Object.entries(rows).map(([part,row])=>[part,{
    patch:part,gain:row.gain,pan:row.pan ?? 0,send:row.send ?? 0,clips:[{
      id:part+'-line',beat:0,length:8,...(row.role==='percussion' && {mode:'layer'}),
      voices:[{id:'player',notes:row.notes.map(([beat,duration,midi,velocity],index)=>({
        id:'note-'+index,beat,duration,midi,velocity
      }))}]
    }]
  }])),room:{gain:-9,decay:1.1,damping:.56}};
}
const printing=source({
  kick:{role:'percussion',gain:-10,patch:{type:'drum',kind:'kick',tune:46,sweep:78,decay:.22,click:.21},
    notes:[0,1.5,2.75,4,5.75,6.5].map((beat,index)=>[beat,.15,36,index%3===0?.92:.69])},
  rim:{role:'percussion',gain:-16,pan:.26,patch:{type:'drum',kind:'rim',tune:216,decay:.24,color:.67,click:.52},
    notes:[1,2.43,3.05,5,6.67,7.26].map((beat,index)=>[beat,.11,50,index%3===0?.88:.62])},
  tick:{role:'percussion',gain:-18,pan:-.49,patch:{type:'drum',kind:'hat',tune:380,sweep:0,decay:.13,click:.51,color:.64},
    notes:[.48,.98,1.72,2.22,2.98,3.54,4.48,4.98,5.72,6.23,6.98,7.53]
      .map((beat,index)=>[beat,.07,49,index%3===0?.86:.5])},
  bass:{role:'bass',gain:-12,pan:-.07,patch:{type:'subtractive',saw:.25,pulse:.39,sub:.45,pulseWidth:.33,
    filter:{cutoff:395,resonance:.55,envAmount:16,keyTrack:.24},
    env:{attack:.017,decay:.13,sustain:.76,release:.12}},
    notes:[[0,.82,38,.92],[1.28,.62,38,.82],[2.15,.59,41,.72],[3.2,.58,45,.84],
      [4,1.01,38,.95],[5.36,.59,36,.75],[6.12,.3,33,.73],[6.62,.86,41,.83]]}
},93);
const {stems}=KIT.music.production.render(printing,{}, {sampleRate,stems:true});
const percussion={...stems.rim,samples:stems.rim.samples.map((sample,index)=>sample+stems.tick.samples[index])};
const tau=2*Math.PI;
const air=new Float32Array(frames*2);
for (let i=0;i<frames;i++) {
  const x=tau*i/frames, sweep=.57+.43*Math.sin(2*x-.25), trem=.64+.36*Math.cos(8*x);
  const floor=.044*Math.sin(587*x+.54*Math.sin(3*x));
  air[i*2]=floor+.037*sweep*Math.sin(698*x)*trem;
  air[i*2+1]=floor+.045*sweep*Math.sin(881*x+.27)*trem;
}
const assets={kick:stems.kick,bass:stems.bass,percussion,ambience:{sampleRate,channels:2,samples:air}};
const streams=Object.fromEntries(Object.entries(assets).map(([part,audio])=>{
  const file='stems/'+part+'.wav';
  assert.equal(audio.samples.length,audio.channels*frames);
  fs.writeFileSync(path.join(dir,file),WAV.encode(audio,{encoding:'pcm24'}));
  return [part,{file,send:part==='ambience'?.35:.03,gain:3}];
}));

const beacon={role:'lead',gain:-16,pan:.08,send:.27,
  patch:{type:'fm',ratio:2.01,index:1.1,width:13,env:{attack:.038,decay:.24,sustain:.48,release:.24},
    echo:{delay:.375,feedback:.36,send:.21,damping:.58,width:.61}}};
const sources={
  scanning:source({beacon:{...beacon,notes:[[.17,.63,74,.69],[1.15,.58,69,.62],[2.42,.49,77,.68],
    [3.3,.4,74,.58],[4.26,.96,72,.72],[5.65,.34,69,.58],[6.27,.82,65,.64],[7.45,.29,69,.55]]}},11),
  contact:source({beacon:{...beacon,notes:[[.25,.53,74,.68],[1.18,.72,81,.76],[2.36,.41,77,.69],
    [3.07,.69,84,.78],[4.24,.61,81,.71],[5.3,.51,77,.63],[6.2,1.2,74,.71]]}},19)
};
const entry='scanning', sections={scanning:{resource:'scanning'},contact:{resource:'contact'}};
const timeline={entry,segments:{scanning:{source:'scanning'},contact:{source:'contact'}},
  transitions:[{from:'scanning',to:'contact',entry:.5}]};
const clock={tempo,entry,sections,parameters:{danger:{},contact:{}},
  layerControls:{
    bass:{parameter:'danger',range:[0,.6],attack:.33,release:.72},
    percussion:{parameter:'danger',range:[.55,1],attack:.39,release:.49},
    ambience:{parameter:'danger',range:[.2,.85],attack:.77,release:1.12}
  },
  transitions:[{id:'contact',from:'scanning',to:'contact',quantize:'beat',
    when:{path:'/parameters/contact',op:'gte',value:1}}]};
const commands=[[47,'danger',.46],[102,'danger',.95],[165,'contact',1],[208,'danger',0]]
  .map(([tick,input,value])=>({tick,action:'world/input',args:{port:'score/parameter.'+input,value}}));
const world={id:'night-relay',seed:385,dt:.05,systems:{score:{kind:'adaptive-music',config:clock}},commands};
const score=write('score.json',{sources,timeline,live:{streams,options:{sampleRate,masterGain:2,
  stemGroups:{relay:{frames,parts:Object.fromEntries(Object.keys(streams).map(part=>[part,{stream:part}]))}}
}}});
write('world.json',world);
write('stem-production.json',printing);
const run=KIT.world.runtime.create(world);
run.advance(Math.round(end/world.dt));
const recording=run.recording();
write('world.run.json',recording);
const trace=write('world.trace.json',KIT.music.production.rehearsal.capture(recording,{id:'night-relay'}));
const mix=path.join(dir,'mix');
execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music','live','replay',
  score,trace,'--out',mix],{stdio:'inherit'});
const report=JSON.parse(fs.readFileSync(path.join(mix,'listen.json'),'utf8'));
assert.equal(report.profile.clippedFrames,0);
assert.equal(report.profile.streamGaps,0);
assert.equal(report.stemGroups.relay.positionFrame,0);
assert.deepEqual(report.joins.map(({frame})=>frame),[8.5*sampleRate]);
