/* A CLI listening study with one real bass performance and a measured lead-in. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'), ink=require('../..');
const {describe}=require('../../cli/music-sound-library.js');
const {production,row}=require('../native-sound-library/performances.cjs');
const rate=32000;
const rhythms=[
  [[.12,.88],[1.60,.69],[2.76,.83]],
  [[.10,.86],[1.48,.62],[2.86,.79],[3.55,.61]],
  [[.08,.90],[1.64,.72],[2.66,.81]],
  [[.10,.88],[1.36,.67],[2.55,.82],[3.59,.66]]
];
const pitches=[[28,28,35],[28,31,33,35],[36,36,31],[33,35,28,28]];
const late=[[.044,.030,.051],[.041,.064,.024,.039],[.031,.057,.035],[.036,.048,.027,.049]];
const kick=rhythms.flatMap((bar,i)=>bar.map(([beat,vel])=>row(4*i+beat,36,.13,vel)));
const bass=rhythms.flatMap((bar,i)=>bar.map(([beat,vel],n)=>row(4*i+beat+late[i][n],pitches[i][n],
  [.71,.34,.48,.27][n],.5+.33*vel,n===1 ? {curves:{amplitude:[[0,.9],[.3,1],[1,.76]]}} : undefined)));
const snare=rhythms.flatMap((_,i)=>[row(4*i+1.045,38,.14,.68),row(4*i+3.048,38,.14,.76),
  ...(i%2 ? [row(4*i+2.385,38,.085,.27)] : [])]);
const hat=rhythms.flatMap((_,i)=>[.48,1.03,1.49,2.50,3.04,3.52].map((beat,n)=>
  row(4*i+beat,42,.10,.27+((i+n*3)%7)*.046)));
const keys=[
  row(.77,67,.41,.64),row(2.16,71,.31,.60),row(3.2,64,.35,.55),
  row(5.45,69,.39,.60),row(6.68,62,.32,.53),
  row(8.78,71,.36,.65),row(9.53,67,.29,.51),row(11.26,62,.36,.56),
  row(12.84,64,.43,.60),row(14.16,59,.35,.55),row(15.58,67,.33,.52)
];

function publish(dir) {
  const out=path.resolve(dir), at=name=>path.join(out,name);
  fs.mkdirSync(at('samples'),{recursive:true});
  const {sources,patches,credits}=describe('drums-and-bass');
  patches.keys={type:'keys',tine:.7,bite:.22,wear:.15,dust:.011,drive:1.23,color:.54,
    env:{attack:.01,decay:.6,sustain:.19,release:.27}};
  const score=production(patches,{
    kick:{notes:kick,gain:-8,highpass:29},
    snare:{notes:snare,gain:-16,pan:.14,send:.34,highpass:135},
    'closed-hat':{notes:hat,gain:-23,pan:-.28,send:.16,highpass:1750},
    bass:{patch:'electric-bass',notes:bass,gain:-6,highpass:34,lowpass:1190},
    keys:{notes:keys,gain:-17,pan:.29,send:.53,highpass:122}
  },4,{gain:2});
  score.arrangement.score.tempoMap={tempo:114,swing:.538};
  score.tracks.bass.clips[0].timing='played';
  const {KIT}=ink.load(), P=KIT.procedural, assets={}, provenance={};
  for (const name of new Set(Object.values(score.patches).flatMap(P.musicInstruments.assetNames))) {
    const {file,credit,original}=sources[name], relative='samples/'+path.basename(file);
    const add=name.startsWith('bass-') ? Math.round(rate*(.043+(name.includes('pick') ? .005 : 0))) : 0;
    if (add) {
      const audio=ink.readWav(file);
      assert.equal(audio.sampleRate,rate);
      const samples=new Float32Array(audio.samples.length+add*audio.channels);
      samples.set(audio.samples,add*audio.channels);
      fs.writeFileSync(at(relative),ink.encodeWav({...audio,samples},{encoding:'pcm24'}));
    } else fs.copyFileSync(file,at(relative));
    assets[name]=relative;
    provenance[name]={credit,original,prependedSamples:add};
  }
  const session={format:'ink-studio/music-edit-session',version:1,id:'Pocket-Clock',sampleRate:rate,production:score,
    mixer:{output:'master',strips:{master:{},kick:{output:'drums'},snare:{output:'drums'},'closed-hat':{output:'drums'},
      drums:{},bass:{inserts:[{processor:'duck',sidechain:{strip:'kick',tap:'pre'}}]}},
      processors:{duck:{type:'compressor',thresholdDb:-27,ratio:3.7,attack:.002,release:.12}}}};
  const json=(file,object)=>fs.writeFileSync(at(file),JSON.stringify(object,null,2)+'\n');
  const focus={range:{from:{beat:0},to:{beat:16}},pair:{anchor:'kick',track:'bass',within:.07},searchMs:160};
  const trim={op:'trim',track:'bass',keepMs:4};
  const gap={op:'gap',metric:'audible',targetMs:[[0,38],[4,28],[8,10],[12,17],[16,13]]};
  json('source.json',{session,assets});
  json('focus.json',focus);
  json('trim.json',{...focus,edits:[trim]});
  json('edits.json',{...focus,edits:[trim,gap]});
  json('sample-credits.json',{credits:Object.fromEntries(Object.entries(credits)
    .filter(([name])=>Object.values(provenance).some(row=>row.credit===name))),sources:provenance});
  const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
  const run=(...args)=>execFileSync(process.execPath,[cli,'music','groove',...args],{encoding:'utf8'});
  run('inspect',at('source.json'),at('focus.json'),'--out',at('inspection.json'));
  run('edit',at('source.json'),at('trim.json'),'--out',at('trimmed.json'),'--report',at('trim-report.json'));
  run('audition',at('source.json'),at('edits.json'),'--out',at('audition'),'--json');
  const before=ink.readWav(at('audition/before.wav')), after=ink.readWav(at('audition/after.wav'));
  const middle=path.join(out,'trim-only.wav');
  const trimRecipe=JSON.parse(fs.readFileSync(at('trimmed.json'))), trimAssets=Object.fromEntries(
    Object.entries(trimRecipe.assets).map(([name,file])=>[name,ink.readWav(at(file))]));
  const trimAudio=P.mediaGraph.musicSession.create(trimAssets).render(trimRecipe.session,
    {from:{beat:0},to:{beat:16}}).value;
  fs.writeFileSync(middle,ink.encodeWav(trimAudio,{encoding:'pcm24'}));
  const report=JSON.parse(fs.readFileSync(at('audition/report.json')));
  assert.equal(report.before.pairs.length,kick.length);
  assert.ok(report.operations[0].entries.every(row=>row.after.triggerSample===row.before.triggerSample &&
    row.before.audibleSample-row.after.audibleSample>=.025*rate));
  assert.ok(report.operations[1].entries.every(row=>Math.abs(row.errorMs)<2.5));
  const peak=P.mediaGraph.mixerMonitor.meter(after);
  assert.ok(peak.truePeakDbTP<-1 && peak.integratedLufs>-27,'Listen at a useful unclipped level');
  const pause=Math.round(.40*rate)*2, samples=new Float32Array(before.samples.length+after.samples.length+pause);
  samples.set(before.samples);
  samples.set(after.samples,before.samples.length+pause);
  fs.writeFileSync(at('pocket-clock.wav'),ink.encodeWav({...before,samples},{encoding:'pcm24'}));
  fs.writeFileSync(at('README.txt'),[
    'Pocket Clock',
    '',
    'pocket-clock.wav plays the original four bars, a short pause, then the edited four bars.',
    'trim-only.wav keeps the recorded triggers. audition/after.wav also reshapes the kick–bass gap.',
    'audition/timing.txt shows the written note, played time, trigger, and estimated audible attack.',
    'The demo adds 43 ms of head before each fingered bass sample to expose the edit.',
    '',
    'Reproduce from this folder with the Ink Studio CLI',
    '  ink-studio music groove inspect source.json focus.json',
    '  ink-studio music groove edit source.json trim.json --out new-trim.json',
    '  ink-studio music groove audition source.json edits.json --out new-audition',
    ''
  ].join('\n'));
  const summary=report.operations[0].entries.map(row=>(row.before.audibleSample-row.after.audibleSample)*1000/rate);
  process.stdout.write(JSON.stringify({folder:out,pairs:report.before.pairs.length,
    trimMs:[Math.min(...summary),Math.max(...summary)],truePeakDbTP:peak.truePeakDbTP})+'\n');
}
if (require.main===module) publish(process.argv[2] ?? 'pocket-clock');
