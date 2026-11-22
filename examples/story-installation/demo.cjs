const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const dir = path.resolve(process.argv[2]), file = name => path.join(dir, name);
const cli = path.join(repo, 'cli/ink-studio.js'), PNG = require(path.join(repo, 'cli/png.js'));
const { encodeOsc } = require(path.join(repo, 'cli/show-protocols.js'));
const { KIT: { procedural: P } } = require(repo).load();
const raster = (width, height, commands) => P.drawing2d.render({ width, height, commands, edges: 'hard' });
const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const writePng = (name, image) => fs.writeFileSync(file(name), PNG.encode(image.width, image.height, image.data, 4));
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const pathFill = (points, fill) => ({ type: 'polygon', points, fill });
const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
const width = 320, height = 160, fps = 10;
const camera = { width: 128, height: 72, frames: 26 };
const worldFile = name => JSON.parse(fs.readFileSync(path.join(repo, 'examples/world-access', name), 'utf8'));
const children = new Set();

function harbor(lit) {
  return raster(width, height, [
    rect(0, 0, width, height, lit ? '#40394f' : '#25374e'),
    ellipse(242, 21, 32, 32, '#f2cba2'),
    ...Array.from({ length: 19 }, (_, n) => rect(10 + n * 16, 11 + (n * 19) % 41, 1, 1, '#a6a4b3')),
    pathFill([[0, 95], [56, 79], [96, 89], [142, 85], [199, 100], [254, 82], [320, 95], [320, 150], [0, 150]], '#32445a'),
    rect(0, 110, 320, 42, lit ? '#394f63' : '#2b5364'),
    ...Array.from({ length: 18 }, (_, n) => rect((n * 79) % 302, 113 + n * 2, 12 + n % 6, 1, '#5f7d84')),
    ...(lit ? [
      pathFill([[153, 72], [320, 44], [320, 96]], '#817681'),
      pathFill([[150, 73], [320, 58], [320, 82]], '#c09487'),
      pathFill([[150, 73], [320, 67], [320, 77]], '#e8ba8c'),
      pathFill([[142, 112], [154, 112], [168, 153], [124, 153]], '#8c776c'),
      rect(132, 129, 24, 1, '#e2af83'), rect(142, 140, 24, 1, '#e2af83')
    ] : []),
    pathFill([[0, 160], [0, 130], [68, 125], [109, 130], [172, 146], [189, 160]], '#202b3d'),
    pathFill([[108, 130], [124, 81], [156, 81], [167, 147], [115, 144]], '#aa8884'),
    pathFill([[146, 81], [156, 81], [167, 147], [152, 146]], '#70566b'),
    rect(121, 66, 39, 17, '#404356'), rect(125, 68, 31, 11, lit ? '#ffdf9a' : '#638394'),
    rect(132, 67, 3, 14, '#3b3949'), rect(145, 67, 3, 14, '#3b3949'),
    pathFill([[118, 66], [141, 52], [162, 66]], '#875c68'),
    rect(131, 127, 10, 19, '#444050'),
    pathFill([[219, 124], [258, 124], [251, 130], [226, 130]], '#252c3d'),
    rect(236, 114, 5, 9, '#a88977')
  ]);
}
function artwork() {
  writePng('harbor-dark.png', harbor(false));
  writePng('harbor-lit.png', harbor(true));
}

function cameraInput() {
  const { width, height, frames } = camera;
  const chips = [];
  for (let index = 0; index < frames; index++) {
    const x = Math.min(96, 22 + Math.max(0, index - 4) * 7);
    const picture = raster(width, height, [
      rect(0, 0, width, height, '#172239'), rect(74, 13, 47, 46, '#264647'),
      rect(75, 14, 45, 44, '#233a40'), label('SIGNAL', 80, 48, '#5f8686'),
      ellipse(x - 6, 29, 13, 13, '#efdfb1'), ellipse(x - 3, 32, 7, 7, '#faf7e3')
    ]);
    chips.push(Buffer.from(picture.data));
    if (index === 18) writePng('camera-example.png', picture);
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', width + 'x' + height, '-framerate', String(fps), '-i', 'pipe:0', '-an',
    '-c:v', 'ffv1', '-pix_fmt', 'bgr0', file('camera.mkv')], { input: Buffer.concat(chips) });
}

