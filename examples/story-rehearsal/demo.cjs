const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const target = path.resolve(process.argv[2]), file = name => path.join(target, name);
const { KIT: { world: W, procedural: P } } = require(repo).load();
const cli = path.join(repo, 'cli/ink-studio.js'), PNG = require(path.join(repo, 'cli/png.js'));
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: target, stdio: ['ignore', 'pipe', 'inherit'] });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const shot = (width, height, commands) => P.raster.rgba(P.drawing2d.render({ width, height, commands, edges: 'hard' }));
const image = (name, raster) => fs.writeFileSync(file(name), PNG.encode(raster.width, raster.height, raster.data, 4));
const anchorNames = { arrival: 'SKIFF ARRIVES', choice: 'KEEPER RELEASES', ring: 'BEACON RINGS' };
const fps = 10, frames = 23;
const children = new Set();

function harbor(name, lit) {
  image(name, shot(310, 154, [
    rect(0, 0, 310, 154, '#263b54'), ellipse(218, 14, 29, 29, '#eed5ac'),
    rect(0, 91, 310, 63, '#1f4557'),
    poly([[0, 95], [40, 75], [94, 89], [162, 83], [227, 94], [286, 63], [310, 86], [310, 102], [0, 102]], '#314d61'),
    ...Array.from({ length: 14 }, (_, n) => rect((n * 51 + 15) % 280, 111 + n * 3, 14 + (n % 5), 1, '#517585')),
    ...(lit ? [
      poly([[148, 62], [310, 37], [310, 87]], '#9b807b'),
      poly([[148, 63], [310, 53], [310, 71]], '#efd7a0'),
      rect(128, 119, 22, 2, '#c39072'), rect(135, 132, 19, 2, '#bb8b6e')
    ] : []),
    poly([[0, 154], [0, 133], [70, 119], [122, 126], [170, 144], [181, 154]], '#172837'),
    poly([[103, 129], [118, 66], [151, 66], [162, 143]], '#9e8786'),
    poly([[143, 67], [151, 67], [162, 143], [150, 143]], '#755e70'),
    rect(115, 55, 40, 15, '#453e51'), rect(119, 58, 32, 8, lit ? '#fee4a4' : '#5d7885'),
    rect(130, 56, 3, 12, '#463c4e'), rect(141, 56, 3, 12, '#463c4e'),
    poly([[112, 55], [135, 40], [158, 55]], '#6e5372')
  ]));
}

