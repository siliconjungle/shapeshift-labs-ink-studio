const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { KIT: K } = require('..').load();
const { showReport } = require('../cli/patch-show-report.js');
const { openProjector } = require('../cli/patch-projector.js');
const { readShow } = require('../cli/patch-show-config.js');
const { locate } = require('../cli/inspection-links.js');

const id = n => 'ink:beat:quay/main/' + n + '.0';
const window = (n, fromFrame, toFrame) => ({ beatId: id(n), tick: n, fromFrame, toFrame, alignment: 'window' });

test('diagnostics intersect exact show ranges and preserve repeated placements and runtime observations', t => {
  const report = showReport({ fps: 10, slowMs: 100, cues: [
    { frame: 4, preset: 'amber', beatId: id(2), clockCue: { id: 'release', clip: 'first', anchor: { event: { tick: 2 } } } },
    { frame: 5, preset: 'red', beatId: id(3) },
    { frame: 9, preset: 'amber', beatId: id(2), clockCue: { id: 'release', clip: 'repeat' } },
    { frame: 15, preset: 'dark' }
  ], beatAnchors: [window(1, 2, 4), window(4, 6, 10), window(5, 11, 12)] }, true);
  report.frame(3);
  report.stage('node:grade', 145);
  report.graphLink('pulse', { beatId: id(1), tick: 1, kind: 'arrival' });
  report.schedule(4, 7);
  report.frame(7);
  report.source('audio', 'offline', 'Input disconnected');
  report.stage('output', 110);
  report.cueLink(4, 'superseded');
  report.cueLink(5, 'applied');
  report.video('received', 2);
  report.frame(9);
  report.cueLink(9, 'applied');
  report.displayed(1, { ranges: [{ fromFrame: 3, toFrame: 4 }], unknown: 0 });
  report.frame(10);
  report.source('audio', 'online');
  const summary = report.finish('completed');
  const { findings, unattributed, missedCues } = summary.storyDiagnostics;
  const get = (kind, value) => findings.find(row => row.kind === kind &&
    [row.channel, row.stage, row.source, row.status].includes(value));
  const drop = get('dropped-frame', 'schedule');
  assert.deepEqual([drop.fromFrame, drop.toFrame, drop.count], [4, 7, 3]);
  assert.deepEqual(drop.beats.map(row => [row.beatId, row.frame]), [[id(2), 4], [id(3), 5], [id(4), 6]]);
  assert.deepEqual(get('slow-stage', 'node:grade').beats.map(row => row.alignment), ['window', 'observed']);
  assert.deepEqual(get('dropped-frame', 'projector').beats.map(row => row.frame), [3, 3]);
  assert.deepEqual(get('dropped-frame', 'video').beats.map(row => row.beatId), [id(4)]);
  assert.equal(get('dropped-frame', 'video').timing, 'detected');
  const outage = get('source-offline', 'audio');
  assert.deepEqual([outage.fromFrame, outage.toFrame], [7, 10]);
  assert.deepEqual(outage.beats.map(row => [row.beatId, row.frame, row.clip]), [[id(4), 7, undefined], [id(2), 9, 'repeat']]);
  assert.equal(get('missed-cue', 'superseded').beats[0].clip, 'first');
  assert.equal(get('missed-cue', 'late').playedFrame, 7);
  assert.equal(get('missed-cue', 'not-reached').beats.length, 0);
  assert.deepEqual([unattributed, missedCues], [1, 3]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-rehearsal-inspection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'report.json');
  fs.writeFileSync(file, JSON.stringify(summary));
  const hits = locate(K.world.inspectionLinks, id(2), [file], dir).matches.filter(row => row.diagnostic);
  assert.deepEqual(hits.map(row => [row.diagnostic.kind, row.frame]), [
    ['dropped-frame', 4], ['missed-cue', 4], ['source-offline', 9]
  ]);
});

test('an exact clock map and a cropped presentation report supply distinct local placements', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-rehearsal-placements-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = name => path.join(dir, name);
  const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data));
  const fps = { numerator: 30000, denominator: 1001 };
  const events = { format: K.world.storyEvents.envelopeFormat, version: 1, world: 'quay', dt: .1, events: [
    { version: 1, world: 'quay', branch: 'main', tick: 2, id: '2.0', system: 'world', kind: 'arrival', payload: {} }
  ] };
  const map = K.world.clockMapping.map({ format: 'ink-studio/clock-map', version: 1, id: 'quay',
    clock: { fps }, sources: { stage: { events } }, clips: [
      { id: 'a', source: 'stage', in: { tick: 1 }, out: { tick: 3 }, at: { frame: 1 }, duration: { frame: 3 } },
      { id: 'b', source: 'stage', in: { tick: 1 }, out: { tick: 3 }, at: { frame: 6 }, duration: { frame: 3 } }
    ], cues: { signal: { source: 'stage', at: { beatId: id(2) }, preset: 'amber' } }
  });
  save('mapped.json', map);
  save('pack.json', { format: 'ink-studio/story-presentation-pack', version: 1, clock: { frameRate: fps, fromFrame: 62, toFrame: 64 },
    frames: [{ frame: 62, offset: 0, tick: 18, beats: [{ beatId: id(18), tick: 18, kind: 'departure' }] },
      { frame: 63, offset: 1, tick: 20, beats: [] }]
  });
  const show = { format: 'ink-studio/patch-show', version: 1, patch: 'patch.json', output: 'picture',
    fps: '30000/1001', frames: 10, cueMap: 'mapped.json', presentationReport: 'pack.json', presets: { amber: {} } };
  save('show.json', show);
  const config = await readShow(file('show.json'), true, { KIT: K });
  assert.deepEqual(config.cues.map(row => row.frame), [3, 8]);
  assert.deepEqual(config.beatAnchors.map(row => [row.alignment, row.fromFrame, row.sourceFrame ?? row.clip]), [
    ['presentation', 0, 62], ['edited-event', 2, 'a'], ['edited-event', 7, 'b']
  ]);
  save('show.json', { ...show, fps: '29.97' });
  await assert.rejects(readShow(file('show.json'), true, { KIT: K }), /show frame rate/);
});

