const fs = require('node:fs');
const path = require('node:path');
const { readSceneAudio } = require('./scene-audio.js');
const { resolveCheckpoint } = require('./checkpoint-file.js');
const { readProjectBundle } = require('./project-bundle.js');
const { readRecording } = require('./story-exchange.js');
const { graphOutputs } = require('./graph-outputs.js');

const format = 'ink-studio/story-audio';
const usage = 'story audio <recording|run-bundle> <soundtrack.json> --out directory [--from seconds --to seconds]';

function point(T, input, fallback) {
  if (input === undefined) return fallback;
  if (typeof input !== 'string' || !/^\d*(?:\.\d+)?$|^\d+\/[1-9]\d*$/.test(input) || !input)
    throw new TypeError('Story audio needs nonnegative seconds or a ratio');
  const [numerator, denominator] = input.split('/').map(Number);
  return T.read(denominator === undefined ? numerator : { numerator, denominator });
}

function readNativeRun(file, {KIT:K}, onFile) {
  if (fs.statSync(file).size > 128*1024*1024) throw new RangeError('Story recording exceeds its byte budget');
  const bundles = K.authoring.projectBundles, R = K.world.runtime;
  const document = resolveCheckpoint(path.resolve(file),JSON.parse(fs.readFileSync(file,'utf8')),{onBlock:onFile});
  const recording = document?.format === bundles.format && document.version === bundles.storyVersion ?
    readRecording(readProjectBundle(file)) : document;
  if (recording?.format !== R.runFormat || !Number.isSafeInteger(recording.origin?.tick) ||
      !Number.isSafeInteger(recording.end?.tick) || recording.end.tick-recording.origin.tick > 120000)
    throw new TypeError('Expected a bounded native run recording');
  return recording;
}

async function command(file, plan, rest, opt, library) {
  if (!file || !plan || rest.length || typeof opt.out !== 'string' || !opt.out.trim() ||
      Object.keys(opt).some(key => !['out','from','to'].includes(key))) throw new TypeError('Use ' + usage);
  const kit = library(), { world:W, procedural:P } = kit.KIT;
  const T = P.takeTime, R = W.runtime;
  const inputs = new Set([path.resolve(file),path.resolve(plan)]), onFile = entry => inputs.add(path.resolve(entry));
  if (fs.statSync(plan).size > 8*1024*1024) throw new RangeError('Story audio plan exceeds its byte budget');
  const recording = readNativeRun(file,kit,onFile);
  const { world } = recording.origin;
  const period = T.period(world.dt,world.takeClock?.simulationRate);
  const at = tick => T.mul(T.read(tick),period);
  const origin = at(recording.origin.tick), end = at(recording.end.tick);
  const startPoint = point(T,opt.from,origin), endPoint = point(T,opt.to,end);
  if (T.compare(startPoint,origin)<0 || T.compare(endPoint,end)>0 || T.compare(startPoint,endPoint)>=0)
    throw new RangeError('Story audio window falls outside the recorded run');

  const soundtrack = readSceneAudio(plan,{kit,onFile,recordedOnly:true});
  await R.replayAsync(recording);
  const { waves, report } = soundtrack.render({startPoint,endPoint},{
    runtime:()=>R.openRecording(recording),recordedThrough:recording.end.tick,trace:true
  });
  const output = Object.entries(waves).map(([name,bytes]) => ({file:name+'.wav',bytes}));
  const { storyAudio, ...mix } = report;
  const cueFile = row => (report.post ? row.bus : row.stem)+'.wav';
  const documentReport = {
    format, version:1, world:world.id, coverage:{fromTick:recording.origin.tick,toTick:recording.end.tick},
    window:{from:T.pack(startPoint),to:T.pack(endPoint)}, ...mix,
    files:Object.fromEntries(Object.keys(waves).map(name=>[name,name+'.wav'])),
    sections:storyAudio.sections.map(row => ({...row,file:'music.wav'})),
    layers:storyAudio.layers,
    cues:storyAudio.cues.map(row=>({...row,file:cueFile(row)}))
  };
  graphOutputs([...inputs]).write(path.resolve(opt.out),[...output,{file:'report.json',document:documentReport}]);
}

module.exports = { command, usage, readNativeRun };
