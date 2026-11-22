/* Perform a deterministic take through the same clip-jam engine as the browser. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict'), ink=require('../..');
const {describe}=require('../../cli/music-sound-library.js');
const rate=32000;
const root='D3';
const levels=notes=>notes.map(([beat,midi,duration,velocity,play],i)=>({id:'n'+(i+1),beat,midi,duration,velocity,...(play && {play})}));
const slot=(id,length,...voices)=>({id,length,voices:voices.map((notes,i)=>({id:'line-'+(i+1),notes:levels(notes)}))});
const hits=(midi,notes)=>notes.map(([beat,velocity])=>[beat,midi,.10,velocity]);
const touch=(pressure,breath)=>({pressure,breath});

function fixture(sampleRate=rate) {
  const {patches:acoustic}=describe('drums-and-bass');
  const bank={id:'After-the-Bell',bars:16,quantize:'beat',initial:{kick:'pocket',drums:'ticks',bass:'undertow'},clips:{
    kick:[
      slot('pocket',4,hits(36,[[0,.89],[1.63,.69],[2.77,.79]])),
      slot('cross-step',4,hits(36,[[0,.91],[.77,.56],[2.06,.85],[3.40,.7]])),
      slot('half-lit',4,hits(36,[[0,.82],[2.5,.71]]))
    ],
    drums:[
      slot('ticks',4,hits(42,[[.48,.48],[1.02,.31],[1.51,.57],[2.52,.43],[3.04,.29],[3.53,.57]]),
        hits(38,[[1.06,.62],[3.042,.71]])),
      slot('split',4,hits(42,[[.51,.53],[1.28,.34],[1.79,.60],[2.49,.47],[3.01,.30],[3.51,.57]]),
        hits(38,[[1.12,.66],[2.26,.24],[2.96,.73],[3.71,.35]])),
      slot('afterimage',4,hits(42,[[.75,.35],[1.49,.54],[2.72,.33],[3.53,.45]]),
        hits(38,[[1.05,.56],[3.08,.64]]))
    ],
    bass:[
      slot('undertow',8,[[.20,38,1.32,.78],[1.66,45,.42,.52],[2.79,38,.78,.74],
        [4.15,36,.96,.72],[5.38,41,.36,.59],[6.11,34,1.05,.72],[7.41,33,.39,.53]]),
      slot('turn',4,[[.07,38,.65,.85],[.86,41,.29,.64],[1.46,40,.4,.55],[2.14,33,.98,.74],[3.46,36,.32,.53]]),
      slot('floor',4,[[.15,38,1.84,.74],[2.57,34,.82,.62],[3.55,36,.29,.53]])
    ],
    lead:[
      slot('glass',8,[[.66,69,.44,.72],[2.15,72,.36,.62],[3.00,64,.58,.68],[4.81,65,.44,.62],
        [5.43,69,.36,.53],[6.62,67,.52,.59],[7.46,64,.28,.51]],
        [[.69,62,.34,.51],[3.02,53,.48,.51],[4.83,58,.3,.41],[6.66,60,.43,.50]]),
      slot('answer',8,[[.52,77,.24,.66],[1.1,76,.48,.71],[2.04,72,.57,.64],[3.41,69,.35,.66],
        [4.41,67,.57,.59],[6.13,69,.33,.70],[6.65,64,.39,.59],[7.23,62,.56,.59]],
        [[1.16,65,.37,.44],[2.06,64,.31,.40],[4.49,58,.46,.50],[7.25,53,.42,.43]]),
      slot('last-light',4,[[.78,76,.52,.56,touch(.28,.27)],[2.22,72,.34,.57],[3.14,69,.65,.51]],
        [[.82,62,.45,.40],[3.15,53,.59,.38]])
    ]
  }};
  const group={type:'zoned',instruments:{snare:acoustic.snare,hat:acoustic['closed-hat']},zones:[
    {instrument:'snare',low:38,high:38,velocity:[0,1]},{instrument:'hat',low:42,high:42,velocity:[0,1]}
  ]};
  const session={format:'ink-studio/music-edit-session',version:1,id:bank.id,sampleRate,production:{
    seed:24715,gain:1.5,arrangement:{score:{key:{root,mode:'minor'},tempoMap:{tempo:114,swing:.545,
      changes:[{beat:32,tempo:118,swing:.525}]},harmonies:{home:{root,quality:'minor'}}},motifs:{},
      parts:{kick:{role:'percussion'},drums:{role:'percussion'},bass:{role:'bass'},lead:{role:'lead'}},
      sections:[{id:'bank',bars:16,harmony:'home'}]},
    patches:{kick:acoustic.kick,drums:group,bass:{type:'analog',ratio:1,body:.58,drive:1.25,width:1.8,
      env:{attack:.013,decay:.23,sustain:.80,release:.11}},
    lead:{type:'keys',tine:.72,bite:.27,wear:.19,dust:.012,drive:1.12,color:.54,
      env:{attack:.013,decay:.6,sustain:.25,release:.28}}},
    tracks:{kick:{patch:'kick',gain:-8,highpass:27},drums:{patch:'drums',gain:-14,highpass:126,pan:.13},
      bass:{patch:'bass',gain:-10,highpass:32,lowpass:1150},lead:{patch:'lead',gain:-13,highpass:118,pan:-.12}},
    room:{gain:-12,size:.8,decay:.70,damping:.68}},
    mixer:{output:'master',strips:{master:{},kick:{sends:{room:{level:.02}}},drums:{sends:{room:{level:.30}}},
      bass:{sends:{room:{level:.035}},inserts:[{processor:'duck',sidechain:{strip:'kick',tap:'pre'}}]},
      lead:{sends:{room:{level:.32},echo:{level:.11}}},room:{inserts:['small-room'],fader:.75},echo:{inserts:['tape'],fader:.73}},
      processors:{duck:{type:'compressor',thresholdDb:-30,attack:.002,release:.12,ratio:5.8},
        'small-room':{type:'reverb',size:.82,decay:.92,damping:.66,wet:1},
        tape:{type:'tempo-delay',beats:.75,feedback:.32,wet:1}},
      taps:{lead:{strip:'lead',tap:'post'},bass:{strip:'bass',tap:'input'},echo:{strip:'echo'},room:{strip:'room'}}}};
  return {session,bank};
}

function publish(folder) {
  const out=path.resolve(folder);
  fs.mkdirSync(out,{recursive:true});
  const at=name=>path.join(out,name);
  const json=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value,null,2)+'\n');
  const {session,bank}=fixture(), P=ink.load().KIT.procedural, M=P.mediaGraph;
  const pack=describe('drums-and-bass'), files={}, sourceCredits={}, assets={};
  fs.mkdirSync(at('samples'),{recursive:true});
  for (const name of new Set(Object.values(session.production.patches).flatMap(P.musicInstruments.assetNames))) {
    const {file,credit,original}=pack.sources[name], relative='samples/'+path.basename(file);
    fs.copyFileSync(file,at(relative));
    files[name]=relative;
    sourceCredits[name]={credit,original};
    assets[name]=ink.readWav(file);
  }
  const editor=M.musicSession.create(assets), jam=M.musicSessionJam.open(editor,session,bank);
  const {beatSamples}=jam.state(), chunks=[], performance=[];
  const pullTo=frame=>{
    while (jam.state().frame<frame && !jam.state().done)
      chunks.push(jam.pull(Math.min(3072,frame-jam.state().frame)).value.samples);
  };
  function run(beat,action) {
    const unit=beat%1, whole=Math.floor(beat);
    const frame=Math.round(beatSamples[whole]+unit*(beatSamples[whole+1]-beatSamples[whole]));
    pullTo(frame);
    const result=action();
    performance.push({requestFrame:frame,...result});
  }
  const launch=(beat,defs,quantize='beat')=>run(beat,()=>({
    ...jam.launch({quantize,launches:Object.entries(defs).map(([lane,clip])=>({lane,clip}))}),launches:defs}));
  const move=(beat,row)=>run(beat,()=>({...jam.move(row),control:row}));
  launch(3.5,{lead:'glass'});
  move(5.36,{lane:'lead',send:'echo',value:.53});
  move(6.07,{lane:'lead',send:'echo',value:.77});
  launch(7.30,{bass:'turn',drums:'split',kick:'cross-step',lead:'answer'},'bar');
  move(8.63,{lane:'lead',send:'echo',value:.24});
  launch(13.3,{kick:'half-lit'});
  move(14.52,{lane:'lead',send:'echo',value:.67});
  launch(15.45,{kick:null,drums:null,bass:null,lead:null},'bar');
  launch(19.48,{kick:'pocket',drums:'ticks',bass:'undertow',lead:'glass'},'bar');
  move(22.22,{lane:'bass',muted:true});
  move(23.27,{lane:'lead',send:'echo',value:1.12});
  move(24.54,{lane:'lead',send:'echo',value:.40});
  move(25.15,{lane:'bass',muted:false});
  launch(27.61,{bass:'turn',drums:'split',lead:'answer'},'bar');
  move(31.54,{lane:'lead',send:'echo',value:.63});
  launch(35.35,{bass:'floor',kick:'half-lit',drums:'afterimage',lead:'last-light'},'bar');
  move(38.32,{lane:'lead',send:'echo',value:.18});
  launch(42.53,{drums:null});
  launch(45.2,{kick:null,bass:null});
  run(47.35,()=>({...jam.finish(),finish:true}));
  pullTo(jam.state().stop.frame);
  const take=jam.arrangement(), frames=jam.state().frame, samples=new Float32Array(frames*2);
  let offset=0;
  for (const chunk of chunks) {samples.set(chunk,offset);offset+=chunk.length;}
  const result=editor.render(take), meter=M.mixerMonitor.meter(result.value);
  assert.ok(result.value.samples.length>=samples.length);
  const error=samples.reduce((max,x,i)=>Math.max(max,Math.abs(x-result.value.samples[i])),0);
  assert.ok(error<2e-7,'The saved clips and mixer moves should replay the pass ('+error+')');
  assert.ok(meter.truePeakDbTP<-1 && meter.integratedLufs>-27,'Keep the jam audible and unclipped');
  fs.writeFileSync(at('after-the-bell.wav'),ink.encodeWav(result.value,{encoding:'pcm24'}));
  json('source.json',{session,assets:files});
  json('bank.json',bank);
  json('arrangement.json',{session:take,assets:files});
  json('sample-credits.json',{credits:Object.fromEntries(Object.entries(pack.credits)
    .filter(([name])=>Object.values(sourceCredits).some(row=>row.credit===name))),sources:sourceCredits});
  const clips=Object.fromEntries(Object.entries(take.production.tracks).map(([lane,{clips}])=>
    [lane,clips.map(({id,beat,length})=>({label:id.replace(/^b\d+-/,''),beat,length}))]));
  json('performance.json',{bars:jam.state().stop.beat/4,sampleRate:rate,frames,beats:beatSamples.slice(0,jam.state().stop.beat+1),
    clips,automation:take.automation,performance,meter,error});
  const html=fs.readFileSync(path.join(__dirname,'clip-jam.html'),'utf8');
  fs.writeFileSync(at('index.html'),html.replace('/*CAPTURE*/ null',JSON.stringify({
    clips,beats:beatSamples.slice(0,jam.state().stop.beat+1),sampleRate:rate,automation:take.automation
  })));
  process.stdout.write(out+'\n');
}

if (require.main===module) publish(process.argv[2] ?? 'after-the-bell');
module.exports={fixture};
