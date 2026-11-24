const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const WAV = require('../cli/wav.js');
const Field = require('../cli/scene-ambisonics.js');

const kit = ink.load(), { KIT: K } = kit, T = K.procedural.takeTime, R = K.world.runtime;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const rate = 8000, wav = (values, channels = 1) => ({ samples: Float32Array.from(values), channels, sampleRate: rate });
const near = (actual, expected, epsilon = 5e-7) =>
  assert(Math.abs(actual - expected) < epsilon, actual + ' differs from ' + expected);
function sample(pcm, frame) {
  return Array.from(pcm.samples.subarray(frame * pcm.channels, (frame + 1) * pcm.channels));
}
const worldEvent = (tick, cue) => ({tick, action:'world/event', args:{kind:'audio-cue', cue}});
const fieldKey = 'ambisonic/ambience-ambix', dialogueKey = 'ambisonic/dialogue', foleyKey = 'ambisonic/close-foley';

test('the soundfield preserves axis signs, stereo beds and headroom after rotation', () => {
  const sources = { dry: wav([.4]), beds: wav([.4, 0], 2), loud: wav([.8]), inverse: wav([-.8]) };
  const at = (asset, first, point, bus = 'effects') => ({ asset, first, bus,
    ...(point && {points:[{sample:first, gain:1, pan:0, cutoff:22000, delay:0, fieldDirection:Field.direction([0,0,0],point)}]}) });
  const voices = [
    at('dry', 4, [0,0,-1]), at('dry', 5, [-1,0,0]), at('dry', 6, [0,1,0]),
    at('dry', 7, [1,0,0]), at('dry', 8, [0,0,1]), at('dry', 9, null),
    at('beds', 10, null, 'ambience'), at('beds', 11, [-1,0,0], 'dialogue'),
    at('loud', 12, [-1,0,0]), at('inverse', 12, [0,1,0])
  ];
  const { waves, manifest } = Field.render(voices, name => sources[name], { start:4, end:16, sampleRate:rate });
  const field = WAV.decode(waves[fieldKey], { metadata:true }), dialogue = WAV.decode(waves[dialogueKey]);
  const g = manifest.headroom;
  near(g, 1 / Math.hypot(.8,.8));
  assert.deepEqual(manifest.soundfield.channels, ['W','Y','Z','X']);
  assert.equal(field.bwf.timeReference, '4');
  const expected = [
    [.4,0,0,.4], [.4,.4,0,0], [.4,0,.4,0], [.4,-.4,0,0], [.4,0,0,-.4],
    [.4,0,0,0], [.2,.2*Math.SQRT1_2,0,.2*Math.SQRT1_2], [0,0,0,0], [0,.8,-.8,0]
  ];
  for (const [frame, target] of expected.entries())
    for (const [channel, value] of sample(field, frame).entries()) near(value, target[channel] * g);
  near(Math.hypot(...sample(field, 8).slice(1)), 1);
  near(sample(dialogue, 7)[0], .4*g);
  assert.equal(sample(dialogue, 7)[1], 0);
  assert(WAV.decode(waves[foleyKey]).samples.every(value=>value===0));
});

