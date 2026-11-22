const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(process.argv[3]??path.join(__dirname,'../..')), cli=path.join(root,'cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'studio/out/clock-mapping');
const K=require(root).load().KIT, W=K.world;
fs.mkdirSync(out,{recursive:true});
const file=name=>path.join(out,name);
const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
function run(...args) {
  const result=spawnSync(process.execPath,[cli,...args],{cwd:out,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
}
const fps={numerator:30000,denominator:1001}, simulationRate={numerator:60000,denominator:1001};
const clock={fps,simulationRate,sampleRate:48000};
save('harbor.world.json',{format:W.format,version:1,id:'harbor-clock',dt:K.timeDomains.take(clock).dt,takeClock:clock,
  history:{enabled:false},commands:[{tick:12,action:'world/event',args:{kind:'arrival',entity:'boat'}},
    {tick:14,action:'world/event',args:{kind:'contact',timing:{format:'ink-studio/event-time',time:.21}}}]});
run('sim','run','harbor.world.json','--ticks','18','--record','harbor.run.json');
run('sim','fixture','harbor.run.json','--from','6','--ticks','18','--out','harbor.fixture.json');
run('sim','verify','harbor.fixture.json','--out','harbor.verify.json');
save('dialogue.words.json',[
  {id:'hold',text:'Hold',from:{sample:2205},to:{sample:6615}},
  {id:'land',text:'land',from:{sample:8820},to:{sample:13230}}
]);
const plan={format:W.clockMapping.format,version:1,id:'harbor-edit',clock,
  sources:{harbor:{clock:{fps,sampleRate:44100},events:{file:'harbor.fixture.json'},words:{file:'dialogue.words.json'}}},
  cues:{arrival:{source:'harbor',at:{event:'12.0',branch:'main'},preset:'amber'},
    dialogue:{source:'harbor',at:{word:'land',edge:'end'},preset:'blue'}}};
const cut={id:'entry',source:'harbor',in:{tick:6},out:{tick:18}};
const samples=new Float32Array(96);
samples[12]=.5;
fs.writeFileSync(file('sync-click.wav'),require(path.join(root,'cli/wav.js')).encode({sampleRate:48000,channels:1,samples}));
const audioPlan=clockMap=>({assets:{click:'sync-click.wav'},
  session:{format:'ink-studio/audio-editorial',version:1,id:'harbor-spots',sampleRate:48000,clockMap,
    picture:{fps,shots:[{id:'cut',frames:24}]},clips:['arrival','dialogue'].map(id=>({
      id,spot:{cue:id},take:'main',takes:{main:{asset:'click',sync:{sample:12}}}
    }))}});
for(const [name,clip] of [['before',{...cut,at:{frame:4}}],['after',{...cut,at:{frame:10},duration:{frame:8}}]]) {
  save(name+'.clock.json',{...plan,clips:[clip]});
  run('take','map',name+'.clock.json','--out',name+'.map.json');
  save(name+'.audio.json',audioPlan(read(name+'.map.json')));
  run('music','editorial','render',name+'.audio.json','--out',name+'-audio');
}
const before=read('before.map.json'), after=read('after.map.json');
assert.deepEqual(before.events[0].original,after.events[0].original);
assert.deepEqual([before.events[0].edited.frame,after.events[0].edited.frame],[7,14]);
assert.deepEqual([before.events[0].edited.sample,after.events[0].edited.sample],[11211,22422]);
assert.deepEqual(after.cues.map(cue=>cue.at.showFrame),[14,18]);
assert.deepEqual(read('after-audio/report.json').clips.map(row=>row.spot.sample),after.cues.map(row=>row.at.sample));
run('take','map','after.clock.json','--format','timeline','--out','scene.timeline.json');
save('scene.world.json',{format:W.format,version:1,id:'harbor-preview',timeline:read('scene.timeline.json')});
save('scene.take.json',{format:'ink-studio/take',version:1,clock,world:'scene.world.json'});
run('take','sample','scene.take.json','--frame','14','--out','scene.frame14.json');
assert.equal(read('scene.frame14.json').timeline.cues[0].source.tick,12);

fs.writeFileSync(file('ink-studio.config.js'),`module.exports = { graphOperations: {
  'demo.picture': { inputs: { value: 'number' }, outputs: { value: 'raster' },
    run({ value }) { return { value: { width:1, height:1, data: Uint8Array.of(value, 18, 27, 255) } }; } }
} };\n`);
save('patch.json',{format:'ink-studio/graph-project',version:1,inputs:{color:{type:'number',default:20}},
  nodes:{picture:{op:'demo.picture',inputs:{value:{input:'color'}}}},outputs:{picture:{node:'picture'}}});
save('show.json',{format:'ink-studio/patch-show',version:1,patch:'patch.json',output:'picture',size:'1x1',fps:'30000/1001',
  frames:24,slowMs:1000,presets:{amber:{color:220},blue:{color:70}},cueMap:'after.map.json'});
run('patch','show','show.json','--rehearse','--report','show.rehearsal.json');
const fired=read('show.rehearsal.json').presets;
assert.deepEqual(fired.map(cue=>cue.scheduledFrame),[14,18]);
assert.deepEqual(fired[0].clockCue.original,after.events[0].original);
console.log('Arrival tick 12 retains its original time. The edit moves it from picture frame 7 / sample 11211 to frame 14 / sample 22422.');
console.log('The mapped dialogue ending spots audio at its edited sample and fires the show preset on frame 18.');