function assets() {
  const world = worldFile('harbor.world.json'), policy = worldFile('harbor.access.json');
  for (const grant of Object.values(policy.interventions)) grant.maxLag = 2;
  save('harbor.world.json', world);
  save('harbor.access.json', policy);
  artwork();
  cameraInput();
  const at = node => ({ node });
  const graph = { format: 'ink-studio/graph-project', version: 1, inputs: { packet: { type: 'liveSnapshot' } },
    assets: { dark: { format: 'png', file: 'harbor-dark.png' }, lit: { format: 'png', file: 'harbor-lit.png' } },
    nodes: {
      live: { op: 'sim.liveWorld', inputs: { packet: { input: 'packet' } } },
      lamp: { op: 'sim.worldScalar', inputs: { source: at('live'), options: { query: 'lanterns' } } },
      dark: { op: 'pngAsset', inputs: { name: 'dark' } },
      lit: { op: 'pngAsset', inputs: { name: 'lit' } },
      blend: { op: 'data.record', inputs: { opacity: at('lamp') } },
      harbor: { op: 'raster.blend', inputs: { background: at('dark'), foreground: at('lit'), options: at('blend') } }
    }, outputs: { picture: at('harbor') }
  };
  save('harbor.graph.json', graph);
  graph.nodes.camera = { op: 'patch.video' };
  graph.nodes.regions = { op: 'patch.track', inputs: { source: at('camera'), options: { channel: 'luma', threshold: 170 } } };
  graph.outputs.regions = at('regions');
  save('tracking.graph.json', graph);
  const base = { format: 'ink-studio/patch-show', version: 1, patch: 'harbor.graph.json', output: 'picture',
    fps, frames: 26, projector: { wait: false }, slowMs: 1000 };
  save('tracking.show.json', { ...base, patch: 'tracking.graph.json', size: '128x72', video: 'camera.mkv',
    installation: { tracking: { output: 'regions', dwellFrames: 3, zones: {
      signal: { rect: [.625, .19, .25, .60], grant: 'release-lantern' }
    } } } });
  save('midi.show.json', { ...base, midi: { channel: 2 },
    installation: { midi: { notes: { 60: 'hold-lantern' } } } });
  save('osc.show.json', { ...base, osc: { port: 0 },
    installation: { osc: { address: '/harbor/choice', choices: { release: 'release-lantern' } } } });
}

function launch(...args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const done = once(child, 'close');
  children.add(child);
  done.finally(() => children.delete(child));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  return { async next() {
    const row = await lines.next();
    assert(!row.done, stderr || 'Expected another CLI report');
    return JSON.parse(row.value);
  }, async check() { assert.deepEqual(await done, [0, null], stderr || args.join(' ')); } };
}
function run(...args) {
  execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
}

async function projector(url, mode) {
  const session = await fetch(url + 'session').then(response => response.json());
  const headers = { 'x-ink-session': session.key, 'x-ink-client': 'harbor-' + mode };
  let sequence = 0;
  return {
    async frame() {
      const response = await fetch(url + 'frame?after=' + sequence, { headers });
      if (response.status === 204) return;
      assert.equal(response.status, 200);
      sequence = Number(response.headers.get('x-ink-serial'));
      return { width, height, data: Buffer.from(await response.arrayBuffer()) };
    },
    async midi(value) {
      assert.equal(session.midi.choices, true);
      const response = await fetch(url + 'midi', { method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(value) });
      assert.equal(response.status, 204);
    }
  };
}
async function poll(supply, message) {
  for (let attempt = 0; attempt < 125; attempt++) {
    const result = await supply();
    if (result) return result;
    await delay(18);
  }
  throw new Error(message);
}
async function sendOsc(port, address, args) {
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => socket.send(encodeOsc(address, args), port, '127.0.0.1',
      error => error ? reject(error) : resolve()));
  } finally { socket.close(); }
}

