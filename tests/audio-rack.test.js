const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'),P=ink.load().KIT.procedural, {audioRack:R,mixerMonitor:M}=P.mediaGraph;
const WAV=require('../cli/wav');
const rate=8000, near=(actual,expect)=>assert(Math.abs(actual-expect)<1e-9,`${actual} vs ${expect}`);
const input={sampleRate:rate,channels:1,samples:Float64Array.from({length:4800},(_,i)=>.07*Math.sin(2*Math.PI*i/20))};
const rack={
  format:'ink-studio/audio-rack',version:1,id:'keyed',revision:1,title:'Bench',
  inputs:{main:'program',key:'trigger'},output:'bus',
  strips:{program:{inserts:[{processor:'dyn',sidechain:{strip:'trigger'}}],fader:1,sends:{room:{tap:'post',level:.3}}},
    room:{inserts:['echo']},trigger:{output:null},bus:{}},
  processors:{dyn:{type:'compressor',thresholdDb:-35,ratio:7,lookahead:.01},echo:{type:'delay',seconds:.08,feedback:.36}},
  taps:{recorded:{strip:'program'}},
  macros:{mv:{label:'Move',default:.4,targets:[
    {path:['strips','program','fader'],range:[.5,1]},
    {path:['strips','program','sends','room','level'],range:[.01,.61]}
  ]}}
};
const key={...input,samples:input.samples.map((x,i)=>i>1200&&i<1700 ? .5 : 0)};
test('rack recalls macro automation on named ports, aligns sidechains and exports its taps',()=>{
  const options={sampleRate:rate,map:{tempo:120,changes:[{beat:1,tempo:60}]}};
  const macros={mv:{unit:'beats',curve:'hold',points:[{at:0,value:0},{at:1,value:1}]}};
  const saved=JSON.parse(JSON.stringify(R.state(rack,{macros})));
  const result=R.render(rack,{main:input,key},saved,options);
  assert.equal(result.report.latencySamples,80);
  const tap=result.taps.recorded.samples;
  near(tap[2*810],input.samples[810]*.5);
  near(tap[2*4010],input.samples[4010]);
  assert(Math.abs(tap[2*1410])<Math.abs(input.samples[1410])*.15);
  assert.deepEqual(result,R.render(rack,{main:input,key},saved,options));
  assert.throws(()=>R.render(rack,{main:input},saved,options),/input port/);
  assert.throws(()=>R.state({...rack,revision:2},saved),/revision/);
  assert.throws(()=>R.state(rack,{macros:{mv:{unit:'samples',points:[{at:2,value:0},{at:1,value:1}]}}}),/increasing/);
});

test('matched rack audition pads bypass to retained tail and leaves the recalled take intact',()=>{
  const result=R.audition(rack,{main:input,key},{macros:{mv:.72}},{targetLufs:-19});
  const wet=M.meter(result.value), dry=M.meter(result.bypass);
  assert(result.report.frames>input.samples.length);
  assert.equal(result.value.samples.length,result.bypass.samples.length);
  assert(result.bypass.samples.slice(2*input.samples.length).every(x=>x===0));
  assert(Math.abs(wet.integratedLufs-dry.integratedLufs)<.00002);
  assert(wet.truePeakDbTP<=-1 && dry.truePeakDbTP<=-1);
  const bypass=R.render(rack,{main:input,key},{...result.state,bypass:true},{tail:'cut'});
  assert.equal(bypass.report.bypass,true);
  near(bypass.value.samples[2*806],input.samples[806]);
});

test('external insert gets sample automation, restored state and score-aligned key audio',()=>{
  const definition=structuredClone(rack);
  const hits={unit:'beats',curve:'hold',points:[{at:0,value:.5},{at:.25,value:1.1}]};
  definition.processors.dyn={type:'external',adapter:'fixture',plugin:'one',state:'YQ==',identity:'v1',
    parameters:{6:hits}};
  definition.strips.trigger.inserts=['key-delay'];
  definition.processors['key-delay']={type:'compressor',lookahead:.02,ratio:1};
  let called=0;
  const host={adapters:{fixture:{
    describe(request) {
      assert.equal(request.state,'YQ==');
      assert.deepEqual(request.initial,{6:.5});
      return {identity:'v1',latency:5,tail:12,sidechain:true,
        parameters:{6:{min:0,max:2,automatable:true,stepped:false}}};
    },
    render(request) {
      called++;
      assert.equal(request.identity,'v1');
      assert.deepEqual(request.parameters[6],{curve:'hold',points:[{sample:0,value:.5},{sample:1000,value:1.1}]});
      near(request.input[2*1410],input.samples[1410]);
      near(request.key[2*1300],key.samples[1300]);
      const out=new Float64Array(request.frames*2);
      out.set(request.input.subarray(0,out.length));
      return out;
    }
  }}};
  const {report,taps}=R.render(definition,{main:input,key},{},{},host);
  assert.equal(report.latencySamples,165);
  assert.equal(called,1);
  near(taps.recorded.samples[2*1410],input.samples[1410]*.7);
  assert.throws(()=>R.render(definition,{main:input,key}),/registered audio adapter/);
  definition.processors.dyn.identity='wrong';
  assert.throws(()=>R.render(definition,{main:input,key},{},{},host),/identity/);
});

test('CLI lists native presets and reuses a recalled state with a new input',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-rack-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'source.wav'),WAV.encode(input,{encoding:'pcm24'}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const go=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','rack',...args],{cwd:dir,encoding:'utf8'}));
  assert.deepEqual(go('list').map(row=>row.id),['steel-bus','porcelain-room','pocket-repeater',
    'dynamic-eq','oversampled-clipper','oversampled-saturation','typing-room','factory-warehouse','lady-chapel']);
  go('state','steel-bus','--out','stored.json');
  fs.writeFileSync(path.join(dir,'recipe.json'),JSON.stringify({assets:{main:'source.wav'},state:'stored.json',options:{tail:'cut'}}));
  const files=go('audition','steel-bus','recipe.json','--out','take');
  assert.equal(WAV.read(files.rack).samples.length,WAV.read(files.bypass).samples.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(files.state,'utf8')),JSON.parse(fs.readFileSync(path.join(dir,'stored.json'),'utf8')));
});
