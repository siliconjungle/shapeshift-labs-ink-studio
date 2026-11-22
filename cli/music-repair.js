const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js');
const {readAudioSource}=require('./sound-source.js');

module.exports=function repairCommand([file,settings],opt,kit) {
  if (!file || !settings || typeof opt.out!=='string')
    throw new TypeError('Use music repair <audio-source> settings.json --out directory');
  const P=kit.KIT.procedural;
  const result=P.mediaGraph.repairDialogue(readAudioSource(file,P),JSON.parse(fs.readFileSync(settings,'utf8')));
  const directory=path.resolve(opt.out), report=path.join(directory,'report.json');
  const emit=(name,audio)=>{
    const file=path.join(directory,name+'.wav');
    write(file,WAV.encode(audio,{encoding:'pcm24'}));
    return file;
  };
  const files={before:emit('before',result.before),repaired:emit('repaired',result.value),
    removed:emit('removed',result.removed),report};
  json(report,result.report);
  process.stdout.write(JSON.stringify(files)+'\n');
  return files;
};