test('the projector reports skipped publications using show indices across scheduler holes', async t => {
  const drops = [];
  const projector = await openProjector({ port: 0, wait: false }, undefined, {
    afterAttach() {}, afterFrame: (count, ranges) => { if (count) drops.push({ count, ...ranges }); }
  });
  t.after(() => projector.close());
  const session = await fetch(projector.url + 'session').then(response => response.json());
  const headers = { 'x-ink-session': session.key, 'x-ink-client': 'rehearsal-test' };
  async function read(after) {
    const response = await fetch(projector.url + 'frame?after=' + after, { headers });
    if (response.status === 204) return;
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    return Number(response.headers.get('x-ink-serial'));
  }
  const pixel = { width: 1, height: 1, data: Uint8Array.of(0, 0, 0, 255) };
  projector.publish(0, pixel);
  assert.equal(await read(0), 1);
  await read(1);
  for (const frame of [1, 4, 5, 6]) projector.publish(frame, pixel);
  assert.equal(await read(1), 5);
  await read(5);
  assert.deepEqual(drops, [{ count: 3, unknown: 0, ranges: [
    { fromFrame: 1, toFrame: 2 }, { fromFrame: 4, toFrame: 6 }
  ] }]);
});

test('story rehearsal aligns audio evidence and picture faults on the exact show clock', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-audio-rehearsal-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(name,document)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(document));
  const receipt=(n,plannedSample,outcome,reason)=>({beatId:id(n),cue:'latch',bus:'foley',asset:'hatch',
    requestedSample:plannedSample,plannedSample,actualSample:null,outcome,reason});
  save('playback.json',{format:'ink-studio/audio-playback-receipts',version:1,sampleRate:48000,firstSample:4800,
    endSample:24000,receipts:[receipt(2,6402,'dropped','voice-limit'),receipt(7,8100,'dropped','withheld'),
      receipt(9,9400,'muted','out-of-range')]});
  save('listen.json',{format:'ink-studio/music-live-report',version:1,sampleRate:48000,firstSample:0,endSample:12000,
    audioDiagnostics:{findings:[
      {kind:'audio-underrun',fromSample:800,toSample:2600,resource:'wind',sourceSample:800},
      {kind:'late-musical-join',fromSample:4800,toSample:8001,beatId:id(3),expectedSample:4800,actualSample:8000}
    ],omitted:{'audio-underrun':2}}});
  const spec={format:'ink-studio/patch-show',version:1,fps:'30000/1001',frames:12,patch:'patch.json',
    output:'picture',beatWindows:[{beatId:id(1),fromFrame:2,toFrame:3}],
    audioReports:[{file:'playback.json',atFrame:4},{file:'listen.json',fromSample:1600,toSample:9600,atFrame:2}]};
  save('show.json',spec);
  const config=await readShow(path.join(dir,'show.json'),true,{KIT:K});
  const report=showReport(config,true);
  report.frame(2);
  report.displayed(1,{ranges:[{fromFrame:2,toFrame:3}],unknown:0});
  const summary=report.finish('completed');
  assert.equal(summary.passed,false);
  assert.deepEqual(summary.audioDiagnostics.counts,{'missed-audio-cue':1,'audio-underrun':1,'late-musical-join':1});
  assert.deepEqual(summary.audioDiagnostics.omitted,{});
  const findings=summary.storyDiagnostics.findings;
  const audio=kind=>findings.find(row=>row.kind===kind);
  assert.deepEqual([audio('missed-audio-cue').fromFrame,audio('missed-audio-cue').toFrame],[5,6]);
  assert.deepEqual([audio('late-musical-join').fromFrame,audio('late-musical-join').toFrame],[3,6]);
  assert.deepEqual(audio('audio-underrun').beats.map(beat=>[beat.beatId,beat.alignment]),[[id(1),'window']]);
  assert.equal(audio('missed-audio-cue').beats[0].beatId,id(2));
  assert.equal(audio('late-musical-join').beats[0].beatId,id(3));
  assert(findings.some(row=>row.kind==='dropped-frame' && row.channel==='projector'));
  save('report.json',summary);
  const [hit]=locate(K.world.inspectionLinks,id(3),[path.join(dir,'report.json')],dir).matches;
  assert.deepEqual([hit.diagnostic.sourceReport,hit.diagnostic.fromSample,hit.diagnostic.toSample,
    hit.diagnostic.sourcePointer],['listen.json',4800,8001,'/audioDiagnostics/findings/1']);
  assert.equal(showReport(config,true).finish('completed').passed,false);
  assert.equal(showReport(config,false).finish('completed').passed,true);

  save('show.json',{...spec,audioReports:[{file:'listen.json'}]});
  const whole=await readShow(path.join(dir,'show.json'),true,{KIT:K});
  assert.equal(showReport(whole,true).finish('completed').audioDiagnostics.counts['audio-underrun'],3);
  save('show.json',{...spec,audioReports:[{file:'listen.json',fromSample:1600,toSample:13000}]});
  await assert.rejects(readShow(path.join(dir,'show.json'),true,{KIT:K}),/in-range show placement/);
});
