/* Run: node examples/instrument-session/demo.cjs output-directory */
const assert=require('node:assert/strict'), path=require('node:path');
const {KIT}=require('../..').load(), P=KIT.procedural, S=P.mediaGraph.instrumentSession;
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
const {families,recordings,sampleRate}=require('./bench.cjs');
if (!process.argv[2]) throw new TypeError('Use an output folder for the instrument workshop');
const dir=path.resolve(process.argv[2]), file=name=>path.join(dir,name);
const wave=(name,pcm,encoding='pcm24')=>write(file(name),WAV.encode(pcm,{encoding}));
const panels=[], builds={};

for (const [key,settings] of Object.entries(families)) {
  const {title,session,assets}=recordings(key), plan=S.analyze(session,assets);
  const recorded=Object.fromEntries(Object.entries(assets).map(([id,pcm])=>{
    const name='recordings/'+id+'.wav';
    wave(key+'/'+name,pcm,'float32');
    return [id,name];
  }));
  json(file(key+'/session.json'),{session:plan.value,assets:recorded});
  const actual=Object.fromEntries(Object.entries(recorded).map(([id,name])=>[id,WAV.read(file(key+'/'+name))]));
  const bundle=S.build(plan.value,actual,{fit:settings.fit});
  const samples=Object.fromEntries(Object.entries(bundle.assets).map(([id,pcm])=>{
    const name='samples/'+id+'.wav';wave(key+'/'+name,pcm,'float32');return [id,name];
  }));
  json(file(key+'/instrument.json'),{instrument:bundle.value,assets:samples});
  json(file(key+'/report.json'),bundle.report);
  const print=S.audition(bundle.value,bundle.assets,{sampleRate});
  assert(!print.report.probes.some(row=>row.silent));
  wave(key+'/coverage.wav',print.value);
  json(file(key+'/coverage.json'),print.report);
  json(file(key+'/coverage-production.json'),{production:print.production,assets:samples,options:{sampleRate}});
  const {takes}=session, pick=takes.find(row=>row.dynamic==='firm' && row.key===settings.registers[1]);
  const listen=S.auditionTakes(plan.value,actual,{takes:[
    {take:pick.id,perspective:'close'},{take:pick.id,perspective:'room'}
  ],sampleRate});
  wave(key+'/perspectives.wav',listen.value);
  panels.push({key,title,takes:takes.length,coverage:bundle.report.coverage,probes:print.report.probes,rate:sampleRate});
  builds[key]=bundle;
  console.log(title+' · '+takes.length+' takes');
}
assert.equal(builds.plate.report.coverage.filter(row=>row.status==='borrowed').length,1);
assert.equal(builds.reed.report.coverage.filter(row=>row.status==='single-take').length,1);
assert(builds.reed.session.takes.some(row=>row.loop));
const reed=builds.reed;
const reedAssets=Object.fromEntries(['close','room'].map(id=>[id,WAV.read(file('reed/recordings/'+id+'.wav'))]));
const looped=S.build(reed.session,reedAssets,{body:'recorded',alternates:1,perspective:'room'});
const loopProof=looped.report.coverage.find(cell=>cell.key===64 && cell.articulation==='spoken' && cell.dynamic==='soft');
const loopCase={id:'long-note',key:64,velocity:.28,articulation:'spoken',gate:1.65};
const sustain=S.audition(looped.value,looped.assets,{sampleRate,cases:[loopCase]});
assert.equal(looped.report.models[loopProof.id].method,'looped-recording');
assert(!sustain.report.probes[0].silent && sustain.report.probes[0].afterKeyUpRms>.0002);
wave('room-loop.wav',sustain.value);
const roomAssets=Object.fromEntries(Object.entries(looped.assets).map(([id,pcm])=>{
  const name='samples/'+id+'.wav';
  wave('room-instrument/'+name,pcm,'float32');
  return [id,name];
}));
json(file('room-instrument/instrument.json'),{instrument:looped.value,assets:roomAssets});
json(file('room-instrument/report.json'),looped.report);

