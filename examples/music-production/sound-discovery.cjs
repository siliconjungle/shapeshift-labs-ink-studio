/* Run: node examples/music-production/sound-discovery.cjs output-directory */
const assert=require('node:assert/strict'), path=require('node:path'), fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), A=KIT.procedural.mediaGraph;
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
if (!process.argv[2]) throw new TypeError('Choose a sound discovery output directory');
const out=path.resolve(process.argv[2]), rate=24000;
const file=(name,value)=>{const target=path.join(out,name);json(target,value);return target;};
const audio=(name,pcm,encoding='pcm24')=>write(path.join(out,name),WAV.encode(pcm,{encoding}));
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'music','instrument',...args],{encoding:'utf8'}));
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));

const osc=(wave,settings={})=>({type:'oscillator',wave,...settings});
const noise={type:'noise'};
const shape=(attack,decay,sustain,release)=>({type:'envelope',env:{attack,decay,sustain,release}});
const curve=(points,clock='gate')=>({type:'curve',points,clock});
const gain=(input,amount)=>({type:'gain',input,amount});
const move=(input,from,amount=1)=>gain(input,{base:0,from:{[from]:amount}});
const filtered=(input,mode,cutoff,resonance)=>({type:'filter',input,mode,cutoff,resonance});
const mix=(...inputs)=>({type:'mix',inputs});
const ring=(input,decay,modes)=>({type:'resonator',input,decay,
  modes:modes.map(([ratio,gain,decay,shape])=>({ratio,gain,decay,...(shape && {shape})}))});
