const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {spawn}=require('node:child_process');
const {once}=require('node:events'), {load}=require('..');
const M=load().KIT.procedural.mediaGraph, rate=8000;

function fixture() {
  const part={role:'bass'}, voice=(notes)=>[{id:'one',notes:notes.map(([beat,midi,duration,play],i)=>
    ({id:'note-'+i,beat,midi,duration,velocity:.8,...(play && {play})}))}];
  const bank={bars:5,initial:{bass:'long',kick:'hits'},clips:{
    bass:[{id:'long',length:2,voices:voice([[0,40,1.75,{curves:{amplitude:[[0,.35],[.7,1],[1,.54]]}}]])},{id:'short',length:1,voices:voice([[0,43,.71]])}],
    kick:[{id:'hits',length:1,voices:voice([[0,36,.13]])}]
  }};
  const source={format:'ink-studio/music-edit-session',version:1,id:'capture',sampleRate:rate,production:{
    arrangement:{score:{key:{root:'E3'},tempoMap:{tempo:123,beatsPerBar:4,swing:.56,changes:[{beat:6,tempo:112}]},
      harmonies:{home:{root:'E3',quality:'unison'}}},motifs:{},parts:{bass:part,kick:{role:'percussion'}},
      sections:[{id:'base',bars:2,harmony:'home'}]},
    patches:{bass:{type:'analog'},drum:{type:'drum',kind:'kick'}},
    tracks:{bass:{patch:'bass',gain:-15},kick:{patch:'drum',gain:-16}}
  },mixer:{output:'master',strips:{master:{},bass:{sends:{echo:{tap:'pre',level:.2}}},
    kick:{},echo:{inserts:['delay']}},
    processors:{delay:{type:'tempo-delay',beats:.375,feedback:.38,wet:1}},
    taps:{bass:{strip:'bass',tap:'input'},echo:{strip:'echo'}}}};
  return {source,bank};
}

test('a jam quantizes independent launches and saves the played note cycles, gaps and sample-clock moves',()=>{
  const {source,bank}=fixture(), Editor=M.musicSession.create();
  const jam=M.musicSessionJam.open(Editor,source,bank), {beatSamples}=jam.state();
  const chunks=[], taps=[];
  const pullTo=frame=>{
    while (jam.state().frame<frame) {
      const next=jam.pull(Math.min(1603,frame-jam.state().frame),{taps:true});
      chunks.push(...next.value.samples);
      taps.push(...next.taps.bass.samples);
    }
  };
  pullTo(650);
  assert.throws(()=>jam.launch({launches:[{lane:'bass',clip:'missing'}]}),/clip slot/);
  const pending=jam.launch({launches:[{lane:'bass',clip:'short'}],quantize:'bar'});
  assert.equal(pending.beat,4);
  const launch=jam.launch({launches:[{lane:'bass',clip:'short'}]});
  assert.deepEqual(launch,{beat:1,frame:beatSamples[1]});
  assert.equal(jam.state().lanes.bass.pending.clip,'short');
  pullTo(beatSamples[1]+101);
  assert.equal(jam.state().lanes.bass.active,'short');
  const when=jam.state().frame;
  jam.move({lane:'bass',send:'echo',value:.8});
  pullTo(when+120);
  jam.move({lane:'bass',send:'echo',value:.44});
  const mute=jam.move({lane:'bass',muted:true});
  pullTo(beatSamples[2]+180);
  const stop=jam.launch({launches:[{lane:'bass',clip:null},{lane:'kick',clip:null}],quantize:'bar'});
  assert.equal(stop.beat,4);
  const open=jam.move({lane:'bass',muted:false});
  pullTo(beatSamples[7]+200);
  const back=jam.launch({launches:[{lane:'bass',clip:'long'},{lane:'kick',clip:'hits'}],quantize:'bar'});
  assert.deepEqual(back,{beat:8,frame:beatSamples[8]});
  pullTo(beatSamples[10]+111);
  assert.deepEqual(jam.finish(),{beat:12,frame:beatSamples[12]});
  assert.throws(()=>jam.arrangement(),/Finish the pass/);
  pullTo(beatSamples[12]);
  assert.equal(jam.state().done,true);
  assert.equal(jam.pull(500).value.samples.length,0);
  const doc=jam.arrangement(), {production,automation}=doc;
  assert.equal(production.arrangement.sections[0].bars,3);
  assert.deepEqual(production.tracks.bass.clips.map(({beat,length,loopBeats})=>[beat,length,loopBeats]),
    [[0,1,2],[1,3,1],[8,4,2]]);
  const input=Object.values(automation).find(row=>row.target.parameter==='inputGain');
  assert.deepEqual(input.points.slice(1,5).map(({at,value})=>[at,value]),
    [[mute.frame,1],[mute.frame+64,0],[open.frame,0],[open.frame+64,1]]);
  const send=Object.values(automation).find(row=>row.target.send==='echo');
  const split=send.points.find(row=>row.at===when+120);
  assert.ok(Math.abs(split.value-.4)<1e-9);
  assert.ok(taps.slice((mute.frame+64)*2,open.frame*2).every(value=>value===0));
  const rendered=Editor.render(doc);
  assert.ok(chunks.some(value=>Math.abs(value)>.05));
  assert.ok(chunks.every((value,index)=>Math.abs(value-rendered.value.samples[index])<3e-8));
  const {id,voices}=production.tracks.bass.clips[1];
  const note={op:'note',take:'reference',lane:'bass',clip:id,voice:voices[0].id,note:'note-0',set:{midi:45}};
  const updated=Editor.edit(doc,[note]);
  const repeated=Editor.inspect(updated).lanes.bass.takes.reference.filter(row=>row.address[1]===id);
  assert.deepEqual(repeated.map(row=>[row.beat,row.midi]),[[1,45],[2,45],[3,45]]);
  assert.equal(source.production.arrangement.sections[0].bars,2);
});

