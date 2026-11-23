const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawn}=require('node:child_process'), {once}=require('node:events'), {setTimeout:delay}=require('node:timers/promises');
const {fixture,open,pcm,beatId,from,to}=require('../examples/world-cue-audition/demo.cjs');

async function setup(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-world-cue-audition-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const scene=fixture(folder,undefined,8000), live=await open(scene);
  t.after(()=>live.close());
  return {folder,scene,live};
}
test('live world cue renders the whole post mix and isolates the selected beat', {timeout:20000},async t=>{
  const {scene,live}=await setup(t), {ink,file,run}=scene, {session}=live;
  assert.equal(session.beatId,beatId);
  assert.deepEqual(session.bindings,['drop']);
  assert.deepEqual(session.families,['boards','ineligible','metal']);
  const paths=['workshop.run.json','workshop.audio.json'], inputs=paths.map(name=>fs.readFileSync(file(name)));
  run('story','audio',...paths,'--from',from,'--to',to,'--out','expected');
  const original=session.original, baseline=ink.decodeWav(pcm(original)).samples;
  assert.deepEqual(pcm(original),fs.readFileSync(file('expected/mix.wav')));
  const metal=await live.render({binding:'drop',family:'metal'});
  const quieter=await live.render({binding:'drop',family:'metal',gainDb:-7});
  const filtered=await live.render({binding:'drop',family:'metal',gainDb:-7,highpass:80,lowpass:720});
  const [choice]=metal.voices;
  assert.deepEqual([choice.cue,choice.bus,choice.binding,choice.selection.take],['metal','foley','drop','clang']);
  assert.equal(choice.onsetSample,6200);
  assert.ok(Math.abs(quieter.voices[0].gain/choice.gain-10**(-7/20))<1e-8);
  assert.equal(filtered.voices[0].processing.highpass,80);
  assert.equal(filtered.voices[0].processing.lowpass,720);
  assert(!pcm(filtered).equals(pcm(quieter)));
  const before=(.7-Number(from))*session.sampleRate*2, after=(1.5-Number(from))*session.sampleRate*2;
  for(const mix of [metal,quieter,filtered]){
    assert.deepEqual([mix.firstSample,mix.endSample],[original.firstSample,original.endSample]);
    const samples=ink.decodeWav(pcm(mix)).samples;
    assert.deepEqual(samples.slice(0,before),baseline.slice(0,before));
    assert.deepEqual(samples.slice(after),baseline.slice(after));
    assert.notDeepEqual(samples.slice(before,after),baseline.slice(before,after));
  }
  const bed=ink.decodeWav(fs.readFileSync(file('expected/ambience.wav'))).samples;
  assert(bed.slice(0,before).some(sample=>sample!==0));
  const bad=await live.post({family:'ineligible'});
  assert.equal(bad.status,400);
  assert.match((await bad.json()).error,/No eligible take/);
  assert.equal((await live.post({family:'metal'},'invalid')).status,403);
  assert.deepEqual(pcm(await live.render({})),pcm(original));
  assert.deepEqual(paths.map(name=>fs.readFileSync(file(name))),inputs);
});

test('Chrome keeps the scene playing and switches the family on a loop boundary',
  {skip:!process.env.INK_TEST_CHROME||typeof WebSocket!=='function',timeout:30000},async t=>{
  const {live}=await setup(t), profile=fs.mkdtempSync(path.join(os.tmpdir(),'ink-cue-chrome-'));
  let socket;
  function bounded(promise,message){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),12000);});
    return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
  }
  const chrome=spawn(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
    '--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0','--user-data-dir='+profile,live.url],{stdio:'ignore'});
  t.after(async()=>{
    socket?.close();
    if(chrome.exitCode===null&&chrome.signalCode===null){
      const closed=once(chrome,'exit');
      chrome.kill();
      await bounded(closed,'Chrome did not exit');
    }
    fs.rmSync(profile,{recursive:true,force:true});
  });
  const portFile=path.join(profile,'DevToolsActivePort');
  let page;
  for(let i=0;i<120&&!page;i++){
    if(fs.existsSync(portFile)){
      const [port]=fs.readFileSync(portFile,'utf8').split('\n');
      const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2500)})).json();
      page=pages.find(row=>row.type==='page'&&row.url.startsWith(live.url));
    }
    if(!page)await delay(50);
  }
  assert(page,'Chrome did not open the audition');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await bounded(new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  }),'Chrome debugger did not connect');
  let sequence=0;
  function evaluate(expression){
    const id=++sequence;
    return bounded(new Promise(resolve=>{
      function message(event){
        const value=JSON.parse(event.data);
        if(value.id!==id)return;
        socket.removeEventListener('message',message);
        resolve(value);
      }
      socket.addEventListener('message',message);
      socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    }),'Chrome did not finish the loop audition');
  }
  let ready=false;
  for(let i=0;i<140&&!ready;i++){
    const frame=await evaluate("document.readyState==='complete' && document.getElementById('play')?.disabled===false");
    ready=frame.result?.result?.value===true;
    if(!ready)await delay(40);
  }
  assert(ready,'The Chrome audition did not initialize');
  const result=await evaluate(`
    (async()=>{
      const $=id=>document.getElementById(id);
      async function until(test){
        for(let i=0;i<280;i++){
          if(test())return;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        throw Error($('status').textContent);
      }
      await until(()=>$('play')&&!$('play').disabled);
      const starts=[],stops=[], start=AudioBufferSourceNode.prototype.start, stop=AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start=function(when,...rest){
        starts.push({when,duration:this.buffer.duration,loop:this.loop});
        return start.call(this,when,...rest);
      };
      AudioBufferSourceNode.prototype.stop=function(when,...rest){
        stops.push(when);return stop.call(this,when,...rest);
      };
      $('play').click();
      await until(()=>$('clock').textContent.includes('Pass 1'));
      $('family').value='metal';
      $('family').dispatchEvent(new Event('change'));
      const playingDuringEdit=$('play').textContent==='Pause'&&$('voice-list').textContent.includes('boards/knock');
      await until(()=>$('voice-list').textContent.includes('metal/clang'));
      return {starts,stops,playingDuringEdit,clock:$('clock').textContent,button:$('play').textContent};
    })()`);
  assert(!result.error,JSON.stringify(result.error));
  assert(!result.result.exceptionDetails,JSON.stringify(result.result.exceptionDetails));
  const {starts,stops,playingDuringEdit,clock,button}=result.result.result.value;
  assert(playingDuringEdit);
  assert.equal(button,'Pause');
  assert.equal(starts.length,2);
  assert(starts.every(row=>row.loop));
  assert.equal(stops[0],starts[1].when);
  const passes=(starts[1].when-starts[0].when)/starts[0].duration, boundary=Math.round(passes);
  assert(boundary>=1&&Math.abs(passes-boundary)<1e-6);
  assert.match(clock,/Pass [2-9][0-9]*|Pass 1[0-9]+/);
});