function assets() {
  fs.copyFileSync(path.join(__dirname, 'ink-studio.config.js'), file('ink-studio.config.js'));
  harbor('waiting.png', false);
  harbor('beacon.png', true);
  const world = structuredClone(require(path.join(repo, 'examples/world-access/harbor.world.json')));
  world.id = 'beacon-rehearsal';
  world.causality = true;
  world.history = { enabled: true };  const scope = { document: 'harbor-watch', story: 'dispatch' };
  world.commands.push(
    { tick: 2, action: 'world/event', args: { kind: 'arrival', ...scope, actor: 'pilot' } },
    { tick: 5, action: 'world/event', args: W.timedEvents.at(.462, { kind: 'beacon-ring', ...scope }) }
  );
  save('harbor.world.json', world);
  save('choices.json', [{ tick: 4, id: 'light-the-lantern', action: 'world/story-choose',
    args: { ...scope, stage: 'plan', visit: 1, branch: 'release', reason: 'pilot-in-range' } }]);
  run('sim', 'run', 'harbor.world.json', '--actions', 'choices.json', '--ticks', '17', '--record', 'harbor.run.json');
  run('story', 'events', 'harbor.run.json', '--format', 'envelopes', '--out', 'committed.json');
  const envelope = read('committed.json');
  const beats = Object.fromEntries(Object.entries({ arrival: 'arrival', choice: 'story-branch-chosen', ring: 'beacon-ring' })
    .map(([name, kind]) => [name, envelope.events.find(row => row.kind === kind)]));
  const ids = Object.fromEntries(Object.entries(beats).map(([name, event]) => [name, W.inspectionLinks.identify(event)]));
  save('selected-beats.json', { ...envelope, events: Object.values(beats) });
  const clock = { fps, simulationRate: 10, sampleRate: 48000 };
  save('edit.json', { format: 'ink-studio/clock-map', version: 1, id: 'harbor-edit', clock,
    sources: { harbor: { clock, events: { file: 'selected-beats.json' } } },
    clips: [
      { id: 'live-cut', source: 'harbor', in: { tick: 0 }, out: { tick: 11 }, at: { frame: 0 } },
      { id: 'repeat', source: 'harbor', in: { tick: 4 }, out: .45, at: { frame: 16 } }
    ],
    cues: {
      arrival: { source: 'harbor', at: { beatId: ids.arrival }, preset: 'waiting' },
      release: { source: 'harbor', at: { beatId: ids.choice }, preset: 'lit' },
      ring: { source: 'harbor', at: { beatId: ids.ring }, preset: 'lit' }
    }
  });
  run('take', 'map', 'edit.json', '--out', 'edit.map.json');
  const node = id => ({ node: id });
  const graph = { format: 'ink-studio/graph-project', version: 1,
    inputs: { level: { type: 'number', default: 0 }, stall: { type: 'boolean', default: false } },
    assets: { waiting: { format: 'png', file: 'waiting.png' }, lit: { format: 'png', file: 'beacon.png' } },
    nodes: {
      camera: { op: 'raster.canvas', inputs: { width: 1, height: 1, color: [38, 44, 62] } },
      waiting: { op: 'pngAsset', inputs: { name: 'waiting' } },
      lit: { op: 'pngAsset', inputs: { name: 'lit' } },
      grade: { op: 'data.record', inputs: { opacity: { input: 'level' } } },
      slate: { op: 'raster.blend', inputs: { background: node('waiting'), foreground: node('lit'), options: node('grade') } },
      composite: { op: 'rehearsal.grade', inputs: { source: node('slate'), camera: node('camera'), stall: { input: 'stall' } } }
    }, outputs: { picture: node('composite') }
  };
  save('healthy.patch.json', graph);
  graph.nodes.camera = { op: 'patch.video' };
  save('fault.patch.json', graph);
  const show = { format: 'ink-studio/patch-show', version: 1, fps, frames, size: '1x1', output: 'picture',
    patch: 'healthy.patch.json', cueMap: 'edit.map.json', slowMs: 95, initial: 'waiting',
    presets: { waiting: { level: 0 }, lit: { level: 1 } },
    beatWindows: [{ beatId: ids.ring, tick: beats.ring.tick, label: 'Beacon tone tail', fromFrame: 5, toFrame: 13 }]
  };
  save('healthy.show.json', show);
  save('fault.show.json', { ...show, patch: 'fault.patch.json', video: '-', videoTimeoutMs: 170,
    projector: { wait: true }, inputs: { stall: true } });
  return ids;
}

async function rehearseFault() {
  const child = spawn(process.execPath, [cli, 'patch', 'show', 'fault.show.json', '--rehearse', '--report', 'fault.report.json'],
    { cwd: target, stdio: ['pipe', 'pipe', 'inherit'] });
  children.add(child);
  const done = once(child, 'close');
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ready = JSON.parse((await lines.next()).value);
  const session = await fetch(ready.projector + 'session').then(response => response.json());
  const headers = { 'x-ink-session': session.key, 'x-ink-client': 'rehearsal-review' };
  let serial = 0;
  async function poll() {
    const response = await fetch(ready.projector + 'frame?after=' + serial, { headers });
    if (response.status === 204) return;
    assert.equal(response.status, 200);
    serial = Number(response.headers.get('x-ink-serial'));
    const pixels = new Uint8Array(await response.arrayBuffer());
    return { frame: Number(response.headers.get('x-ink-frame')), picture: { width: 310, height: 154, data: pixels } };
  }
  child.stdin.write(Buffer.from([38, 61, 72, 255]));
  const until = async frame => {
    for (let i = 0; i < 175; i++) {
      const row = await poll();
      if (row?.frame >= frame) return row;
      await delay(17);
    }
    throw new Error('Expected a projector frame at ' + frame);
  };
  await until(0);
  await poll();
  await delay(930);
  await until(8);
  await until(13);
  const refresh = setInterval(() => child.stdin.write(Buffer.from([45, 61, 72, 255])), 95);
  try {
    const { picture } = await until(20);
    image('projected.png', picture);
    await until(frames - 1);
  } finally { clearInterval(refresh); }
  assert.deepEqual(await done, [2, null]);
  children.delete(child);
  return read('fault.report.json');
}