const notes={
  reed:[
    [.48,.86,64,.48,'air'],[1.68,.65,67,.59,'spoken'],[2.46,1.47,71,.71,'spoken'],
    [5.08,.77,69,.54,'air'],[6.06,1.49,64,.61,'spoken'],[10.33,1.05,62,.5,'air'],
    [11.65,.51,64,.55,'spoken'],[12.38,1.83,67,.67,'spoken'],[18.35,.81,64,.55,'air'],
    [19.45,.55,67,.67,'spoken'],[20.18,2.46,71,.79,'spoken'],[24.85,2.68,64,.46,'air']
  ],
  bass:[
    [3.83,.86,35,.72,'finger'],[5.46,.76,35,.67,'finger'],[7.49,.50,43,.55,'muted'],
    [8.36,.93,38,.76,'finger'],[10.74,.67,38,.59,'muted'],[13.64,1.03,43,.65,'finger'],
    [15.91,.82,40,.69,'finger'],[17.23,1.06,35,.53,'muted'],[21.62,.76,31,.78,'finger'],
    [23.13,.84,38,.72,'finger'],[25.53,1.57,35,.58,'finger']
  ],
  plate:[
    [2.14,.28,55,.26,'edge'],[3.81,.39,48,.67,'center'],[4.56,.45,55,.57,'edge'],
    [7.69,.35,49,.47,'edge'],[9.03,.38,55,.73,'center'],[11.07,.39,62,.28,'center'],
    [14.89,.33,48,.58,'edge'],[15.65,.28,55,.82,'center'],[16.4,.45,62,.72,'edge'],
    [19.12,.53,62,.28,'edge'],[22.64,.45,55,.75,'center'],[23.43,.33,48,.58,'edge'],
    [25.74,.60,51,.29,'center'],[27.70,.80,55,.24,'edge']
  ]
};
const partRoles={reed:'lead',bass:'bass',plate:'percussion'}, patches={}, tracks={}, assets={}, assetPaths={};
const length=32;
for (const [id,rows] of Object.entries(notes)) {
  const {value,assets:samples}=builds[id], patch=P.data.clone(value.patch);
  const touched=new Set(rows.map(([, ,midi,velocity,art])=>P.musicInstruments.zoneFor(
    patch.zones,midi,velocity,art)?.instrument));
  assert(!touched.has(undefined));
  patch.zones=patch.zones.filter(row=>touched.has(row.instrument));
  patch.instruments=Object.fromEntries(Object.entries(patch.instruments).filter(([name])=>touched.has(name)));
  for (const zone of P.musicInstruments.sampleZones(patch)) zone.samples=zone.samples.map(name=>{
    const unique=id+'-'+name;
    assets[unique]=samples[name]; assetPaths[unique]=id+'/samples/'+name+'.wav';
    return unique;
  });
  patches[id]=patch;
  tracks[id]={patch:id,gain:{reed:-4.9,bass:-5.4,plate:-8.8}[id],pan:{reed:-.13,bass:0,plate:.28}[id],
    send:{reed:.31,bass:.04,plate:.28}[id],clips:[{id:id+'-part',beat:0,length,
      ...(id==='plate' && {mode:'layer'}),voices:[{id:'player',notes:rows.map(([beat,duration,midi,velocity,articulation],i)=>({
        id:'note-'+i,beat,duration,midi,velocity,play:{articulation,...(id==='plate' ?
          {damping:i%3===1?.57:0,contact:i%2?.25:.65} : id==='reed' ?
          {vibrato:i%3===0?9:15,curves:{pitchCents:[[0,-23],[.2,1],[.79,4],[1,-8]],amplitude:[[0,.43],[.25,.95],[.78,1],[1,.48]]}} : {})}
      }))}]}]};
}
const production={seed:15,arrangement:{score:{tempoMap:{tempo:94},key:{root:'E3',mode:'minor'},endFade:.14,
  harmonies:{base:{root:'E3',quality:'minor'}}},parts:Object.fromEntries(Object.entries(partRoles).map(([name,role])=>[name,{role}])),
  motifs:{},sections:[{id:'conversation',bars:8,harmony:'base'}]},patches,tracks,room:{gain:-6.6,decay:1.4,size:1.32,damping:.68}};
