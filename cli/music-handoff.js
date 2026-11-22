const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js');
const { isSoundRecipe } = require('./sound-source.js');
const Midi=require('./handoff-midi.js'), Reaper=require('./handoff-reaper.js');

function publish(result,file,recipe,out,host) {
  const target=path.resolve(out), parent=path.dirname(target);
  fs.mkdirSync(parent,{recursive:true});
  const stage=fs.mkdtempSync(path.join(parent,'.ink-handoff-')), names=[];
  const save=(relative,content,asJson=false)=>{
    const at=path.join(stage,relative);
    names.push(relative);
    (asJson ? json : write)(at,content);
    return relative;
  };
  const pcm=(folder,bank)=>Object.fromEntries(Object.entries(bank).map(([name,source])=>
    [name,save(folder+'/'+name+'.wav',WAV.encode(source,{encoding:'float32'}))]));
  try {
    const sourceFolder=path.dirname(path.resolve(file));
    const assets=Object.fromEntries(Object.entries(recipe.assets ?? {}).map(([name,value])=>{
      const local='assets/'+name+(isSoundRecipe(value) ? '.sound.json' : '.wav');
      save('ink/'+local,fs.readFileSync(path.resolve(sourceFolder,value)));
      return [name,local];
    }));
    const score=save('ink/session.json',{session:recipe.session,assets},true);
    const {plan}=result, midi=Midi.compile(plan);
    const files={ink:score,midi:save('notes.mid',Midi.encode(plan,midi)),
      master:save('audio/master.wav',WAV.encode(result.value,{encoding:'float32'})),
      stems:pcm('audio/stems',result.stems),taps:pcm('audio/taps',result.taps)};
    const aliases=new Set();
    for (const track of Object.values(plan.tracks)) for (const take of Object.values(track.takes)) {
      if (take.clap) aliases.add(take.clap.plugin);
    }
    for (const node of Object.values(plan.desk.processors)) if (node.type==='external' && node.adapter==='clap') aliases.add(node.plugin);
    const plugins=host ? Object.fromEntries([...aliases].map(alias=>[alias,host.pluginId(alias)])) : {};
    files.reaper=save('project.rpp',Reaper.project(plan,midi,files));
    files.readme=save('README.md',`# ${plan.id}

Open project.rpp in REAPER. The Ink master print is soloed for the original playback.
Unsolo and mute that print to work with the routed audio stems and desk envelopes.
Stem gains are already restored on the audio items. In another host, apply
stemGains from handoff.json when a stem needed additional headroom.
The muted MIDI tracks feed their matching audio strips. Put an instrument on a
MIDI track, unmute it, and mute the audio item it replaces.

notes.mid carries performed note timing, tempo, and compatible MPE controls.
The desk's inserts, exact per-note curves, CLAP state, and source edit addresses
are in handoff.json and ink/session.json. Assign equivalent DAW inserts and
check the result against the original master print.

Open ink/session.json in Ink Studio to recover the original comp, takes and
automation. To rerender CLAP devices, supply a local manifest for the aliases.
`);
    const manifest=save('handoff.json',{...plan,files,plugins,midi:{ppq:midi.ppq,notices:midi.notices,
      mpeTracks:Object.entries(midi.tracks).filter(([,row])=>row.mpe).map(([name])=>name)}},true);
    if (fs.existsSync(target)) {
      for (const name of names) {
        const to=path.join(target,name);
        fs.mkdirSync(path.dirname(to),{recursive:true});
        fs.renameSync(path.join(stage,name),to);
      }
    } else fs.renameSync(stage,target);
    return {manifest:path.join(target,manifest),project:path.join(target,files.reaper),session:path.join(target,score),
      midi:path.join(target,files.midi),master:path.join(target,files.master)};
  } finally {fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={publish};
