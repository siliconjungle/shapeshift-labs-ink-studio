const assert=require('node:assert/strict');
const {fs,path,ink,write,json,read,rate,WAV,wav,frames,tone,noise,cli,pair,copyStock}=require('./support.cjs');
const names=['landing','passage','chamber'], fade={previous:.035,revised:.40};
const action=(tick,value)=>({tick,action:'world/input',args:{port:'score/parameter.route',value}});
const transition=(id,from,to,op,value,cue)=>({id,from,to,quantize:'half-bar',
  when:{path:'/parameters/route',op,value},...(cue && {cue})});
const world={format:'ink-studio/world',version:1,id:'relay-chamber',dt:.05,seed:61,history:{enabled:false},
  systems:{score:{kind:'adaptive-music',config:{tempo:120,entry:'landing',parameters:{route:{default:0}},
    sections:Object.fromEntries(names.map(name=>[name,{resource:name}])),
    cues:{reveal:{resource:'reveal'}},transitions:[
      transition('leave-landing','landing','passage','gte',.40),
      transition('turn-back','passage','landing','lte',.18),
      transition('reveal','passage','chamber','gte',.82,'reveal'),
      transition('leave-chamber','chamber','passage','lte',.70)
    ]}}}};
const routes=[
  {id:'early',label:'Early arrival',inputs:[[9,.54],[27,1]],prefix:['landing','passage','chamber']},
  {id:'reversal',label:'Reversal',inputs:[[9,.54],[31,0],[63,.54],[86,1]],
    prefix:['landing','passage','landing','passage','chamber']},
  {id:'dwell',label:'Long dwell',inputs:[[9,.54],[177,1]],prefix:['landing','passage','chamber']}
];
const bell=(t,hz,decay)=>t<0?0:tone(hz,t)*Math.min(1,t*90)*Math.exp(-t*decay);
const edge=(t,d)=>Math.min(1,t*58,(d-t)*58);
function sources(folder) {
  const paths=copyStock(folder,['metal-soft']);
  const source=WAV.read(path.join(folder,paths['metal-soft']));
  const save=(id,value)=>{
    paths[id]='recordings/'+id+'.wav';wav(path.join(folder,paths[id]),value);
  };
  const recorded=t=>source.samples[Math.round(t*source.sampleRate)] ?? 0;
  for (const edited of ['previous','revised']) {
    const smooth=edited==='revised';
    for (const [i,name] of names.entries()) save(edited+'-'+name,frames(2,(t,side)=>{
      const stereo=side ? .013 : -.008;
      const first=[3,5,6][i], phase=i===1 ? .29 : i===2 ? .12 : 0;
      const shaped=bell(t-phase,55*first,3.3)*.052+bell(t-.75-phase,55*(first+1),4.9)*.042+
        bell(t-1.315,110*first,8.2)*.038;
      return edge(t,2)*(shaped+(smooth ? .029*tone([110,110,165][i],t+stereo)*Math.sin(Math.PI*t/2)**.82
        : .060*tone([110,123.5,164.8][i],t+stereo)*Math.min(1,t*13)));
    },2));
    const random=noise(721), scale=smooth?.8:1;
    save(edited+'-reveal',frames(3.7,(t,side)=>{
      const shift=side ? .022:0, fundamental=smooth?293.66:329.63;
      return scale*Math.min(1,(3.7-t)*6)*(.15*bell(t-shift,fundamental,smooth?1.35:3.5)
        +.071*bell(t-.29-shift,fundamental*1.5,2.5)
        +.05*bell(t-.67-shift,fundamental*2.003,2)
        +.12*recorded(t*.8)+.036*random()*Math.exp(-t*14)*Math.min(1,t*50));
    },2));
  }
  save('carrier',frames(4,(t,side)=>{
    const lap=t*.25, x=side ? .05:-.018;
    return .037*tone(55,t+x)+.018*tone(110,t+x)+.015*tone(165,t+x)*
      (.55+.45*Math.cos(2*Math.PI*lap));
  },2));
  return paths;
}
function soundtrack(version,paths) {
  const assets=Object.fromEntries([...names,'reveal'].map(name=>[name,paths[version+'-'+name]]));
  if (version==='revised') assets.carrier=paths.carrier;
  return {format:'ink-studio/scene-audio',version:1,sampleRate:rate,assets,
    music:{system:'score',gain:.90,fade:fade[version]},
    ...(version==='revised' && {tracks:[{asset:'carrier',loop:true,gain:.72,bus:'ambience'}]}),
    post:{}};
}
module.exports=function generate(folder) {
  const paths=sources(folder);
  json(path.join(folder,'world.json'),world);
  for (const version of ['previous','revised']) json(path.join(folder,version+'.soundtrack.json'),soundtrack(version,paths));
  const evidence=routes.map(({id,label,inputs,prefix})=>{
    json(path.join(folder,id+'.world.json'),{...world,id:'relay-'+id,commands:inputs.map(row=>action(...row))});
    cli(folder,'sim','run',id+'.world.json','--ticks','272','--record',id+'.run.json');
    const prints=['previous','revised'].map(version=>{
      const out=id+'/'+version+'-print';
      cli(folder,'story','audio',id+'.run.json',version+'.soundtrack.json','--out',out);
      const report=read(path.join(folder,out,'report.json'));
      assert.deepEqual(report.sections.map(row=>row.section),prefix);
      const reveal=report.cues.find(row=>row.cue==='reveal');
      assert(reveal && Number.isInteger(reveal.onsetSample));
      const audio=WAV.read(path.join(folder,out,'mix.wav')), first=reveal.onsetSample-rate*1.5;
      const frames=rate*5;
      assert(first>=0 && (first+frames)*2<=audio.samples.length);
      return {audio:{...audio,samples:audio.samples.slice(first*2,(first+frames)*2)},reveal:reveal.onsetSample,section:report.sections};
    });
    assert.equal(prints[0].reveal,prints[1].reveal);
    return {id,label,revealSeconds:prints[1].reveal/rate,sections:prints[1].section,
      levels:pair(path.join(folder,id),...prints.map(row=>row.audio))};
  });
  assert(evidence[0].revealSeconds<evidence[1].revealSeconds && evidence[1].revealSeconds<evidence[2].revealSeconds);
  const carrier=route=>fs.readFileSync(path.join(folder,route.id,'revised-print/ambience.wav'));
  for (const route of evidence.slice(1)) assert(carrier(route).equals(carrier(evidence[0])),
    'The revised carrier should keep the same phase across every route');
  write(path.join(folder,'ink-runtime.js'),ink.bundle({profile:'development',format:'script'}));
  const data={world,routes,fade,assets:Object.fromEntries(Object.entries(paths).filter(([id])=>id!=='metal-soft')
    .map(([id,ref])=>[id,fs.readFileSync(path.join(folder,ref)).toString('base64')]))};
  write(path.join(folder,'player-data.js'),'const BENCHMARK='+JSON.stringify(data)+';\n');
  for (const file of ['play.html','play.js']) write(path.join(folder,file),fs.readFileSync(path.join(__dirname,file)));
  const report={routes:evidence,sources:Object.values(paths),sessions:['world.json','previous.soundtrack.json','revised.soundtrack.json'],
    excerpt:{before:1.5,after:3.5},sameCarrierAcrossRoutes:true,player:'play.html'};
  json(path.join(folder,'report.json'),report);
  return report;
};