const sound=P.musicProduction.render(production,assets,{sampleRate});
const gain=Math.min(2.6,.92/Math.max(1e-8,sound.report.peak));
wave('three-instruments.wav',{...sound.value,samples:Float64Array.from(sound.value.samples,x=>x*gain)});
json(file('trio.production.json'),{production,assets:assetPaths,options:{sampleRate}});
json(file('workshop.json'),{totalTakes:panels.reduce((sum,row)=>sum+row.takes,0),panels});
const escaped=JSON.stringify(panels).replace(/</g,'\\u003c');
write(file('index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ink recording workshop</title>
<style>
:root{color-scheme:dark;background:#172124;color:#eff0e6;font:16px/1.55 system-ui}main{max-width:880px;margin:6vh auto;padding:0 22px}
h1,h2{line-height:1.05;font-family:Georgia,serif;font-weight:normal}h1{font-size:clamp(2.6rem,8vw,4.7rem)}h2{font-size:2.2rem}
a{color:#acd9c7}p{color:#bfcdcb}section{margin:25px 0;border-top:1px solid #526661;padding-top:12px}audio{display:block;width:100%}
button{font:inherit;color:inherit;background:#202f31;border:1px solid #718481;border-radius:4px;padding:.25rem .55rem;cursor:pointer}
button:focus-visible{outline:2px solid #a6e0c8;outline-offset:2px}.grid{display:flex;flex-wrap:wrap;gap:.5rem;margin:12px 0}.flag{border-color:#e8b777;color:#e8c38b}
</style><main><h1>Recording workshop</h1><p>Three instruments made from long, aligned takes. The keys below audition the native builds. Gold outlines mark thin coverage or a borrowed cell.</p>
<h2>Trio</h2><audio controls preload="none" src="three-instruments.wav"></audio><p><a href="trio.production.json">Trio score and patch references</a></p>
<p><a href="room-loop.wav">Held note from a looped stereo room take</a> · <a href="room-instrument/instrument.json">Looped room instrument</a></p><div id="banks"></div></main>
<script>
const banks=${escaped};
const make=(tag,text)=>{const el=document.createElement(tag);if(text) el.textContent=text;return el;};
for(const bank of banks){
  const section=make('section'), picker=make('div'), player=make('audio'), report=make('p'), mics=make('audio');
  picker.className='grid';
  player.controls=true;player.preload='metadata';player.src=bank.key+'/coverage.wav';
  mics.controls=true;mics.preload='none';mics.src=bank.key+'/perspectives.wav';
  for(const row of bank.probes){
    const item=make('button',row.key+' · '+row.articulation+' · '+(row.velocity<.5?'soft':'firm'));
    if(row.status!=='recorded') item.className='flag';
    item.onclick=()=>{player.currentTime=row.fromSample/bank.rate;player.play().catch(()=>{});
      report.textContent=row.status==='recorded'?'Mapped to takes from this cell.':row.status==='borrowed'?'Plays a nearby take from the same articulation.':'This cell has one usable take.';};
    picker.append(item);
  }
  const links=make('p');
  for(const [label,name] of [['Recording session','session.json'],['Editable instrument','instrument.json'],['Coverage evidence','report.json']]){
    const link=make('a',label);link.href=bank.key+'/'+name;links.append(link,'  ');
  }
  section.append(make('h2',bank.title),make('p',bank.takes+' takes'),picker,player,report,
    make('p','The same original take, close then room.'),mics,links);
  document.getElementById('banks').append(section);
}
document.addEventListener('play',event=>{if(event.target.tagName==='AUDIO') for(const item of document.querySelectorAll('audio'))
  if(item!==event.target) item.pause();},true);
</script></html>`);
console.log(path.join(dir,'index.html'));