async function demonstrate(kind, scratch) {
  const world = launch('sim', 'live', 'harbor.world.json', '--policy', 'harbor.access.json',
    '--ticks', '15', '--step-ms', '275', '--linger-ms', '120', '--record', kind + '.run.json');
  const authority = await world.next(), { token } = authority.principals['west-guide'];
  const showFile = path.join(scratch, kind + '.json'), showConfig = read(kind + '.show.json');
  fs.writeFileSync(showFile, JSON.stringify({ ...showConfig, patch: file(showConfig.patch),
    ...(showConfig.video && { video: file(showConfig.video) }),
    liveWorld: { url: authority.url, token, input: 'packet' }
  }), { mode: 0o600 });
  const show = launch('patch', 'show', showFile, '--record-interventions', kind + '.ndjson', '--report', kind + '.show-report.json');
  const ready = await show.next(), viewer = await projector(ready.projector, kind);
  const initial = await poll(() => viewer.frame(), 'No projector picture');
  if (kind !== 'tracking') {
    await poll(async () => {
      const result = await fetch(authority.url + 'snapshot', { headers: { Authorization: 'Bearer ' + token } });
      return (await result.json()).cursor.tick > 0;
    }, 'Story did not open for the device input');
    if (kind === 'midi') {
      await viewer.midi({ event: 'online', detail: 'Demo MIDI sender' });
      for (const data of [[0x90, 60, 106], [0x91, 59, 106], [0x91, 60, 106], [0x91, 60, 106], [0x81, 60, 0]])
        await viewer.midi({ event: 'message', data });
    } else {
      await sendOsc(ready.oscPort, '/harbor/choice', ['unknown']);
      await sendOsc(ready.oscPort, '/harbor/choice', ['release']);
    }
  }
  const ending = kind === 'midi' ? initial : await poll(async () => {
    const picture = await viewer.frame();
    const offset = (72 * width + 126) * 4;
    return picture?.data[offset] === 255 ? picture : false;
  }, 'Projector did not display the committed lantern');
  writePng(kind + '.png', ending);
  await Promise.all([world.check(), show.check()]);
  const journal = fs.readFileSync(file(kind + '.ndjson'), 'utf8');
  assert(!journal.includes(token));
  run('patch', 'choices', kind + '.ndjson', kind + '.run.json', '--out', kind + '.replay.json', '--track', kind + '.input.json');
  const report = read(kind + '.replay.json');
  assert.equal(report.verification.status, 'verified');
  assert.equal(report.choices.length, 1);
  const [choice] = report.choices;
  assert.equal(choice.status, 'committed');
  assert.equal(choice.device.kind, kind);
  assert.equal(choice.choice.branch, kind === 'midi' ? 'hold' : 'release');
  assert.equal(choice.ending.outcome, kind === 'midi' ? 'dark' : 'lit');
  assert.equal(read(kind + '.input.json').events.length, 1);
  return choice;
}

function compare(rows) {
  const background = '#172433', active = '#79d4c4', copper = '#f1b285';
  const size = { width: 336, height: 255 };
  const overview = raster(1008, 306, [
    rect(0, 0, 1008, 306, '#0e1926'), label('HARBOR SIGNALS', 15, 14, '#f5d9aa', 2),
    label('THREE INPUTS / ONE RECORDED WORLD COMMAND PATH', 15, 34, active)
  ]);
  let sheet = overview;
  for (const [index, row] of rows.entries()) {
    const { device, choice, ending, tick } = row;
    const details = device.kind === 'midi' ? 'CHANNEL 2 / NOTE 60' :
      device.kind === 'osc' ? '/HARBOR/CHOICE / RELEASE' : 'SIGNAL ZONE / TRACK ' + device.track + ' / 3 FRAMES';
    const card = raster(size.width, size.height, [
      rect(6, 0, 324, 250, background), rect(8, 32, 320, 160, '#101726'),
      label(device.kind.toUpperCase(), 16, 10, active, 2), label('TICK ' + tick, 268, 16, '#b1c1cc'),
      label(details, 16, 202, '#9cb4c1'),
      label(choice.branch.toUpperCase() + ' / ' + ending.outcome.toUpperCase(), 16, 220, copper, 2)
    ]);
    const display = PNG.raster(file(device.kind + '.png'));
    const composed = P.raster.blend(card, { width: display.w, height: display.h, data: display.data }, { x: 8, y: 32 });
    sheet = P.raster.blend(sheet, composed, { x: size.width * index, y: 51 });
  }
  writePng('harbor-signals.png', sheet);
}

async function main(scratch) {
  assets();
  const rows = [];
  for (const kind of ['tracking', 'midi', 'osc']) rows.push(await demonstrate(kind, scratch));
  compare(rows);
  save('demo-report.json', { choices: rows });
  console.log('Tracking, MIDI, and OSC each committed a named branch. All three branches replayed from their native recordings.');
}
fs.mkdirSync(dir, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-installation-'));
main(scratch).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all([...children].map(child => { const done = once(child, 'close'); child.kill(); return done; }));
  fs.rmSync(scratch, { recursive: true, force: true });
});