const graph=(output,tail,nodes,extra={})=>({type:'graph',output,tail,nodes,...extra});
const reed=graph('out',.44,{
  register:curve([[0,.968],[.29,.968],[.36,1.4663],[.63,1.4663],[.71,1.15721],[1,1.15721]]),
  rasp:osc('sine',{ratio:{base:.06448,from:{register:2.015}}}),
  color:osc('sine',{ratio:{base:.032,from:{register:1}},phaseInput:'rasp',
    index:{base:.026,by:{pressure:.075}}}),
  air:noise, throat:filtered('air','bandpass',{base:990,by:{pressure:1380,breath:1700}},1.75),
  hiss:gain('throat',{base:.018,by:{breath:.14,damping:.072}}),
  sum:mix('color','hiss'), env:shape(.047,.28,.76,.36), out:move('sum','env',.76)
},{
  controls:{pressure:.57,breath:.31,damping:.18},
  articulations:{steady:{nodes:{rasp:{ratio:2.015},color:{ratio:1}}}}
});
const plate=graph('out',.76,{
  grit:noise, friction:filtered('grit','bandpass',{base:740,by:{contact:1100}},1.3),
  edge:curve([[0,0],[.08,.23],[.29,.78],[.48,.72],[.72,.25],[1,.10]]),
  excite:move('friction','edge',.88), metal:ring('excite',.69,[[1,.74,1],[2.11,.82,.46,2],[2.93,.46,.42,3],[4.07,.21,.21]]),
  bow:osc('triangle',{ratio:1.003}), singing:curve([[0,0],[.35,0],[.64,.75],[.92,1],[1,.66]]),
  center:move('bow','singing',.45), wash:gain('metal',2.4), sum:mix('wash','center'),
  env:shape(.019,.22,.80,.62), out:move('sum','env',.64)
});
const bell=graph('out',.94,{
  hit:noise, contact:curve([[0,1],[.0018,.9],[.006,0]],'seconds'), tap:move('hit','contact'),
  bronze:ring('tap',{base:1.32,by:{velocity:-1.20,damping:-.25}},[
    [1,.94,1.45],[2.197,.66,1.08,1],[2.74,.50,.55,2],[4.16,.37,.31,3],[5.38,.22,.17]]),
  out:gain('bronze',1.85)
},{controls:{damping:.18}});
const wire=graph('out',.79,{
  strike:noise, pluck:curve([[0,1],[.001,1],[.031,0]],'seconds'), input:move('strike','pluck',.88),
  core:ring('input',.73,[[1,.92,1.1],[1.997,.58,.72],[3.015,.32,.49],[5.002,.25,.2]]),
  ringing:gain('core',2.7), loop:{type:'delay',input:'soft',seconds:.018,gain:.76}, sum:mix('ringing','loop'),
  soft:filtered('sum','lowpass',2630,1.4), out:gain('sum',.67)
});
const porcelain=graph('out',.52,{
  grit:noise, drag:curve([[0,1],[.004,.23],[.012,0],[.043,0],[.046,.70],[.058,0]],'seconds'),
  tap:move('grit','drag'), ring:ring('tap',.38,[[1,.65,.91],[2.78,.48,.82],[5.14,.31,.23],[7.037,.21,.17]]),
  contact:gain('tap',.31), body:gain('ring',3.4), out:mix('contact','body')
});
const rubber=graph('out',.31,{
  slip:curve([[0,1.23],[.029,1.07],[.075,.75],[.17,.57],[.275,.53]],'seconds'),
  body:osc('sine',{ratio:{base:.032,from:{slip:1}}}),
  edge:noise, rub:filtered('edge','lowpass',1100,.8), tap:curve([[0,1],[.026,.33],[.09,0]],'seconds'),
  friction:move('rub','tap',.64), mix:mix('body','friction'), env:shape(.008,.30,.1,.23), out:move('mix','env',.76)
});
const foil=graph({left:'near',right:'far'},.61,{
  metal:osc('sine',{ratio:3.757}), carrier:osc('sine',{phaseInput:'metal',
    index:{base:.07,by:{velocity:.19,pressure:.055}}}),
  env:shape(.006,.30,.23,.48), hit:move('carrier','env',.71),
  edge:{type:'drive',input:'hit',amount:1.97}, smear:{type:'delay',input:'low',seconds:.063,gain:.56},
  loop:mix('edge','smear'), low:filtered('loop','lowpass',3250,1.35),
  near:gain('loop',.73), far:gain('low',.68)
});
const bristle=graph('out',.27,{
  grain:noise, grit:filtered('grain','highpass',{base:830,by:{contact:2800}},.85),
  width:curve([[0,0],[.07,.84],[.20,.15],[.36,.54],[.43,.22],[.61,.43],[.84,.19],[1,.03]]),
  sweeps:move('grit','width'), env:shape(.006,.22,.73,.18), out:move('sweeps','env',.70)
});
const pipe=graph('out',.63,{
  air:noise, edge:filtered('air','bandpass',{base:750,by:{breath:2100}},1.17),
  body:osc('triangle',{ratio:1.0008}), lip:gain('edge',{base:.06,by:{breath:.43}}),
  wind:mix('body','lip'), resonant:filtered('wind','lowpass',{base:420,by:{pressure:1050,breath:950}},1.52),
  env:shape(.23,.44,.69,.46), out:move('resonant','env',.64)
},{controls:{breath:.65,pressure:.47}});
const candidates=[
  {id:'split-reed',label:'Split reed',family:'register-break',patch:reed,root:'C4'},
  {id:'singing-plate',label:'Singing plate',family:'bowed-friction',patch:plate},
  {id:'clamped-bell',label:'Clamped bell',family:'velocity-damped-metal',patch:bell},
  {id:'drawn-wire',label:'Drawn wire',family:'plucked-feedback',patch:wire},
  {id:'porcelain-tabs',label:'Porcelain tabs',family:'double-contact-ceramic',patch:porcelain},
  {id:'rubber-skin',label:'Rubber skin',family:'bending-membrane',patch:rubber},
  {id:'foil-echo',label:'Foil echo',family:'phase-modulation',patch:foil},
  {id:'bristle',label:'Bristle',family:'friction-noise',patch:bristle},
  {id:'pipe-air',label:'Pipe air',family:'wind-column',patch:pipe},
  {id:'granite-slide',label:'Granite slide',family:'granular-contact',source:{gesture:{model:'scrape',duration:.94,
    parameters:{speed:.19,pressure:.78,body:266,grain:.87}}},root:'C4'},
  {id:'button-brass',label:'Button brass',family:'inharmonic-strike',source:{gesture:{model:'metal',duration:1.18,
    parameters:{body:293,hardness:.87,decay:.94,strike:.26}}},root:'D4'},
  {id:'vowel-hinge',label:'Vowel hinge',family:'sampled-breath',source:{gesture:{model:'breath',duration:1.02,
    parameters:{pitchStart:210,pitchEnd:288,voice:.80,roughTail:.88,throat:1490}}},root:'C4'}
];
const spec={id:'blackwater-instruments',seed:3071,candidates,settings:{sampleRate:rate,keys:['C3','C4','C5'],
  velocities:[.44,.86],anchor:{key:'C4',velocity:.86}}};
