/* Exercise the live sound browser and play its kept cue, pad, and pinned family. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'), {once}=require('node:events');
const {createInterface}=require('node:readline');
const repo=path.resolve(process.argv[3] ?? path.join(__dirname,'../..')), cli=path.join(repo,'cli/ink-studio.js');
const {fixture,loop}=require(path.join(repo,'examples/music-production/sound-browser.cjs'));
const rate=32000;

async function publish(directory) {
  const out=path.resolve(directory), at=name=>path.join(out,name), relative=file=>path.relative(out,file).split(path.sep).join('/');
  fs.mkdirSync(out,{recursive:true});
  const save=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value,null,2)+'\n');
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const run=(...args)=>{
    const output=execFileSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'}).trim();
    return output && JSON.parse(output);
  };
  save('relay-latch.sound.json',{format:'ink-studio/sound-recipe',version:1,family:'jump',seed:7804,
    render:{sampleRate:rate,peak:.7},synth:{pulseWidth:.23,pitchSteps:[{at:0,semitones:0},{at:.56,semitones:5}],
      noise:{color:'pink',level:.18}},retro:{bits:7,rateHz:9800,wet:.55}});
  save('session.json',{session:fixture(rate),assets:{'relay-latch':'relay-latch.sound.json'}});
  save('loop.json',loop);
  const server=spawn(process.execPath,[cli,'music','session','play',at('session.json'),at('loop.json'),'--out',at('kept.json')],
    {stdio:['ignore','pipe','inherit']});
  const lines=createInterface({input:server.stdout});
  const done=once(server,'exit');
  let cue,sample,family;
  try {
    const first=await lines[Symbol.asyncIterator]().next();
    assert(!first.done,'The browser server ended before publishing its URL');
    const {url}=JSON.parse(first.value), {key}=await (await fetch(url+'/session')).json();
    async function post(route,value) {
      const response=await fetch(url+route,{method:'POST',headers:{'content-type':'application/json','x-ink-session':key},
        body:JSON.stringify(value)});
      if (!response.ok) throw new Error((await response.json()).error);
      return response;
    }
    const command=async(op,args)=> (await post('/command',{op,...args})).json();
    const results=await command('sounds',{lane:'kick',role:'effect',query:'relay latch'});
    assert.equal(results.results.length,1);
    const match={lane:'kick',source:'reference',id:results.results[0].id};
    await command('audition-sound',match);
    const preview=Buffer.from(await (await post('/sound-preview',match)).arrayBuffer());
    fs.writeFileSync(at('browser-preview.wav'),preview);
    cue=await command('export-sound',{...match,kind:'cue',name:'relay-latch'});
    sample=await command('export-sound',{...match,kind:'sample',name:'relay-latch'});
    family=await command('export-sound',{...match,kind:'family',name:'relay-latch',revision:2});
    for (const kept of [cue,sample,family]) assert(fs.readFileSync(kept.audio).equals(preview));
  } finally {
    lines.close();
    if (server.exitCode===null && server.signalCode===null) server.kill();
    await done;
  }
  const audition=relative(path.join(cue.directory,'audition.json'));
  const rebuilt=run('music','sound','replay',audition,'--out','replayed');
  assert(fs.readFileSync(rebuilt.audio).equals(fs.readFileSync(cue.audio)));
  const inSample=name=>relative(path.join(sample.directory,name));
  run('music','samples','kit',inSample('samples'),inSample('kit.json'),inSample('performance.json'),'--out','pad');
  const manifest=read(family.manifest);
  const registry=relative(path.join(family.directory,manifest.registry));
  run('assets','validate',registry);
  const ids=manifest.members.map((_,i)=>'latch-'+i);
  save('world.json',{format:'ink-studio/world',version:1,id:'relay-latch-test',dt:.05,history:{enabled:true},
    commands:ids.map((id,i)=>({tick:3+i*15,action:'world/event',args:{kind:id,point:[i%2 ? 1.3 : -1.1,0,-1.9]}}))});
  execFileSync(process.execPath,[cli,'sim','run','world.json','--ticks','75','--record','world.run.json'],{cwd:out,stdio:'pipe'});
  save('soundtrack.json',{format:'ink-studio/scene-audio',version:1,assetRegistry:registry,sampleRate:rate,
    assets:Object.fromEntries(ids.map((id,i)=>[id,manifest.members[i].ref])),
    spatial:{cues:Object.fromEntries(ids.map(id=>[id,{asset:id,bus:'effects',gain:.9}])),
      bindings:Object.fromEntries(ids.map(id=>[id,{on:{kind:id},cue:id}]))},
    listener:{at:[0,0,0],forward:[0,0,-1],up:[0,1,0]},post:{}});
  run('story','audio','world.run.json','soundtrack.json','--out','story');
  assert.deepEqual(read(at('story/report.json')).cues.map(row=>row.cue),ids);
  save('compare.mix.json',{assets:{cue:relative(cue.audio),pad:'pad/kit.wav',story:'story/mix.wav'},
    mixer:{id:'kept-latch',sampleRate:rate,end:{seconds:5.75},tail:'cut',output:'master',peakPolicy:'error',
      strips:{master:{clips:[{id:'cue',source:'cue',at:{seconds:.12}},{id:'pad',source:'pad',at:{seconds:.87}},
        {id:'story',source:'story',at:{seconds:1.52}}]}}}});
  run('music','mix','render','compare.mix.json','--out','comparison');
  fs.copyFileSync(at('comparison/mix.wav'),at('kept-sounds.wav'));
  save('demo-summary.json',{audio:'kept-sounds.wav',cue:relative(cue.manifest),sample:relative(sample.manifest),
    family:relative(family.manifest),registry,world:'world.run.json',soundtrack:'soundtrack.json'});
  return out;
}

if (require.main===module) {
  if (!process.argv[2]) throw new Error('Use node examples/music-production/keep-browser-sound.cjs output');
  publish(process.argv[2]).then(out=>console.log('Kept one audition as a cue, pad, and pinned event family in '+out),
    error=>{console.error(error);process.exitCode=1;});
}

module.exports={publish};
