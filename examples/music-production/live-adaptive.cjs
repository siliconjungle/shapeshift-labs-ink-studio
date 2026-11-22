/* Render The Floodgate and build its interactive live score desk. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), K=ink.load().KIT, A=K.music.production, WAV=require('../../cli/wav');
const rate=32000, tempo=100, entry='quay', sceneNames=['quay','sluice','tower'];
const roles={reed:'lead',glass:'pad',bass:'bass',kick:'percussion',plate:'percussion'};
const patches={
  reed:{type:'subtractive',saw:.19,pulse:.61,sub:.07,pulseWidth:.33,pwm:{rate:.66,depth:.14},
    filter:{cutoff:1170,resonance:.61,envAmount:12,keyTrack:.36},
    env:{attack:.085,decay:.26,sustain:.56,release:.55},
    echo:{delay:.447,feedback:.45,send:.23,damping:.61,width:.71,wow:.14,flutter:.08}},
  glass:{type:'fm',ratio:3.974,index:1.6,body:.23,width:15,
    env:{attack:.24,decay:.69,sustain:.43,release:1.06}},
  bass:{type:'subtractive',saw:.28,pulse:.24,sub:.49,filter:{cutoff:263,keyTrack:.26,envAmount:20},
    env:{attack:.018,decay:.13,sustain:.53,release:.14}},
  kick:{type:'drum',kind:'kick',tune:42,sweep:69,decay:.18,click:.10},
  plate:{type:'drum',kind:'rim',tune:248,decay:.21,color:.68,click:.36}
};
const scenes={
  quay:{
    reed:[[.19,.44,69,.60],[.84,.51,72,.65],[1.67,2.40,74,.78],[4.78,.74,69,.58],[6.09,1.02,65,.64]],
    glass:[[0,3.8,53,.44],[.18,3.35,60,.37],[4.11,3.53,50,.39],[4.48,3.08,57,.38]],
    bass:[[1.32,.76,41,.62],[3.44,.40,48,.43],[4.42,.90,38,.65],[6.91,.56,45,.44]],
    plate:[[1.48,.13,52,.53],[3.71,.12,52,.52],[6.05,.13,52,.38]]},
  sluice:{
    reed:[[.28,.45,65,.68],[.92,.28,69,.61],[1.68,2.42,72,.71],[5.18,.53,67,.64],[6.24,.82,64,.55]],
    glass:[[.12,3.52,46,.53],[.27,3.25,53,.41],[4.04,3.56,45,.46],[4.39,3.02,55,.43]],
    bass:[[.03,.60,34,.73],[1.44,.33,41,.55],[2.02,.66,34,.72],[3.17,.50,36,.60],
      [4.04,.70,33,.73],[5.66,.35,45,.49],[6.02,.60,33,.69],[7.34,.42,40,.51]],
    kick:[[0,.12,36,.76],[1.45,.09,36,.54],[2.01,.12,36,.70],[3.18,.09,36,.55],
      [4,.13,36,.71],[5.68,.10,36,.49],[6,.12,36,.66],[7.27,.10,36,.46]],
    plate:[[.99,.12,52,.61],[2.89,.11,52,.50],[3.57,.10,52,.40],[4.98,.12,52,.60],[6.84,.16,52,.68]]},
  tower:{
    reed:[[.36,.57,74,.66],[1.34,.51,77,.69],[2.51,1.66,81,.74],[5.66,.47,79,.60],[6.51,.98,76,.66]],
    glass:[[.03,3.86,50,.52],[.16,3.81,57,.44],[.24,3.55,64,.45],[4.11,3.60,48,.55],[4.32,3.27,60,.38]],
    bass:[[1.31,.57,38,.74],[2.58,.43,45,.55],[3.18,.58,38,.68],[4.03,.78,36,.80],
      [5.65,.45,43,.57],[6.42,.82,36,.74]],
    kick:[[1.32,.12,36,.73],[2.58,.09,36,.46],[3.18,.09,36,.52],[4,.12,36,.78],[6.43,.14,36,.65]],
    plate:[[.99,.13,52,.63],[2.02,.13,52,.55],[3.82,.12,52,.57],[5.09,.15,52,.62],[7.08,.12,52,.50]]}
};
scenes.return={...scenes.tower,
  reed:[[.36,.43,77,.67],[1.09,.51,81,.64],[2.12,.66,79,.71],[3.36,1.31,76,.68],
    [5.30,.55,74,.65],[6.40,1.02,69,.62]],
  glass:[[.03,3.63,53,.50],[.30,3.62,62,.45],[4.11,3.51,48,.49],[4.39,3.19,57,.43]]};
function source(name,parts) {
  function track(part,gain,pan,send,extra={}) {
    const notes=(parts[part] ?? []).map(([beat,duration,midi,velocity],i)=>({id:'note-'+i,beat,duration,midi,velocity,
      ...(part==='reed' && {play:{vibrato:[8,18,24,15][i%4],curves:{
        pitchCents:[[0,[-35,16,-50,18][i%4]],[.19,4],[.55,0],[1,-17]],
        amplitude:[[0,.53],[.42,1],[.73,.89],[1,.75]]
      }}})}));
    const voices=part==='glass' ? notes.map((note,i)=>({id:'glass-'+i,notes:[note]})) : [{id:'player',notes}];
    return {patch:part,gain,pan,send,...extra,clips:[{id:name+'-'+part,beat:0,length:12,voices,...(roles[part]==='percussion' && {mode:'layer'})}]};
  }
  return {seed:503,arrangement:{score:{key:{root:'D3',mode:'minor'},tempoMap:{tempo},
    harmonies:{form:{root:'D3',quality:'minor'}}},motifs:{},parts:
      Object.fromEntries(Object.entries(roles).map(([part,role])=>[part,{role}])),
    sections:[{id:'main',bars:3,harmony:'form'}]},patches,
    tracks:{reed:track('reed',-10,-.13,.57,{highpass:100}),glass:track('glass',-20,.25,.78,{highpass:120}),
      bass:track('bass',-12,.03,.01,{highpass:26}),kick:track('kick',-16,0,0),
      plate:track('plate',-20,.33,.4,{highpass:220})},
    room:{gain:-2,size:1.49,decay:1.72,damping:.57},gain:.83};
}
const sources=Object.fromEntries(Object.entries(scenes).map(([name,parts])=>[name,source(name,parts)]));
const clock={entry,tempo,sections:Object.fromEntries(sceneNames.map(scene=>[scene,{resource:scene}])),
  parameters:Object.fromEntries(sceneNames.map(scene=>[scene,{}])),
  transitions:sceneNames.flatMap(from=>sceneNames.filter(to=>to!==from).map(to=>({
    id:from+'-to-'+to,from,to,quantize:'none',when:{path:'/parameters/'+to,op:'gte',value:1},
    ...(to==='tower' && {cue:'flood-bell'})}))),
  cues:{'flood-bell':{resource:'bell'}}};
const timeline={entry,end:33,segments:Object.fromEntries(sceneNames.map(section=>[section,{source:section,end:{beat:8}}])),
  transitions:clock.transitions.map(({from,to})=>({from,to,exit:{beat:to==='sluice' || from==='sluice' ? 3 : 4},
    entry:{beat:0},tail:.12,fadeIn:.065})),
  performers:{tracks:['reed','glass']},phrasing:{listen:{tower:['reed']},routes:{tower:[
    {id:'second-signal',source:'return',when:{heard:[{phrase:'tower'}]}}
  ]}}};
const choose=(to,time)=>({time,parameters:Object.fromEntries(sceneNames.map(scene=>[scene,Number(scene===to)]))});
const assets={
  bell:{seconds:1.15,gain:-9,pan:.18,send:.63,priority:12,foreground:true},
  chain:{seconds:.94,gain:-22,pan:.34,send:.21,priority:-10},
  foam:{seconds:2.34,gain:-22,pan:-.33,send:.18,priority:-20}
};
function makeWaves() {
  const modes={bell:[[222,.51,4.4],[450,.31,6.4],[690,.2,9.5],[1271,.15,19],[2410,.13,24]],
    chain:[[143,.28,8],[340,.22,16],[842,.19,25],[1799,.24,40],[3312,.14,47]]};
  return Object.fromEntries(Object.entries(assets).map(([name,{seconds}])=>{
    let brown=0, white=0, seed=725519;
    const samples=Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>{
      const time=i/rate;
      seed=(Math.imul(1664525,seed)+1013904223)>>>0;
      const noise=seed/2147483648-1;
      brown+=(noise-brown)*.03;
      white+=(noise-white)*.18;
      const hit=age=>age>=0 ? modes[name].reduce((sum,[hz,gain,drop])=>
        sum+gain*Math.sin(2*Math.PI*hz*age)*Math.exp(-drop*age),0)*Math.min(age*700,1) : 0;
      if (name==='foam')
        return (white*.34+brown*.78)*Math.sin(Math.PI*time/seconds)**.8*(.70+.30*Math.sin(17*time))+.05*brown;
      if (name==='chain') return (.43*hit(time)+.63*hit(time-.058)+.42*hit(time-.16)+
        .31*hit(time-.228)+.17*white*Math.exp(-10*time))*Math.min(1,(seconds-time)*18);
      return hit(time)*Math.min(1,(seconds-time)*10);
    });
    return [name,{channels:1,sampleRate:rate,samples}];
  }));
}

async function main(folder) {
  const out=path.resolve(folder ?? 'floodgate');
  const project=path.join(out,'project');
  fs.mkdirSync(project,{recursive:true});
  const save=(name,data)=>fs.writeFileSync(path.join(project,name),JSON.stringify(data,null,2)+'\n');
  const options={sampleRate:rate,maxVoices:8,reservedVoices:4,foreground:['reed','bass'],
    priorities:{glass:-1,kick:5,plate:2},pageSize:1024,maxPages:24,masterGain:4};
  const waves=makeWaves();
  const streamFiles=Object.fromEntries(Object.entries(assets).map(([name,{seconds,...mix}])=>{
    const file=name+'.wav';
    fs.writeFileSync(path.join(project,file),WAV.encode(waves[name]));
    return [name,{file,...mix}];
  }));
  const streams=Object.fromEntries(Object.entries(streamFiles).map(([name,{file,...mix}])=>
    [name,{...mix,sampleRate:rate,frames:waves[name].samples.length,channels:1}]));
  save('score.json',{sources,timeline,adaptive:{score:clock},live:{options,streams:streamFiles}});
  const asks=[choose('sluice',.51),choose('quay',.93),choose('sluice',2.81),choose('tower',8.26),choose('quay',24.15),
    choose('sluice',28.52)];
  const worldEvents=[{cue:'foam',time:0.05},{cue:'foam',time:4.96},{cue:'foam',time:7.11},{cue:'foam',time:19.32},
    {cue:'foam',time:26.26},...Array.from({length:31},(_,i)=>({cue:'chain',time:8.39+i*.061})),
    ...Array.from({length:24},(_,i)=>({cue:'chain',time:29.15+i*.061}))];
  const captured=A.rehearsal.captureScore(clock,asks,{id:'floodgate',end:timeline.end,worldEvents});
  save('world-trace.json',captured);
  const route=A.live.fromTrace(captured,{worldCues:{foam:'foam',chain:'chain'}});
  // The gate signal was stamped while the playhead was elsewhere and reached audio late.
  for (const row of route.events) if (row.intent.time===8.26 && (row.intent.to==='tower' || row.intent.transition))
    row.observedAt=8.74;
  const report=path.join(out,'recorded-route');
  save('route.json',route);
  execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music','live','replay',
    path.join(project,'score.json'),path.join(project,'route.json'),'--out',report],{stdio:'inherit'});
  const take=JSON.parse(fs.readFileSync(path.join(report,'listen.json'),'utf8'));
  assert(take.profile.cancellations>0 && take.profile.lateEvents>0);
  assert(take.profile.dropped>0 && take.profile.foregroundDropped===0);
  assert(take.profile.stream.reads>4 && take.profile.streamGaps===0 && take.profile.clippedFrames===0);
  assert(take.joins.some(join=>join.carry.held.some(voice=>voice.state==='held')));
  assert(take.joins.every(join=>join.audio.sampleJump<.08));
  assert(take.heard['second-signal']>0);
  const config={sources,timeline,clock,options,streams,waves:Object.fromEntries(Object.keys(assets).map(name=>
    [name,fs.readFileSync(path.join(project,streamFiles[name].file)).subarray(44).toString('base64')]))};
  const html=fs.readFileSync(path.join(__dirname,'live-adaptive.html'),'utf8');
  fs.writeFileSync(path.join(out,'ink-engine.js'),ink.bundle());
  fs.writeFileSync(path.join(out,'desk.js'),fs.readFileSync(path.join(__dirname,'live-adaptive-desk.js')));
  fs.writeFileSync(path.join(out,'score.js'),'globalThis.floodgate='+JSON.stringify(config)+';\n');
  fs.writeFileSync(path.join(out,'index.html'),html);
}
if (require.main===module) main(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