const audition=cli('discover',file('sources.json',{discovery:spec}),'--out',path.join(out,'audition'));
const manifest=read(audition.report);
assert.equal(manifest.candidates.length,12);
assert(manifest.candidates.every(row=>row.anchorLufs!==null));
const select={candidate:'split-reed',reason:'The pitch break gives the line a phrase with a distinct high middle and a lower answer.',
  trigger:{gate:1.09,key:'C4',velocity:.81},range:{low:'G3',high:'E5'},
  projection:{beats:2.72,pitchStep:2.5,minNoteMs:120}};
const kept=cli('keep-discovery',audition.bank,file('choose-lead.json',select),'--out',path.join(out,'lead'));
const motif=read(kept.motif).motifs.contour;
assert(motif.events.length>=3,'The chosen sound must supply its audible contour');
const strike=manifest.candidates.find(row=>row.id==='porcelain-tabs').cells.find(row=>row.id===manifest.anchor.id)
  .events.find(row=>row.id==='strike').startSample;
const pick={candidate:'porcelain-tabs',reason:'The two offset contacts make a useful drum answer.',
  from:'slice',slice:{cell:manifest.anchor.id,fromSample:strike,toSample:strike+Math.round(.19*rate)},resample:true};
const printed=cli('keep-discovery',audition.bank,file('choose-percussion.json',pick),'--out',path.join(out,'percussion'));

const lead=read(kept.instrument), hit=read(printed.instrument);
const audioPaths={...Object.fromEntries(Object.entries(lead.assets).map(([name,file])=>[name,'lead/'+file])),
  ...Object.fromEntries(Object.entries(hit.assets).map(([name,file])=>[name,'percussion/'+file])),
  'reed-first':'lead/gesture.wav'};
