const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dgram = require('node:dgram');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeOsc } = require('../cli/show-protocols.js');

const cli = path.join(__dirname, '../cli/ink-studio.js');
const project = (nodes, inputs) => ({ format: 'ink-studio/graph-project', version: 1,
  inputs, nodes, outputs: { picture: { node: 'picture' } } });
const cue = options => ({ format: 'ink-studio/patch-show', version: 1, patch: 'patch.json', output: 'picture', ...options });

function room(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-patch-show-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  function start(...args) {
    const child = spawn(process.execPath, [cli, 'patch', 'show', 'cues.json', ...args], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    const done = once(child, 'close');
    t.after(() => child.kill());
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => { stderr += text; });
    return { child, done, async next() {
      const line = await lines.next();
      assert.equal(line.done, false, stderr);
      return JSON.parse(line.value);
    } };
  }
  return { write, read, start, run: (input, ...args) => spawnSync(process.execPath, [cli, 'patch', 'show', 'cues.json', ...args],
    { cwd: dir, input, encoding: 'utf8', timeout: 6000 }) };
}

async function viewer(url) {
  const session = await fetch(url + 'session').then(response => response.json());
  const headers = { 'x-ink-session': session.key, 'x-ink-client': 'test-projector' };
  let serial = 0;
  return { session, headers,
    async frame() {
      const result = await fetch(url + 'frame?after=' + serial, { headers });
      if (result.status === 204) return;
      assert.equal(result.status, 200);
      serial = Number(result.headers.get('x-ink-serial'));
      assert.equal(result.headers.get('x-ink-width'), '1');
      assert.equal(result.headers.get('x-ink-height'), '1');
      return { frame: Number(result.headers.get('x-ink-frame')), pixel: [...new Uint8Array(await result.arrayBuffer())] };
    },
    async midi(value) {
      const response = await fetch(url + 'midi', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(value) });
      assert.equal(response.status, 204);
    }
  };
}

test('a paced projector show applies timed cues, OSC and MIDI and reports projector skips', { timeout: 15000 }, async t => {
  const { write, read, start } = room(t);
  write('ink-studio.config.js', `module.exports = { graphOperations: {
    'test.picture': { inputs: { value: 'number' }, outputs: { value: 'raster' },
      run({ value }) { return { value: { width:1, height:1, data: Uint8Array.of(value, 18, 27, 255) } }; } }
  } };`);
  write('patch.json', project({ picture: { op: 'test.picture', inputs: { value: { input: 'red' } } } }, { red: { type: 'number' } }));
  write('cues.json', cue({ fps: 10, frames: 38, slowMs: 1000, projector: { wait: true },
    presets: { warm: { red: 10 }, cool: { red: 20 }, picked: { red: 30 }, program: { red: 40 } }, initial: 'warm',
    cues: [{ frame: 8, preset: 'cool' }], osc: { port: 0 },
    midi: { channel: 2, notes: { 60: 'picked' }, programs: { 3: 'program' } } }));
  const run = start('--rehearse', '--report', 'rehearsal.json');
  const ready = await run.next();
  assert.equal(ready.event, 'show-ready');
  assert.equal(ready.wait, true);
  const url = ready.projector;
  const page = await fetch(url);
  assert.match(await page.text(), /Ink Patch Projector/);
  assert.equal((await fetch(url + 'frame?after=0')).status, 403);
  assert.equal((await fetch(url + 'session', { headers: { origin: 'https://example.invalid' } })).status, 403);
  const projector = await viewer(url);
  assert.equal(projector.session.midi.channel, 2);
  const until = async value => {
    for (let i = 0; i < 100; i++) {
      const picture = await projector.frame();
      if (picture?.pixel[0] === value) {
        assert.deepEqual(picture.pixel,[value,18,27,255]);
        return picture.frame;
      }
      await delay(20);
    }
    assert.fail('Missing projected value ' + value);
  };
  assert((await until(10)) < 8);
  assert.equal((await fetch(url + 'frame?after=0', { headers: { ...projector.headers, 'x-ink-client': 'another-projector' } })).status, 409);
  await projector.midi({ event: 'online', detail: 'Test input' });
  assert((await until(20)) >= 8);
  const osc = dgram.createSocket('udp4');
  t.after(() => osc.close());
  await new Promise((resolve, reject) => osc.send(encodeOsc('/ink/preset', ['warm']), ready.oscPort, '127.0.0.1',
    error => error ? reject(error) : resolve()));
  await until(10);
  await projector.midi({ event: 'message', data: [0x91, 60, 0] });
  await projector.midi({ event: 'message', data: [0x91, 60, 100] });
  await until(30);
  await projector.midi({ event: 'message', data: [0xc1, 3] });
  await until(40);
  await projector.frame();
  await delay(330);
  await projector.frame();
  await projector.frame();
  await projector.midi({ event: 'offline', detail: 'Controller unplugged' });
  await projector.midi({ event: 'online', detail: 'Test input' });
  for (let i = 0; i < 150; i++) {
    if ((await projector.frame())?.frame >= 36) break;
    await delay(20);
  }
  const summary = await run.next();
  assert.deepEqual(await run.done, [2, null]);
  assert.deepEqual(read('rehearsal.json'), summary);
  assert(summary.dropped.projector >= 1);
  assert(summary.displayed > 1);
  assert(summary.rendered > 10);
  assert.equal(summary.sources.midi.state, 'online');
  assert(summary.sourceEvents.some(event => event.name === 'midi' && event.detail === 'Controller unplugged'));
  assert.deepEqual(summary.presets.map(row => [row.source, row.preset]),
    [['initial','warm'], ['cue','cool'], ['osc','warm'], ['midi','picked'], ['midi','program']]);
  assert.equal(summary.presets[1].scheduledFrame, 8);
});

