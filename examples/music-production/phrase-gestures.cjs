/* Run: node examples/music-production/phrase-gestures.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const WAV=require('../../cli/wav.js');
const {KIT:K}=require('../..').load();
const original=require('./relay-glass.json');
const palettes=require('./gesture-palettes.json');
const A=K.music.production;
const folder=path.resolve(process.argv[2] ?? 'phrase-gestures');
const source=structuredClone(original.production), {arrangement}=source;
arrangement.score.tempoMap={tempo:108,beatsPerBar:4,swing:.548};
arrangement.score.endFade=.27;
arrangement.score.changes=[{id:'answer-turn',time:{bar:3},harmony:'turn'}];
arrangement.sections=[
  {id:'call',bars:2,harmony:'home',parts:{lead:'call',bass:'drive'}},
  {id:'answer',bars:2,harmony:'lift',parts:{lead:'answer',bass:'drive',snare:'backbeat'}},
  {id:'fade',bars:2,harmony:'clear',parts:{lead:null,bass:'landing',metal:null,snare:null,hat:null,kick:null}}
];
source.tracks.pad.pad.sections={fade:source.tracks.pad.pad.sections.clear};

const melody=entries=>({length:8,events:entries.map(([beat,duration,midi,velocity])=>({beat,duration,midi,velocity}))});
arrangement.motifs.call=melody([
  [.5,.22,73,.8],[1.25,.35,76,.72],[2.25,.53,78,.9],[4.5,.24,73,.74],
  [5.25,.4,76,.71],[6.25,.55,81,.9],[7.25,.31,80,.72]
]);
arrangement.motifs.answer=melody([
  [.5,.31,73,.79],[1.25,.46,76,.77],[2.25,.93,81,.94],[4.25,.32,80,.83],
  [4.75,.46,77,.78],[5.75,.34,71,.72],[6.25,1.46,73,.96]
]);
arrangement.motifs.drive={length:8,events:[[0,.56,1,.9],[1,.65,1,.74],[1.75,.49,3,.75],
  [2.25,.69,5,.84],[3,.68,1,.73],[4,.68,1,.88],[4.75,.61,5,.76],[5.5,.63,3,.75],
  [6.25,.64,2,.75],[7,.58,1,.84]].map(([beat,duration,degree,velocity])=>({beat,duration,degree,velocity}))};
arrangement.motifs.landing={length:8,events:[{beat:0,duration:1.6,degree:1,velocity:.77}]};

const assets=Object.fromEntries(Object.entries(original.assets).map(([name,file])=>[name,WAV.read(path.join(__dirname,file))]));
const brittle=A.revise(source,palettes.brittle,assets);
const plans=A.planPerformances(brittle,[{id:'flat-fm'},{id:'brittle-fm',tracks:{
  lead:[{gesture:'strike-and-dissolve',from:0,to:16}],bass:[{gesture:'clip-and-slide',from:0,to:16}]
}}],assets);
const {takes,report}=A.audition(brittle,[...plans.variants,palettes.dust],assets,{sampleRate:32000});
const notation=take=>JSON.stringify(A.inspect(take.production,assets).arrangement.score.voices.map(voice=>voice.sequence));
assert(takes.every(take=>notation(take)===notation(takes[0])));
fs.mkdirSync(folder,{recursive:true});
const files=Object.fromEntries(Object.entries(original.assets).map(([name,file])=>[name,path.resolve(__dirname,file)]));
const write=(name,value)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(value,null,2)+'\n');
for (const take of takes) {
  fs.writeFileSync(path.join(folder,take.id+'.wav'),WAV.encode(take.value,{encoding:'pcm24'}));
  write(take.id+'.json',{production:take.production,assets:files});
}
write('manifest.json',{...report,scoreIdentical:true,performances:plans.report});
console.log(report.takes.map(take=>({id:take.id,lufs:take.lufs,peak:take.peak})));