function compare(ids, healthy, fault) {
  const marks = Object.entries(ids).map(([id, beatId]) => [beatId, anchorNames[id]]);
  const issue = fault.storyDiagnostics.findings;
  const text = (value, x, y, color = '#a8bbc9', size = 1) => label(value, x, y, color, size);
  const swatches = { schedule: '#ef9c78', projector: '#b9aafa', video: '#81c7bb',
    'slow-stage': '#e1c575', 'source-offline': '#6ab7c4', 'missed-cue': '#ef9a9a' };
  const lanes = ['schedule', 'projector', 'slow-stage', 'source-offline', 'missed-cue'];
  const headings = ['SCHEDULER SKIP', 'PROJECTOR SKIP', 'SLOW STAGE', 'VIDEO OFFLINE', 'MISSED CUES'];
  const left = 354, cell = 22, top = 136, span = cell * frames;
  const art = [
    rect(0, 0, 888, 352, '#111c2a'), text('BEACON REHEARSAL', 18, 15, '#eed4aa', 2),
    text('ONE CUT / TWO REHEARSALS', 18, 39, '#7ad6bd'),
    rect(18, 64, 310, 154, '#27374a'), text('PROJECTOR FRAME 20+', 18, 226),
    text('CLEAN: ' + healthy.rendered + ' FRAMES / ALL CUES ON TIME', 18, 257, '#7ad6bd'),
    text('FAULT: ' + fault.dropped.schedule + ' SCHEDULE SLOTS MISSED', 18, 278, '#f2b196'),
    text('MATCHES USE THE ORIGINAL BEAT ID', 18, 326),
    text('EDITED SHOW FRAMES', left, 64, '#c1ced9')
  ];
  for (let f = 0; f <= frames; f++) {
    art.push(rect(left + f * cell, 124, 1, 183, f % 4 ? '#223247' : '#374b60'));
    if (f % 4 === 0) art.push(text(String(f), left + f * cell + 2, 111));
  }
  for (const [i, key] of lanes.entries()) {
    const y = top + i * 33;
    art.push(rect(left, y, span, 20, '#233448'));
    for (const row of issue.filter(row => (row.channel ?? row.kind) === key)) {
      if (row.fromFrame === undefined) continue;
      art.push(rect(left + row.fromFrame * cell + 1, y + 12, (row.toFrame - row.fromFrame) * cell - 2, 6, swatches[key]));
    }
    art.push(text(headings[i], left + 6, y + 2, '#d6e1e9'));
  }
  const map = read('edit.map.json');
  for (const [i, [beatId, name]] of marks.entries()) {
    const placements = map.cues.filter(row => row.beatId === beatId);
    art.push(text(name, left + i * 169, 86, ['#9dbde2', '#eab383', '#e6cb85'][i]));
    for (const cue of placements) art.push(rect(left + cue.at.showFrame * cell, 99, 3, 9, ['#9dbde2', '#eab383', '#e6cb85'][i]));
  }
  const snapshot = PNG.raster(file('projected.png'));
  image('rehearsal-comparison.png', P.raster.blend(shot(888, 352, art), {
    width: snapshot.w, height: snapshot.h, data: snapshot.data
  }, { x: 18, y: 64 }));
}

async function main() {
  fs.mkdirSync(target, { recursive: true });
  const ids = assets();
  run('patch', 'show', 'healthy.show.json', '--rehearse', '--report', 'healthy.report.json');
  const healthy = read('healthy.report.json'), fault = await rehearseFault();
  assert.equal(healthy.passed, true);
  assert.equal(healthy.storyDiagnostics, undefined);
  const diagnostics = fault.storyDiagnostics.findings;
  const linked = (kind, beat, property, value) =>
    diagnostics.some(row => row.kind === kind && row[property] === value && row.beats.some(ref => ref.beatId === beat));
  assert(linked('slow-stage', ids.arrival, 'stage', 'node:composite'));
  assert(linked('dropped-frame', ids.choice, 'channel', 'schedule'));
  assert(linked('dropped-frame', ids.arrival, 'channel', 'projector'));
  assert(linked('source-offline', ids.ring, 'source', 'video'));
  assert(linked('missed-cue', ids.choice, 'status', 'superseded'));
  assert(linked('missed-cue', ids.ring, 'status', 'late'));
  assert(fault.beatLinks.some(row => row.beatId === ids.choice && row.clip === 'repeat' && row.status === 'applied'));
  run('beat', ids.choice, 'committed.json', 'edit.map.json', 'fault.report.json', '--out', 'release.inspection.json');
  assert(read('release.inspection.json').matches.some(row => row.diagnostic?.kind === 'missed-cue'));
  compare(ids, healthy, fault);
  save('demo-report.json', { beats: ids, healthy: { rendered: healthy.rendered, passed: healthy.passed },
    fault: { dropped: fault.dropped, missedCues: fault.storyDiagnostics.missedCues, reported: diagnostics.length } });
  console.log('Rehearsed both shows and traced actual timing failures to their original story beats.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const child of children) child.kill();
});