test('story audio publishes aligned WAVs and scene-fixed directions while leaving its stereo print intact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-ambisonic-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const at = name => path.join(dir, name);
  const save = (name, data) => fs.writeFileSync(at(name), JSON.stringify(data));
  const read = name => JSON.parse(fs.readFileSync(at(name), 'utf8'));
  const sound = (name, values, channels) => fs.writeFileSync(at(name+'.wav'),
    WAV.encode(wav(values,channels), {encoding:'pcm24'}));
  const call = (...args) => execFileSync(process.execPath, [cli, 'story', 'audio', 'run.json', 'plan.json', ...args],
    { cwd:dir, stdio:'pipe' });

  const run = R.create({id:'ambisonic-handoff',dt:.05,commands:[
    worldEvent(2,'left'),worldEvent(3,'voice'),worldEvent(4,'foley'),worldEvent(5,'height')
  ]});
  run.advance(8);
  save('run.json',run.recording());

  sound('bed',[.1]);
  sound('click',[.35]);
  sound('voice',[.45,.12],2);
  sound('foley',[.27]);
  const ir = new Float32Array(241); ir[240] = .5;
  sound('ir',ir);
  const definition = {format:'ink-studio/scene-audio',version:1,sampleRate:rate,post:{},
    listener:{at:[0,1,0],forward:[0,0,1]},
    assets:Object.fromEntries(['bed','click','voice','foley','ir'].map(id=>[id,id+'.wav'])),
    tracks:[{asset:'bed',time:.07,bus:'ambience'}],
    spatial:{
      distance:{reference:4},
      cues:{
        left:{asset:'click',at:[-1,1,0],bus:'effects'},
        height:{asset:'click',at:[0,2,0],bus:'effects',earlyReflections:false},
        voice:{asset:'voice',at:[2,1,0],bus:'dialogue'},
        foley:{asset:'foley',at:[1,1,-1],bus:'foley'}
      },
      earlyReflections:{room:{min:[-3,0,-3],max:[3,3,3],faces:{
        west:'wall',east:false,floor:false,ceiling:false,north:false,south:false}},materials:{wall:{gain:.8,cutoff:3000}},
        order:1,maxTaps:1},
      roomResponse:{wet:.5,smoothing:0,rooms:{bay:{min:[-3,0,-3],max:[3,3,3],
        probes:[{at:[0,1,0],impulse:'ir'}]}}}
    }
  };
  save('plan.json',definition);
  call('--out','stock','--from','.05','--to','.35');
  call('--out','package','--from','.05','--to','.35','--ambisonic');
  assert.deepEqual(fs.readFileSync(at('package/mix.wav')),fs.readFileSync(at('stock/mix.wav')));
  assert.deepEqual(fs.readFileSync(at('package/dialogue.wav')),fs.readFileSync(at('stock/dialogue.wav')));
  const report=read('package/report.json'), manifest=read('package/'+report.ambisonic);
  assert.deepEqual([manifest.firstSample,manifest.endSample,manifest.frames],[400,2800,2400]);
  const track = id => WAV.read(at('package/ambisonic/'+manifest.files[id].file), {metadata:true});
  const field=track('field'), dialogue=track('dialogue'), foley=track('foley');
  assert.deepEqual([field.channels,dialogue.channels,foley.channels],[4,2,2]);
  for (const wave of [field,dialogue,foley]) {
    assert.equal(wave.bwf.timeReference,'400');
    assert.equal(wave.samples.length/wave.channels,2400);
  }
  const frame = time => Math.round(time*rate)-400;
  const readAt = (wave,time) => sample(wave,frame(time));
  for (const [i, expected] of [.1,0,0,0].entries()) near(readAt(field,.07)[i],expected);
  for (const [i, expected] of [.35,.35,0,0].entries()) near(readAt(field,.1)[i],expected);
  for (const [i, expected] of [.35,0,.35,0].entries()) near(readAt(field,.25)[i],expected);
  assert.deepEqual(readAt(field,.15),[0,0,0,0]);
  assert.deepEqual(readAt(field,.2),[0,0,0,0]);
  near(readAt(dialogue,.15)[0],.45);
  near(readAt(dialogue,.15)[1],.12);
  near(readAt(foley,.2)[0],.27);
  near(readAt(foley,.2)[1],.27);
  assert.equal(dialogue.samples.filter(Boolean).length,2);
  assert.equal(foley.samples.filter(Boolean).length,2);
  const tap=report.cues.find(row=>row.cue==='left').reflections[0].arrivalSample-400;
  const echo=sample(field,tap), tail=readAt(field,.13);
  assert(echo[0]>.01 && echo[1]>.01);
  assert(tail[0]>.08);
  for (const direction of tail.slice(1)) near(direction,0,5e-5);

  save('plan.json',{...definition,listener:{at:[0,1,0],forward:[0,0,-1]}});
  call('--out','look-ahead','--from','.05','--to','.35','--ambisonic');
  assert.deepEqual(fs.readFileSync(at('look-ahead/ambisonic/ambience-ambix.wav')),
    fs.readFileSync(at('package/ambisonic/ambience-ambix.wav')));

  call('--out','tail-crop','--from','.125','--to','.14','--ambisonic');
  const cropped=WAV.read(at('tail-crop/ambisonic/ambience-ambix.wav'));
  assert.deepEqual(cropped.samples,field.samples.slice(frame(.125)*4,frame(.14)*4));
});
