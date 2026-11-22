const path=require('node:path');
const WAV=require('../../cli/wav.js');
const tau=2*Math.PI,sampleRate=24000;
const sources=['metal-soft','metal-alt','metal-hit'].map(id=>WAV.read(
  path.join(__dirname,'../music-production/samples',id+'.wav')));
const families={
  reed:{title:'Paper Reed',registers:[57,64,71],range:[52,76],articulations:['spoken','air'],fit:'spectral'},
  plate:{title:'Braked Plate',registers:[48,55,62],range:[43,67],articulations:['edge','center'],fit:'modal'},
  bass:{title:'Copper String',registers:[35,43,50],range:[30,54],articulations:['finger','muted'],fit:'spectral'}
};
const dynamics=[{id:'soft',velocity:.28},{id:'firm',velocity:.81}];
const sat=x=>Math.max(0,Math.min(1,x));
const ramp=(t,d)=>sat(t/d);
function take(family,key,velocity,touch,repeat) {
  const hz=440*2**((key-69)/12), v=velocity, round=(t)=>Math.round(t*sampleRate);
  const release=.70+.017*repeat, length=round(release+.35);
  let rng=(key*2137+repeat*17+touch*503+round(v))>>>0, low=0, narrow=0, phase=.13*repeat;
  const bank=sources[(touch+repeat+Math.round(v))%sources.length];
  const direct=Float64Array.from({length},(_,i)=>{
    const t=i/sampleRate, age=Math.max(0,t-.018-.002*repeat), after=Math.max(0,t-release);
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    const noise=rng/2147483648-1;
    low+=.085*(noise-low);narrow+=.285*(noise-narrow);
    const air=narrow-low;
    const flutter=1+.0042*Math.sin(tau*4.9*age)+.0014*Math.sin(tau*8.27*age);
    phase+=tau*hz*flutter/sampleRate;
    const a=(k)=>Math.sin(k*phase);
    const bow=.89+.11*Math.sin(tau*2.11*age+.37*repeat);
    const end=ramp((length-i-1)/sampleRate,.026);
    if (family==='reed') {
      const articulation=touch ? .73:1, tone=(.55*a(1)+(.13+.08*v)*a(2)+(.055+.048*v)*a(3)+.031*a(5));
      const excite=(.08+.34*Number(touch))*air+(noise-low)*.03;
      const latch=ramp(age,touch?.11:.046), shut=Math.exp(-after*(touch?26:17));
      const breathOff=(.12+.07*v)*air*Math.exp(-after*18)*ramp(after,.005);
      return end*(ramp(age,.012)*latch*shut*(tone*articulation*bow+excite)*(.26+.55*v)+breathOff);
    }
    if (family==='plate') {
      const partials=touch ? [1,2.18,3.74,4.91,7.8] : [1,1.43,2.76,5.37,7.01];
      const weight=touch ? [.61,.22,.48,.19,.16] : [.45,.46,.20,.32,.15];
      const decay=(v>.6?8.0:3.3)*(touch?1.26:1);
      const ring=partials.reduce((acc,k,j)=>acc+weight[j]*Math.sin(tau*hz*k*age+.045*repeat*j)*
        Math.exp(-age*decay*(1+j*.29)),0);
      const captured=bank.samples[Math.floor(age*bank.sampleRate*(.79+key/190))] ?? 0;
      const damp=.246*air*Math.exp(-after*55)*ramp(after,.002);
      return end*((ring*.48+captured*Math.exp(-age*38)*.32)*ramp(age,.002)*(.33+.51*v)*Math.exp(-20*after)+damp);
    }
    const decay=touch?6.9:2.21, twang=a(1)*.78+.24*a(2)+.19*a(3)+.12*a(4)+.06*a(6);
    const finger=(.40*air+.10*a(7))*Math.exp(-age*(touch?28:38));
    const pickup=.70*twang*Math.exp(-age*decay)+finger;
    const fret=(.29*air+.061*Math.sin(tau*hz*after))*Math.exp(-after*(touch?27:18))*ramp(after,.003);
    return end*(pickup*ramp(age,.004)*Math.exp(-after*23)*(.35+.52*v)+fret);
  });
  return {direct,release:round(release)};
}
function recordings(id) {
  const family=families[id], {title,registers,range,articulations}=family;
  const session={format:'ink-studio/instrument-session',version:1,id,sampleRate,
    perspectives:{close:{asset:'close'},room:{asset:'room',offsetSamples:27}},
    analyze:'close',registers,range,dynamics,articulations,takes:[]};
  const segments=[];
  let at=0;
  for (const [touch,art] of articulations.entries()) for (const key of registers) for (const dynamic of dynamics) {
    const length=id==='plate' && touch===1 && key===registers[2] && dynamic.id==='soft' ? 0 :
      id==='reed' && touch===1 && key===registers[2] && dynamic.id==='firm' ? 1 : 3;
    for (let i=0;i<length;i++) {
      const {direct,release}=take(id,key,dynamic.velocity,touch,i);
      const fromSample=at,toSample=at+direct.length;
      const name=art+'-'+key+'-'+dynamic.id+'-'+(i+1);
      session.takes.push({id:name,key,dynamic:dynamic.id,articulation:art,fromSample,toSample,releaseSample:fromSample+release});
      segments.push({at,direct});
      at=toSample+Math.round(sampleRate*.079);
    }
  }
  const close=new Float64Array(at), room=new Float64Array(at*2+54);
  for (const {at,direct} of segments) {
    close.set(direct,at);
    let low=0;
    for (let frame=0;frame<direct.length;frame++) {
      low+=.29*((direct[frame-83] ?? 0)-low);
      room[2*(27+at+frame)]=.59*low+.21*(direct[frame-493] ?? 0)+.12*(direct[frame-981] ?? 0);
      room[2*(27+at+frame)+1]=.54*low+.23*(direct[frame-601] ?? 0)+.17*(direct[frame-1137] ?? 0);
    }
  }
  return {title,session,assets:{close:{sampleRate,channels:1,samples:close},room:{sampleRate,channels:2,samples:room}}};
}
module.exports={families,recordings,sampleRate};