test('the loopback jam saves an ordinary session that the regular desk can reopen',async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-clip-jam-')), {source,bank}=fixture();
  const input=path.join(dir,'source.json'), slots=path.join(dir,'bank.json'), target=path.join(dir,'take.json');
  fs.writeFileSync(input,JSON.stringify({session:source}));
  fs.writeFileSync(slots,JSON.stringify(bank));
  const server=spawn(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'music','session','jam',input,slots,'--out',target],
    {stdio:['ignore','pipe','inherit']});
  t.after(async()=>{
    if (server.exitCode===null && server.signalCode===null) {
      const close=once(server,'exit');
      server.kill();await close;
    }
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const [line]=await Promise.race([once(server.stdout,'data'),
    once(server,'exit').then(([code])=>{throw new Error('Jam server exited '+code);})]);
  const {url}=JSON.parse(line);
  assert.match(await (await fetch(url)).text(),/Finish at bar/);
  const {key,state}=await (await fetch(url+'/session')).json();
  const post=(route,body)=>fetch(url+route,{method:'POST',headers:{'content-type':'application/json','x-ink-session':key},
    body:JSON.stringify(body)});
  const cmd=async(op,args={})=>{
    const response=await post('/command',{op,...args});
    const data=await response.json();
    assert.ok(response.ok,JSON.stringify(data));
    return data;
  };
  const finish=await cmd('finish');
  assert.equal(finish.at.beat,4);
  const response=await post('/audio',{frames:16384,client:'jam-test'});
  assert.ok(response.ok);
  assert.equal((await response.arrayBuffer()).byteLength,finish.at.frame*8);
  assert.equal(JSON.parse(response.headers.get('x-ink-transport')).done,true);
  assert.equal((await cmd('save')).session,target);
  const saved=JSON.parse(fs.readFileSync(target));
  assert.equal(saved.session.production.tracks.bass.clips[0].loopBeats,2);
  assert.deepEqual(M.musicSession.create().inspect(saved.session).lanes.bass.takes.reference.map(note=>note.beat),[0,2]);
  assert.equal(state.frame,0);
});