test('rehearsal flags dropped time slots, slow nodes and a stalled video stream and closes stdin', { timeout: 10000 }, async t => {
  const { write, start } = room(t);
  write('ink-studio.config.js', `module.exports = { graphOperations: {
    'test.delay': { inputs: { source: 'raster' }, outputs: { value: 'raster' }, time: true,
      run({ source }) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 95); return { value: source }; } }
  } };`);
  write('patch.json', project({ camera: { op: 'patch.video' }, picture: { op: 'test.delay', inputs: { source: { node: 'camera' } } } }));
  write('cues.json', cue({ fps: 40, frames: 24, size: '1x1', video: '-', videoTimeoutMs: 150 }));
  const run = start('--rehearse');
  await run.next();
  run.child.stdin.write(Buffer.from([42, 17, 65, 255]));
  const report = await run.next();
  assert.deepEqual(await run.done, [2,null]);
  assert.equal(report.reason, 'completed');
  assert.equal(report.rendered + report.dropped.schedule, 24);
  assert(report.dropped.schedule > 0);
  assert(report.stages['node:picture'].slowFrames > 0);
  assert.equal(report.sources.video.state, 'offline');
  assert.equal(report.sources.video.detail, 'Video frame timeout');
  assert.equal(report.video.received, 1);
  assert(report.video.repeated > 0);
  assert(report.sourceEvents.some(event => event.name === 'video' && event.state === 'online'));
});

test('headless rehearsal succeeds with a healthy source and protects the cue and patch files', { timeout: 10000 }, async t => {
  const { write, read, run } = room(t);
  write('patch.json', project({ picture: { op: 'patch.video' } }));
  const options = { fps: '24/1', frames: 1, size: '1x1', video: '-', slowMs: 1000 };
  write('cues.json', cue(options));
  const protectedResult = run(undefined, '--rehearse', '--report', 'patch.json');
  assert.equal(protectedResult.status, 1);
  assert.match(protectedResult.stderr, /outputs must be separate/);
  assert.equal(read('patch.json').nodes.picture.op, 'patch.video');
  const raw = Buffer.from([17, 18, 19, 255]);
  const child = run(raw, '--rehearse');
  assert.equal(child.status, 0, child.stderr);
  const [, report] = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(report.passed, true);
  assert.equal(report.sources.video.state, 'online');
  assert.equal(report.sources.projector.state, 'waiting');
  write('cues.json', cue({ ...options, frames: 2 }));
  const early = run(raw, '--rehearse');
  assert.equal(early.status, 2, early.stderr);
  const [, short] = early.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(short.sources.video.detail, 'Video source reached EOF');
});

test('a prerecorded clip keeps its frames aligned to the show slots', {
  timeout: 10000, skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0
}, t => {
  const { write, run } = room(t), frames = 6;
  write('patch.json', project({ picture: { op: 'patch.video' } }));
  write('cues.json', cue({ fps: 10, frames, size: '2x2', video: 'source.y4m', slowMs: 1000 }));
  const header = 'YUV4MPEG2 W2 H2 F10:1 Ip A1:1 C420jpeg\n';
  write('source.y4m', header + 'FRAME\nIIIIII'.repeat(frames));
  const result = run(undefined, '--rehearse');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [, report] = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(report.video.received, frames);
  assert.equal(report.video.repeated, 0);
  assert.equal(report.sources.video.state, 'online');
});
