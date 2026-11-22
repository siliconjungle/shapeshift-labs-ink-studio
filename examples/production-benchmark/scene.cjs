const assert=require('node:assert/strict');
const {fs,path,A,WAV,write,json,read,rate,wav,pair,frames,noise,tone,cli,copyStock}=require('./support.cjs');
const fps=12, captureFps=6, length=126, duration=length/fps, bounds={min:[-3,-.18,-2.25],max:[3,2.86,2.12]};
const tracks={landing:0,fan:48,waterline:96};
const shots={
  original:[['landing',0,42],['fan',0,36],['waterline',0,48]],
  revised:[['landing',0,29],['fan',4,39],['waterline',3,58]]
};
const picture=name=>({fps,shots:shots[name].map(([id,inFrame,frames])=>({id,inFrame,frames}))});
const n=seconds=>Math.round(seconds*rate);
const box=(position,half,ramp)=>({position,visual:{half,ramp}});
const pulses={floor:[1,2,3,4,5], iron:[2,3,4,5,6], blue:[13,14,15,16,17], warm:[19,20,21,22,23]};
function worldSpec() {
  const {floor,iron,blue,warm}=pulses;
  const objects={
    slab:box([0,-.04,0],[2.9,.09,2.18],floor), back:box([0,1.31,-1.58],[2.88,1.31,.13],iron),
    water:box([1.2,.015,.49],[1.57,.025,1.34],blue), stair:box([-.65,.2,.32],[.85,.21,1.69],iron),
    fanWall:box([-1.65,1.23,-1.28],[.53,.53,.19],blue),
    fanAxle:box([-1.65,1.25,-1.04],[.14,.15,.08],warm),
    lamp:box([-.94,2.13,-1.17],[.55,.055,.105],warm), tallPipe:box([1.55,1.25,-1.21],[.12,1.24,.1],blue),
    openPipe:box([1.88,1.77,-.95],[.34,.14,.13],blue), column:box([2.49,1.31,-1.11],[.14,1.29,.18],iron),
    silhouette:box([-.74,.47,.38],[.14,.36,.12],floor), head:box([-.74,.94,.38],[.11,.12,.11],blue)
  };
  for (let i=0;i<12;i++) {
    objects['grate-'+i]=box([-2.25+i*.107,.054,.66],[.018,.02,1.05],iron);
    objects['wake-'+i]=box([.48+i*.124,.062,.78-Math.cos(i*2)*.51],[.068,.007,.018],i%4 ? blue:warm);
  }
  const commands=[];
  for (let tick=80;tick<=180;tick+=2) {
    const t=(tick-80)/20;
    const size=.28*Math.exp(-t*.51);
    commands.push({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/fanAxle/position',
      value:[-1.65+size*Math.cos(t*11),1.25+size*Math.sin(t*11),-1.04]}]}});
  }
  for (let tick=160;tick<281;tick+=3) {
    const t=(tick-160)/20;
    commands.push({tick,action:'world/patch',args:{edits:Array.from({length:12},(_,i)=>({op:'set',
      path:'/entities/wake-'+i+'/position',value:[.58+i*.114,.062,.68+Math.sin(i*1.55+t*2.1)*.63]}))}});
  }
  return {format:'ink-studio/world',version:1,id:'water-above',dt:.05,seed:19,
    history:{enabled:false},takeClock:{fps:captureFps,simulationRate:20,sampleRate:rate,
      cuts:[{frame:0,id:'landing'},{frame:24,id:'fan'},{frame:48,id:'waterline'}]},
    entities:objects,commands,visual:{bounds,ground:-.1,resolution:.145,
      skyEnvironment:{defaults:{zenith:'#132132',horizon:'#554d56',ground:'#1c2930',sunStrength:0}},
      cameraRig:{shots:{
        landing:{target:[-.8,.93,-.09],dist:6.1,yaw:.39,pitch:.24},
        fan:{target:[-1.51,1.3,-1.22],dist:3.06,yaw:.13,pitch:.18},
        waterline:{target:[.98,.57,.1],dist:4.95,yaw:-.44,pitch:.52}
      },sequence:[{time:0,shot:'landing'},{time:4,shot:'fan'},{time:8,shot:'waterline'}]}}};
}
function recordings(folder) {
  const paths=copyStock(folder,['metal-hit']);
  for (const id of ['fan-line','water-line']) {
    paths[id]='recordings/'+id+'.wav';
    write(path.join(folder,paths[id]),fs.readFileSync(path.join(__dirname,paths[id])));
  }
  const random=noise(12051), synth=(id,value)=>{
    paths[id]='recordings/'+id+'.wav'; wav(path.join(folder,paths[id]),value);
  };
  let soft=0;
  synth('pump-room',frames(13,(t,channel)=>{
    const x=random();
    soft+=.024*(x-soft);
    const spread=channel ? -.007:.007;
    const swell=.79+.21*tone(.198,t);
    return (.063*tone(48,t+spread)+.026*tone(96,t)+.014*tone(181,t+spread)+.053*soft)*swell;
  },2));
  let air=0;
  synth('air-column',frames(3.7,t=>{
    air+=.23*(random()-air);
    return (.12*air+.075*tone(116,t)+.041*tone(287,t))*
      Math.min(1,t*17)*Math.exp(-Math.max(0,t-.7)*1.51);
  }));
  let hiss=0;
  synth('ceiling-water',frames(7.6,(t,ch)=>{
    hiss+=.2*(random()-hiss);
    const ripple=.56+.44*tone(.54,t+ch*.18);
    return Math.min(1,t*.62)*(.073*hiss*ripple+.014*tone(205,t+ch*.011)+
      .037*tone(1331,t)*Math.max(0,tone(.74,t+.46))**12);
  },2));
  synth('tension',frames(duration,(t,ch)=>{
    const wobble=t+.0009*tone(.5,t+ch);
    return (.038*tone(165,wobble)+.027*tone(331,wobble)+.028*tone(1047,wobble)*(.47+.21*tone(2.4,t))+
      .021*tone(1473,wobble))*Math.min(1,t/.9,(duration-t)/1.45);
  },2));
  return paths;
}
function sourceSession(paths,assets) {
  const t=(id,sync=0)=>({asset:id,sync:{sample:sync},
    handles:{fromSample:0,toSample:assets[id].samples.length/assets[id].channels}});
  const clip=(id,track,spot,asset,gain,fadeIn,fadeOut)=>({id,track,spot,take:'main',takes:{main:t(asset)},gain,
    fades:{inSamples:n(fadeIn),outSamples:n(fadeOut),curve:'equal-power'}});
  const clips=[
    clip('directive','dialogue',{shot:'landing',sourceFrame:20},'fan-line',.79,.014,.032),
    clip('warning','dialogue',{shot:'waterline',sourceFrame:14},'water-line',.79,.014,.052),
    clip('switch','foley',{shot:'fan',sourceFrame:23},'metal-hit',.31,.002,.05),
    clip('fan-winddown','effects',{shot:'fan',sourceFrame:23},'air-column',.76,.02,.16),
    clip('water','water',{shot:'waterline',sourceFrame:6},'ceiling-water',1,.30,.27),
    clip('room','ambience',{samples:0},'pump-room',1,.04,.04),
    clip('score','music',{samples:0},'tension',1,.02,.04)
  ];
  return {session:{format:'ink-studio/audio-editorial',version:1,id:'water-above',sampleRate:rate,
    picture:picture('original'),clips},assets:paths};
}
function mixFrom(folder,id,result,revised) {
  const paths=Object.fromEntries(Object.entries(result.stems).map(([name,value])=>{
    const file=id+'-stems/'+name+'.wav'; wav(path.join(folder,file),value);return [name,file];
  }));
  const inputs=Object.fromEntries(Object.entries(paths).map(([name,file])=>[name,WAV.read(path.join(folder,file))]));
  const roomRide={unit:'seconds',points:[{at:0,value:.75},{at:3.65,value:.75},{at:4.02,value:.17},{at:6.42,value:.17},{at:6.63,value:.67}]};
  const volumes={dialogue:revised?1:.84,foley:revised?.72:1,effects:revised?.53:1,
    ambience:revised?.75:roomRide,water:revised?.82:1.11,music:revised?.62:1.18};
  const key={processor:'voice-space',sidechain:{strip:'dialogue',tap:'pre'}};
  const strips=Object.fromEntries(Object.keys(inputs).map(name=>[name,{
    clips:[{id:name,source:name,at:{samples:0}}],fader:volumes[name],
    ...(revised && ['music','water'].includes(name) && {inserts:[key]})
  }]));
  const processors=revised ? {'voice-space':{type:'band-duck',hz:1650,q:.9,keyHz:970,thresholdDb:-37,
    ratio:5,attack:.011,release:.24,rangeDb:7}} : {};
  const mixer={id:'water-'+id,sampleRate:rate,end:{samples:n(duration)},tail:'cut',output:'master',
    strips:{...strips,master:{}},processors,peakPolicy:'error'};
  json(path.join(folder,id+'.mix.json'),{mixer,assets:paths});
  return A.mixer.render(mixer,inputs).value;
}
module.exports=function scene(folder) {
  const paths=recordings(folder), assets=Object.fromEntries(Object.entries(paths).map(([id,file])=>
    [id,WAV.read(path.join(folder,file))]));
  const recipe=sourceSession(paths,assets), original=A.audioEditorial.render(recipe.session,assets,{stems:true});
  const recut=A.audioEditorial.reconform(recipe.session,assets,{picture:picture('revised')});
  assert(recut.report.changes.every(row=>row.status!=='unresolved'));
  assert.deepEqual(recut.report.changes.filter(row=>['switch','warning'].includes(row.id)).map(row=>row.status),['moved','moved']);
  const stems=A.audioEditorial.render(recut.session,assets,{stems:true});
  const initial=mixFrom(folder,'original',original,false);
  const previous=mixFrom(folder,'previous',stems,false), revised=mixFrom(folder,'revised',stems,true);
  for (const [id,value] of Object.entries({original:initial,previous,revised})) wav(path.join(folder,id+'.print.wav'),value);
  const levels=pair(folder,previous,revised);
  json(path.join(folder,'original.editorial.json'),recipe);
  json(path.join(folder,'revised.editorial.json'),{session:recut.session,assets:paths});
  json(path.join(folder,'reconform.json'),recut.report);
  json(path.join(folder,'world.json'),worldSpec());
  json(path.join(folder,'picture-audio.json'),{format:'ink-studio/scene-audio',version:1,sampleRate:rate,
    assets:{room:paths['pump-room']},tracks:[{asset:'room',gain:.12,loop:true,bus:'ambience'}],post:{}});
  json(path.join(folder,'picture-plan.json'),{format:'ink-studio/story-editorial-plan',version:1,id:'water-above',
    title:'The Water Above',soundtrack:'picture-audio.json',
    picture:{fromFrame:0,toFrame:84,fps:captureFps,width:288,height:176,video:false}});
  cli(folder,'sim','run','world.json','--ticks','282','--record','world.run.json');
  cli(folder,'story','handoff','world.run.json','picture-plan.json','--out','source-picture');
  const mapped=read(path.join(folder,'source-picture/picture.json'));
  const png=fs.readdirSync(path.join(folder,'source-picture/picture')).filter(name=>name.endsWith('.png')).sort();
  assert.equal(png.length,84);
  const cuts=Object.fromEntries(Object.entries(shots).map(([id,cuts])=>[id,cuts.flatMap(([shot,from,frames])=>
    Array.from({length:frames},(_,offset)=>{
      const sourceFrame=(tracks[shot]+from+offset)*captureFps/fps;
      return 'source-picture/picture/'+png[Math.floor(sourceFrame)];
    }))]));
  assert.equal(mapped.frames.length,84);
  assert(Object.values(cuts).every(rows=>rows.length===length));
  const evidence={fps,duration,voices:'Synthetic scratch dialogue baked to source WAVs.',cuts,levels,
    changes:recut.report.changes,sources:Object.values(paths),sessions:['original.editorial.json','revised.editorial.json',
      'previous.mix.json','revised.mix.json']};
  json(path.join(folder,'report.json'),evidence);
  return evidence;
};
