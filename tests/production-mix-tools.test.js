const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'),{mixer,mixerMonitor}=ink.load().KIT.procedural.mediaGraph;
const WAV=require('../cli/wav');
const rate=48000, phase=2*Math.PI/rate;
const tone=(frames,signal)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>signal(i))});
const projection=(audio,hz,start,end)=>{
  let re=0,im=0;
  for (let i=start;i<end;i++) {
    const x=audio.samples[i*audio.channels], theta=phase*hz*i;
    re+=x*Math.cos(theta);im+=x*Math.sin(theta);
  }
  return 2*Math.hypot(re,im)/(end-start);
};
const graph=(processor,sidechain)=>({id:'test-mix',sampleRate:rate,output:'master',tail:'cut',
  strips:{main:{clips:[{id:'phrase',source:'phrase'}],inserts:[sidechain ? {processor:'fx',sidechain:{strip:'key'}} : 'fx']},
    ...(sidechain && {key:{clips:[{id:'trigger',source:'key'}],output:null}}),master:{}},
  processors:{fx:processor}});

test('linked dynamic EQ responds to a separate key and leaves a distant band intact',()=>{
  const phrase=tone(rate,i=>.05*(Math.sin(phase*450*i)+Math.sin(phase*3600*i)));
  const key=tone(rate,i=>i>=12000 && i<30000 ? .65*Math.sin(phase*450*i) : 0);
  const processor={type:'dynamic-eq',bands:[{hz:450,q:2.5,thresholdDb:-35,
    ratio:6,rangeDb:12,attack:.001,release:.048}]};
  const result=mixer.render(graph(processor,true),{phrase,key}).value;
  assert.ok(projection(result,450,0,9600)>.049);
  assert.ok(projection(result,450,18000,27600)<.015);
  assert.ok(projection(result,3600,18000,27600)>.049);
  assert.ok(projection(result,450,38400,48000)>.047);
  processor.bands[0].direction='boost';
  const boosted=mixer.render(graph(processor,true),{phrase,key}).value;
  assert.ok(projection(boosted,450,18000,27600)>.15);
});

test('4× saturation attenuates folded harmonics and the oversampled clipper stays on the edit grid',()=>{
  const phrase=tone(12000,i=>.7*Math.sin(phase*9000*i));
  const config={type:'saturation',driveDb:18,toneHz:20000,bias:0,outputDb:-6};
  const legacy=mixer.render(graph(config),{phrase});
  const clean=mixer.render(graph({...config,oversample:4}),{phrase});
  const alias=print=>projection(print.value,3000,2400,9600);
  const attenuation=20*Math.log10(alias(clean)/alias(legacy));
  assert.ok(attenuation< -25,'Expected at least 25 dB of alias attenuation, got '+attenuation);
  assert.ok(projection(clean.value,9000,2400,9600)>.45);
  const hit=tone(500,i=>i===111 ? .85 : 0);
  const clipper={type:'clipper',oversample:4,ceilingDb:-8};
  const wet=mixer.render(graph(clipper),{phrase:hit});
  assert.equal(wet.report.latencySamples,48);
  assert.equal(wet.value.samples.indexOf(Math.max(...wet.value.samples))/2,111);
  const dry=mixer.render(graph({...clipper,wet:0}),{phrase:hit});
  assert.equal(dry.report.latencySamples,48);
  assert.equal(dry.value.samples[222],.85);
  assert.equal(dry.value.samples.filter(x=>x!==0).length,2);
});

test('matched audition preserves subtraction across headroom changes and pads the tail',()=>{
  const phrase=tone(24000,i=>.35*Math.sin(phase*700*i));
  const dry=mixer.render(graph({type:'gain',db:0}),{phrase});
  const wet=mixer.render({...graph({type:'gain',db:12}),tail:'keep',end:{samples:26000}},{phrase});
  assert.ok(wet.report.headroom<1);
  const result=mixerMonitor.compare(dry,wet);
  const a=mixerMonitor.meter(result.bypass), b=mixerMonitor.meter(result.value);
  assert.ok(Math.abs(a.integratedLufs-b.integratedLufs)<.00003);
  assert.equal(result.report.frames,26000);
  assert.ok(result.difference.samples.every((x,i)=>x===result.value.samples[i]-result.bypass.samples[i]));
  assert.ok(mixerMonitor.meter(result.effect).rmsDbFS>-10);
  const tiny=tone(960,i=>.00003*Math.sin(phase*700*i));
  assert.equal(mixerMonitor.compare({value:tiny},{value:tiny}).report.matching,'rmsDbFS');
});

test('CLI compares one insert in context and exported room definitions resolve their assets',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mix-tools-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const phrase=tone(2400,i=>i===50 ? .5 : 0), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const go=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music',...args],{cwd:dir,encoding:'utf8'}));
  const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
  fs.writeFileSync(path.join(dir,'phrase.wav'),WAV.encode(phrase,{encoding:'pcm24'}));
  go('rack','describe','typing-room','--out','rack.json');
  save('input.json',{assets:{main:'phrase.wav'},options:{sampleRate:96000}});
  const room=go('rack','audition','rack.json','input.json','--out','room');
  const impulse=WAV.read(room.effect);
  assert.equal(impulse.sampleRate,96000);
  assert.ok(impulse.samples.some((x,i)=>x!==impulse.samples[i^1]));
  assert.ok(impulse.samples.length>96000);
  const recipe=graph({type:'clipper',ceilingDb:-12});
  recipe.strips.master.inserts=['trim'];
  recipe.processors.trim={type:'gain',db:-3};
  save('mix.json',{assets:{phrase:'phrase.wav'},mixer:recipe});
  const take=go('mix','audition','mix.json','--strip','main','--insert','fx','--out','mix');
  const report=JSON.parse(fs.readFileSync(take.report,'utf8'));
  assert.equal(report.mixers.bypass.strips.master.inserts[0].id,'trim');
  assert.equal(report.mixers.processed.strips.master.inserts[0].id,'trim');
  assert.equal(report.mixers.processed.latencySamples,48);
  assert.equal(report.mixers.bypass.latencySamples,0);
  assert.ok(fs.existsSync(take.difference) && fs.existsSync(take.effect));
});
