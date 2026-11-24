const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const WAV = require('../cli/wav.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const pictureBeat = 'ink:beat:performance/main/3.0', audioBeat = 'ink:beat:performance/main/9.0';
const sampleRate = 8000, fps = 20;
const node = name => ({ node: name });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-beat-performance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const at = file => path.join(directory, file);
  const write = (file, data) => fs.writeFileSync(at(file), JSON.stringify(data));
  const read = file => JSON.parse(fs.readFileSync(at(file), 'utf8'));
  const run = (...args) => spawnSync(process.execPath, [cli, 'patch', ...args],
    { cwd:directory, encoding:'utf8', input:Buffer.alloc(16*16*4,52), timeout:30000 });
  fs.writeFileSync(at('ink-studio.config.js'), `module.exports = { graphOperations: {
    'test.marker': { inputs: {picture:'displayRaster',camera:'raster',stall:'boolean'}, outputs:{value:'displayRaster'}, time:true,
      instantiate() {
        let visits=0, blocked=false;
        const run=()=>{ throw Error('Requires the asynchronous graph'); };
        run.async=async ({picture,camera,stall})=>{
          if (stall && !blocked) { blocked=true; await new Promise(resolve=>setTimeout(resolve,155)); }
          const data=picture.data.slice();
          data[0]=++visits % 251; data[1]=camera.data[0];
          return {value:{...picture,data}};
        };
        return run;
      }
    }
  }};`);
  write('patch.json', { format:'ink-studio/graph-project', version:1,
    inputs:{ stall:{type:'boolean',default:false} }, nodes:{
      world:{op:'scene.diorama',inputs:{definition:{id:'beacon',seed:7,style:'slate',solids:[
        {id:'base',kind:'box',at:[0,0,0],half:[.45,.45,.45],mat:{role:'stone'},res:.22}
      ]}}},
      draw:{op:'scene.render',inputs:{source:node('world'),channels:['coverage'],options:{width:16,height:16}}},
      camera:{op:'patch.video'},
      marker:{op:'test.marker',inputs:{picture:node('draw'),camera:node('camera'),stall:{input:'stall'}}}
    }, outputs:{picture:node('marker')} });
  write('show.json', { format:'ink-studio/patch-show', version:1, patch:'patch.json', output:'picture',
    fps, frames:26, video:'-', size:'16x16', slowMs:70, presets:{hold:{stall:false},flash:{stall:true}},
    cues:[{frame:4,preset:'flash',beatId:pictureBeat},{frame:10,preset:'hold'}],
    beatWindows:[{beatId:pictureBeat,tick:3,fromFrame:4,toFrame:10},{beatId:audioBeat,tick:9,fromFrame:14,toFrame:19}] });
  const samples = Float32Array.from({length:1300}, (_, i) => .2*Math.sin(2*Math.PI*550*i/sampleRate));
  fs.writeFileSync(at('bell.wav'), WAV.encode({samples, sampleRate, channels:1}, {encoding:'pcm24'}));
  const production = { arrangement:{
    score:{key:{root:'D4'},tempoMap:{tempo:120},harmonies:{home:{root:'D4',quality:'unison'}}},
    parts:{pad:{role:'pad'}},motifs:{},sections:[{id:'watch',bars:1,harmony:'home'}]},
    patches:{pad:{type:'fm',ratio:2,index:.61,env:{attack:.04,decay:.16,sustain:.58,release:.28}}},
    tracks:{pad:{patch:'pad',gain:-16,send:.33,clips:[{id:'line',beat:0,length:4,voices:[{id:'player',
      notes:[{id:'note',beat:0,duration:1.2,midi:62,velocity:.68}]}]}]}}};
  write('score.json', { sources:{hold:production}, timeline:{entry:'hold',segments:{hold:{source:'hold',end:1.4}}},
    live:{options:{sampleRate,pageSize:256,maxPages:8},streams:{bell:{file:'bell.wav',gain:-4}}} });
  write('route.json', { end:1.3,blockFrames:400,lookaheadFrames:64,events:[
    {intent:{kind:'music-cue',resource:'bell',time:.75,beatId:audioBeat},observedAt:.75}
  ] });
  return { at, run, read };
}

test('captures missed frames and live PCM underruns and runs both workloads from a saved beat case', t => {
  const { at, run, read } = fixture(t);
  const show = run('show','show.json','--rehearse','--capture-performance','capture',
    '--live-score','score.json','--live-route','route.json');
  assert.equal(show.status,2,show.stderr || show.stdout);
  const manifest = read('capture/report.json'), work=read('capture/run.json');
  assert(work.videoFrames.length>0);
  assert(work.videoFrames.some(frame=>fs.readFileSync(at('capture/'+frame.file))[0]===52));
  const cases = manifest.cases.map(row=>({ file:row.file, value:read('capture/'+row.file) }));
  const picture = cases.find(row=>row.value.faults.some(fault=>fault.kind==='dropped-frame' && fault.channel==='schedule'));
  const audio = cases.find(row=>row.value.faults.some(fault=>fault.kind==='audio-underrun' && fault.channel==='live-score'));
  assert(picture, JSON.stringify(manifest));
  assert(audio, JSON.stringify(manifest));
  assert(picture.value.beats.some(beat=>beat.beatId===pictureBeat));
  assert(picture.value.faults.some(fault=>fault.beats.some(beat=>beat.beatId===pictureBeat)));
  assert(picture.value.picture.some(frame=>frame.draw.passes.some(pass=>pass.node==='draw' &&
    pass.rasterPasses>0 && pass.channels.includes('coverage'))));
  const gap=audio.value.faults.find(fault=>fault.kind==='audio-underrun' && fault.channel==='live-score');
  assert.equal(gap.beatId,audioBeat);
  assert(gap.voices.some(voice=>voice.resource==='bell'));
  assert(audio.value.audio.blocks.some(block=>block.peakVoices>=2 && block.voices.some(voice=>voice.part==='pad')));
  for (const row of new Map([picture,audio].map(row=>[row.file,row])).values()) {
    const output = 'replay-'+row.file;
    const stress = run('stress','capture/'+row.file,'--repeat','2','--out',output);
    assert.equal(stress.status,0,stress.stderr || stress.stdout);
    const report=read(output);
    assert.equal(report.passed,true);
    assert.equal(report.runs.length,2);
    assert(report.runs.every(replay=>replay.pictureMatches && replay.audioMatches));
    if (row===audio) {
      assert(report.runs.every(replay=>replay.audioUnderruns>0 && replay.warmupFrames>0));
    }
  }
  fs.appendFileSync(at('route.json'),'\n');
  const invalid=run('stress','capture/'+audio.file);
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/dependency has changed/);
});
