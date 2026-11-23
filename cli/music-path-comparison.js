const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {graphOutputs}=require('./graph-outputs.js');
const {timelineBank,readProductionAssets}=require('./music-production.js');
const {withLiveOptions}=require('./music-live.js');
const {resolveCheckpoint}=require('./checkpoint-file.js');

function read(file) {
  if (fs.statSync(file).size>128*1024*1024) throw new RangeError('Audio comparison input exceeds its byte budget');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

module.exports=async function command([file,inputFile,extra],opt,kit) {
  const K=kit.KIT, R=K.music.production.rehearsal, {check}=K.procedural.musicInstruments;
  check(file && inputFile && !extra && typeof opt.out==='string' && opt.out.trim() &&
    Object.keys(opt).every(key=>['out','capture'].includes(key)) &&
    (opt.capture===undefined || typeof opt.capture==='string' && opt.capture.trim()),
  'Use music rehearsal compare <timeline.json> <trace|route|world-run.json> --out directory [--capture settings.json]');
  const inputs=new Set();
  const onFile=entry=>{
    const absolute=path.resolve(entry);
    inputs.add(absolute);
    return absolute;
  };
  const recipe=read(onFile(file)), input=read(onFile(inputFile));
  const isRecording=input?.format===K.world.runtime.runFormat;
  check(opt.capture===undefined || isRecording,'Capture settings require a native world recording');
  const trace=isRecording ? R.capture(resolveCheckpoint(path.resolve(inputFile),input,{onBlock:onFile}),
    opt.capture ? read(onFile(opt.capture)) : {id:'recorded-world'}) : input;
  const {sources,timeline,paths}=timelineBank(recipe,file,onFile);
  Object.values(paths).forEach(onFile);
  return await withLiveOptions(recipe,file,kit,async (settings,traceOptions)=>{
    const output=graphOutputs([...inputs]), assets=readProductionAssets(paths,K.procedural);
    const {value,report,liveReport,offlineReport}=await R.compare(sources,timeline,trace,{
      live:{sampleRate:recipe.options?.sampleRate,...settings,assets},traceOptions,world:recipe.options?.world
    });
    const files={live:{audio:'live.wav',report:'live.json'},offline:{audio:'offline.wav',report:'offline.json'}};
    const folder=path.resolve(opt.out);
    const audio=['live','offline'].map(key=>{
      const wave=value[key], samples=report.audio[key].clippedChannelSamples ?
        wave.samples.map(sample=>Math.max(-1,Math.min(1,sample))) : wave.samples;
      return {file:files[key].audio,bytes:WAV.encode({...wave,samples},{encoding:'pcm24'})};
    });
    output.write(folder,[...audio,{file:files.live.report,document:liveReport},{file:files.offline.report,document:offlineReport},
      {file:'comparison.json',document:{...report,files}}]);
    const result={comparison:path.join(folder,'comparison.json'),live:path.join(folder,files.live.audio),
      offline:path.join(folder,files.offline.audio),differences:report.summary};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return result;
  },onFile);
};