const assets=Object.fromEntries(Object.entries(audioPaths).map(([name,file])=>[name,WAV.read(path.join(out,file))]));
const n=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const clip=(notes,mode)=>[{id:'piece',beat:0,length:56,voices:[{id:'main',notes}],...(mode && {mode})}];
const rounded=value=>Number(value.toFixed(7));
function call(id,beat,interval,strength,steady=true) {
  return motif.events.map((event,index)=>n(id+'-'+event.id,rounded(beat+event.beat),event.duration,event.midi+interval,
    rounded(event.velocity*strength),{
      ...(steady && {articulation:'steady'}),
      curves:{pitchCents:event.play.curves.pitchCents,
        gainDb:event.play.curves.gainDb.map(([x,y])=>[x,Math.max(-10,.68*y)]),
        breath:[[0,.22],[.56,.75],[1,.34]],pressure:[[0,.43],[.63,.67],[1,.26]]},
      vibrato:index===1 ? 13 : 6
    }));
}
const guide={length:1,events:[n('silence',0,.1,60,0)]};
const sections=[
  {id:'door',bars:2,harmony:'bare'}, {id:'first-call',bars:4,harmony:'low'},
  {id:'drift',bars:2,harmony:'bare'}, {id:'return',bars:4,harmony:'rise'}, {id:'after',bars:2,harmony:'bare'}
];
const production={seed:3071,arrangement:{
  score:{key:{root:'C3',mode:'minor'},tempoMap:{tempo:112},endFade:.28,
    harmonies:{bare:{root:'C3',quality:'unison'},low:{root:'C3',quality:'minor'},rise:{root:'Ab3',quality:'major'}}},
  motifs:{guide},sections,parts:{lead:{role:'lead',material:'guide'},tabs:{role:'percussion',material:'guide'},
    bottom:{role:'bass',material:'guide'},metal:{role:'pad',material:'guide'},dust:{role:'percussion',material:'guide'}}
},patches:{
  lead:lead.patch,tabs:hit.patch,metal:plate,dust:bristle,
  bottom:{type:'subtractive',saw:.14,pulse:.28,sub:.68,filter:{cutoff:510,resonance:1.2,envAmount:21},
    env:{attack:.031,decay:.48,sustain:.63,release:.31}}
},tracks:{
  lead:{patch:'lead',gain:-9.5,send:.34,pan:.075,highpass:120,clips:clip([
    ...call('reply',8.22,0,.85), ...call('fragment',16.16,-5,.69), ...call('return',34.18,0,.99),
    ...call('height',42.06,5,.93),
    n('open-release',51.15,2.12,60,.56,{curves:{breath:[[0,.34],[.37,.58],[1,.12]],pressure:[[0,.28],[.67,.67],[1,.27]]}})
  ])},
  tabs:{patch:'tabs',highpass:420,gain:-9,pan:-.23,send:.45,clips:clip([
    ...[3.45,6.24,11.68,13.22,15.12,19.48,21.22,23.02,26.74,31.83,33.45,36.86,39.35,41.62,44.92,47.70]
      .map((at,i)=>n('tap-'+i,at,.23,i%5===1 ? 55 : 60,[.64,.49,.70,.58][i%4]))
  ],'layer')},
  bottom:{patch:'bottom',gain:-9,lowpass:720,clips:clip([
    n('gather',10.8,1.63,36,.65),n('under',14.08,1.52,36,.71),n('rise',19.63,2.45,43,.68),
    n('separate',22.63,1.16,34,.54),n('late',36.36,1.64,32,.81),n('late-answer',40.05,2.02,39,.67),
    n('sink',44.53,2.72,36,.76),n('still',49.63,2.42,36,.49)
  ])},
  metal:{patch:'metal',gain:-16.2,highpass:140,lowpass:6800,pan:.23,send:.65,clips:clip([
    n('shadow',1.73,3.12,43,.44),n('answer',12.44,2.30,55,.61),n('hang',24.16,4.62,48,.77),
    n('before',29.43,2.74,51,.57),n('halo',37.22,2.30,67,.55),n('side',45.24,2.21,63,.49),
    n('off',51.44,2.55,48,.44)
  ])},
  dust:{patch:'dust',gain:-14,send:.41,pan:-.12,clips:clip([5.23,7.58,12.9,14.44,18.4,20.57,22.24,27.12,30.61,
    32.38,37.80,40.85,43.94,45.45,48.1].map((beat,i)=>n('brush-'+i,beat,.30,48,[.46,.60,.55][i%3])),'layer')}
},room:{gain:-13,size:1.25,damping:.53,decay:.76}};
const session={format:'ink-studio/music-edit-session',version:1,id:'blackwater',sampleRate:44100,production,
  audio:{source:{take:'original',takes:{original:{asset:'reed-first',at:{seconds:.25}}}}},
  mixer:{output:'master',strips:{master:{fader:2.12},source:{fader:.86}},taps:{lead:{strip:'lead'},tabs:{strip:'tabs'}}}};
const render=A.musicSession.create(assets).render(session);
audio('blackwater.wav',render.value);
const {report}=render;
file('blackwater-session.json',{session,assets:audioPaths});
file('blackwater-report.json',report);
console.log(JSON.stringify({audition:audition.audio,cue:path.join(out,'blackwater.wav'),
  chosen:select.candidate,cells:manifest.candidates.length*manifest.candidates[0].cells.length,
  contour:motif.events.map(({midi,beat})=>[midi,beat])},null,2));
