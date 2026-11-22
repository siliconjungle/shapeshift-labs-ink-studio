const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { KIT: K } = require('..').load();

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const W = K.world;
const token = 'a'.repeat(48);
const choice = { id: 'release-lantern', request: 'release-from-desk' };

async function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-patch-interventions-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const journal = () => fs.readFileSync(file('input.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  const world = W.runtime.create({ id: 'gate', dt: .1 }), publisher = W.liveSnapshots.create({ stream: 'audience' });
  publisher.publish(W.graphPorts.frameOf(world.view(), world.query(), []));
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) {
      res.writeHead(403).end();
      return;
    }
    const reply = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      const cursor = JSON.parse(url.searchParams.get('after'));
      return reply(200, publisher.pull(cursor));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls.push({ method: req.method, path: url.pathname, body, journal: journal() });
    if (body.id !== choice.id) return reply(403, { error: 'Intervention is not granted' });
    reply(202, { status: 'scheduled', id: body.id, request: body.request, tick: 1, command: 'live-choice' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  save('project.json', {
    format: 'ink-studio/graph-project', version: 1, inputs: { packet: { type: 'liveSnapshot' } },
    assets: { candidate: { format: 'json', file: 'candidate.json' } },
    nodes: {
      live: { op: 'sim.liveWorld', inputs: { packet: { input: 'packet' } } },
      card: { op: 'raster.canvas', inputs: { width: 1, height: 1, color: [40, 150, 90, 255] } },
      candidate: { op: 'jsonAsset', inputs: { name: 'candidate' } }
    },
    outputs: { picture: { node: 'card' }, state: { node: 'live' }, proposed: { node: 'candidate' } }
  });
  save('candidate.json', choice);
  save('show.json', {
    format: 'ink-studio/patch-show', version: 1, patch: 'project.json', output: 'picture',
    fps: 10, frames: 6, slowMs: 1000, projector: { wait: false },
    liveWorld: { url: 'http://127.0.0.1:' + server.address().port + '/', token, input: 'packet' }
  });
  async function run(input, ...args) {
    const child = spawn(process.execPath, [cli, 'patch', 'show', 'show.json', '--report', 'report.json', ...args], {
      cwd: folder, stdio: ['pipe', 'pipe', 'pipe']
    });
    const done = once(child, 'close');
    t.after(() => child.kill());
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.end(input);
    const [code] = await done;
    return { code, stdout, stderr };
  }
  return { file, read, save, run, calls, journal };
}

test('a live projector ignores proposal-shaped graph outputs and stdin by default', async t => {
  const { file, read, run, calls } = await setup(t);
  const result = await run(JSON.stringify(choice) + '\n');
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(read('report.json').sources.world.state, 'online');
  assert.equal(read('report.json').interventions, undefined);
  assert.equal(fs.existsSync(file('input.ndjson')), false);
  assert.deepEqual(calls, []);
});

test('the explicitly enabled controller journals a pulse before submitting its associated live cursor', async t => {
  const { file, read, run, calls, journal } = await setup(t);
  const input = [choice, { id: 'ungranted', request: 'test-denial' }, { ...choice, args: { branch: 'forged' } }]
    .map(value => JSON.stringify(value)).join('\n') + '\n';
  const flags = ['--intervention-input', '-', '--record-interventions', 'input.ndjson'];
  const result = await run(input, ...flags);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const outcomes = read('report.json').interventions.outcomes;
  assert.deepEqual(outcomes, { scheduled: 1, rejected: 1, 'invalid-input': 1 });
  assert.equal(calls.length, 2);
  const sent = calls.find(call => call.body.id === choice.id);
  assert.equal(sent.path, '/intervene');
  assert.equal(sent.method, 'POST');
  assert.deepEqual(sent.body, { ...choice, after: { stream: 'audience', revision: 0, tick: 0 } });
  const before = sent.journal.find(row => row.kind === 'proposal' && row.input.value.request === choice.request);
  assert.deepEqual(before.input, { time: 0, channel: 'world-intervention', kind: 'pulse', value: choice });
  assert.deepEqual(before.after, sent.body.after);
  assert.deepEqual(journal().find(row => row.status === 'scheduled').receipt, { command: 'live-choice', tick: 1 });
  const recorded = fs.readFileSync(file('input.ndjson'), 'utf8');
  assert(!recorded.includes(token));
  assert(!recorded.includes('forged'));
  const repeated = await run('', ...flags);
  assert.equal(repeated.code, 1);
  assert.equal(fs.readFileSync(file('input.ndjson'), 'utf8'), recorded);
  assert.equal(calls.length, 2);
});

test('rehearsal previews authored pulses and requires a journal destination', async t => {
  const { read, save, run, calls, journal } = await setup(t);
  save('cues.json', {
    format: 'ink-studio/input-recording', version: 1, events: [
      { time: 0, channel: 'world-intervention', kind: 'pulse', value: choice },
      { time: 4, channel: 'world-intervention', kind: 'pulse', value: { ...choice, request: 'later' } }
    ]
  });
  const options = ['--rehearse', '--intervention-input', 'cues.json'];
  const invalid = await run('', ...options);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /--record-interventions/);
  const result = await run('', ...options, '--record-interventions', 'input.ndjson');
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.deepEqual(read('report.json').interventions, { mode: 'preview', outcomes: { preview: 1, 'not-reached': 1 } });
  assert.equal(journal().find(row => row.status === 'preview').index, 1);
  save('show.json', { ...read('show.json'), video: '-' });
  const competing = await run('', '--intervention-input', '-', '--record-interventions', 'unused.ndjson');
  assert.equal(competing.code, 1);
  assert.match(competing.stderr, /cannot both read stdin/);
  assert.deepEqual(calls, []);
});
