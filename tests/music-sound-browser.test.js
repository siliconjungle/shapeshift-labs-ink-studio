const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {spawn}=require('node:child_process');
const {once}=require('node:events'), ink=require('..');
const {createSoundBrowser}=require('../cli/music-sound-browser.js');
const {fixture,loop}=require('../examples/music-production/sound-browser.cjs');
const P=ink.load().KIT.procedural, rate=8000;
const address=samples=>({samples});
const difference=(a,b)=>a.reduce((peak,x,i)=>Math.max(peak,Math.abs(x-b[i])),0);
const phrase=({from,to})=>({from:address(from),to:address(to)});

test('a kick preview preserves the transport, pattern and bass input while the compressor hears the new kick',()=>{
  const source=fixture(rate), E=P.mediaGraph.musicSession.create(), browser=createSoundBrowser(P,{},{});
  const settings={...loop,fadeSamples:96};
  const actual=E.open(source,settings), original=E.open(source,settings);
  assert.deepEqual(actual.pull(111).value,original.pull(111).value);
  const before=actual.state(), match={lane:'kick',source:'reference',id:'low-kick'};
  const {revision}=browser.candidate(source,match);
  const {range,material}=E.prepareSound(source,{lane:'kick',revision,...phrase(before.loop)});
  const ack=actual.setSound({...match,...range,material});
  assert.equal(ack.scoreSample,before.scoreSample);
  assert.equal(ack.frame,before.frame);
  assert.equal(ack.pass,before.pass);
  assert.deepEqual(actual.document(),source);
  const mixed=actual.pull(8200,{taps:true}), baseline=original.pull(8200,{taps:true});
  assert.deepEqual(mixed.end,baseline.end);
  assert.equal(mixed.value.samples[0],baseline.value.samples[0]);
  assert.deepEqual(mixed.taps['bass-before'].samples,baseline.taps['bass-before'].samples);
  assert.ok(difference(mixed.taps['kick-key'].samples,baseline.taps['kick-key'].samples)>.04);
  assert.ok(difference(mixed.taps.bass.samples,baseline.taps.bass.samples)>.015);
  const edited=E.edit(source,[
    {op:'score-take',take:'long',revision},
    {op:'comp',lane:'kick',take:'long',...phrase(before.loop)}
  ]);
  const takes=E.inspect(edited).lanes.kick.takes;
  assert.deepEqual(takes.long,takes.reference);
  assert.deepEqual(edited.mixer,source.mixer);
  const clear=actual.setSound(null);
  assert.equal(clear.scoreSample,mixed.end.scoreSample);
  const tail=actual.pull(2500,{taps:true}), compare=original.pull(2500,{taps:true});
  assert.deepEqual(tail.taps['kick-key'].samples.slice(200),compare.taps['kick-key'].samples.slice(200));
});

test('the live browser searches by role and example and saves a sampled winner as an editable take',async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sound-browser-'));
  const start=path.join(dir,'session.json'), settings=path.join(dir,'loop.json'), out=path.join(dir,'kept.json');
  const source=fixture(rate), basisTake='pocket';
  const clips=structuredClone(source.production.tracks.kick.clips);
  clips[0].voices[0].notes[0].velocity=.57;
  source.takes={[basisTake]:{tracks:{kick:{clips}}}};
  fs.writeFileSync(start,JSON.stringify({session:source}));
  fs.writeFileSync(settings,JSON.stringify(loop));
  const cli=spawn(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'music','session','play',start,settings,'--out',out],
    {stdio:['ignore','pipe','pipe']});
  t.after(async()=>{
    if (cli.exitCode===null && cli.signalCode===null) {
      const closed=once(cli,'exit');
      cli.kill();
      await closed;
    }
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const [banner]=await once(cli.stdout,'data'), {url}=JSON.parse(banner.toString().trim());
  const {key}=await (await fetch(url+'/session')).json();
  const post=(endpoint,body)=>fetch(url+endpoint,{method:'POST',headers:{'content-type':'application/json','x-ink-session':key},
    body:JSON.stringify(body)});
  const cmd=async(op,args={})=>{
    const res=await post('/command',{op,...args}), data=await res.json();
    assert.ok(res.ok,JSON.stringify(data));
    return data;
  };
  const cursor=async(frames)=>{
    const response=await post('/audio',{frames,client:'qa'});
    assert.ok(response.ok);
    await response.arrayBuffer();
    return JSON.parse(response.headers.get('x-ink-transport'));
  };
  const list=await cmd('sounds',{lane:'kick',role:'kick',query:'acoustic'});
  assert.deepEqual(list.results.map(row=>row.id),['stock-kick']);
  const current=await cmd('sounds',{lane:'kick',role:'kick',sample:'current'});
  assert.equal(current.results[0].id,'session-rubber');
  const stock=ink.loadSoundPack('drums-and-bass').assets['rhythm-kick-hard-a'];
  const bytes=Buffer.alloc(2*Math.min(4096,Math.floor(stock.samples.length/4)));
  for (let i=0;i<bytes.length/2;i++) bytes.writeInt16LE(Math.round(stock.samples[4*i]*32767),i*2);
  const matches=await cmd('sounds',{lane:'kick',role:'kick',sample:bytes.toString('base64')});
  assert.equal(matches.results[0].id,'stock-kick');

  await cmd('switch',{lane:'kick',take:basisTake,fadeSamples:0});
  assert.equal((await cmd('sounds',{lane:'kick'})).source,basisTake);
  await cursor(913);
  const match={lane:'kick',source:basisTake,id:'stock-kick'};
  const before=await cmd('state'), sound=await cmd('audition-sound',match);
  assert.equal(sound.scoreSample,before.scoreSample);
  assert.deepEqual((await cmd('state')).lanes.kick.takes,['reference',basisTake]);
  await cmd('save');
  assert.deepEqual(JSON.parse(fs.readFileSync(out)).session,source);
  assert.equal((await cursor(400)).scoreSample,before.scoreSample);
  const keep=await cmd('keep-sound',{...match,take:'closer'});
  assert.deepEqual(keep,{lane:'kick',take:'closer',from:before.loop.from,to:before.loop.to});
  const after=await cmd('state');
  assert.equal(after.scoreSample,before.scoreSample+400);
  assert.equal(after.sound,undefined);
  assert.equal(after.lanes.kick.take,null);
  await cmd('save');
  const kept=JSON.parse(fs.readFileSync(out));
  assert.deepEqual(kept.session.takes.closer.tracks.kick.clips,clips);
  assert.deepEqual(kept.session.mixer,source.mixer);
  assert.equal(Object.keys(kept.assets).length,4);
  const bank=Object.fromEntries(Object.entries(kept.assets).map(([id,ref])=>[id,ink.readWav(path.resolve(dir,ref))]));
  const reopened=P.mediaGraph.musicSession.create(bank);
  assert.equal(reopened.inspect(kept.session).lanes.kick.takes.closer[0].velocity,.57);
  const tweaked=reopened.edit(kept.session,[{op:'note',lane:'kick',take:'closer',clip:'kick-phrase',
    voice:'phrase',note:'note-0',set:{velocity:.65}}]);
  assert.equal(reopened.inspect(tweaked).lanes.kick.takes.closer[0].velocity,.65);
});
