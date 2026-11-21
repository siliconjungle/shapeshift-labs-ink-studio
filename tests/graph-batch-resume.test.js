const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const parseLines = value => value.trim().split('\n').map(line => JSON.parse(line));
const finished = lines => Object.fromEntries(lines.filter(row => row.type === 'case-finished')
  .map(row => [row.id, row.status]));

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = file => path.join(root, file);
  const write = (file, value) => fs.writeFileSync(at(file), value);
  const json = (file, value) => write(file, JSON.stringify(value));
  const read = file => fs.readFileSync(at(file), 'utf8');
  const args = ['graph', 'batch', 'project.json', 'cases.json'];
  const invoke = (...options) => spawnSync(process.execPath, [cli, ...args, ...options],
    { cwd: root, encoding: 'utf8', timeout: 15000 });
  const run = (status, ...options) => {
    const result = invoke(...options);
    assert.equal(result.status, status, result.stderr || result.stdout);
    return options.includes('--progress') ? parseLines(result.stdout) : JSON.parse(result.stdout);
  };
  const cases = values => json('cases.json', Object.entries(values).map(([id, value]) =>
    ({ id, inputs: { label: id, value } })));
  write('ink-studio.config.js', `
const fs = require('node:fs');
module.exports = { graphOperations: { probe: {
  cacheVersion: 1, inputs: { label: 'string', value: 'number' }, outputs: { value: 'number' },
  run({ label, value }) {
    fs.appendFileSync('evaluations.txt', label + '\\n');
    if (label === 'slow' && fs.existsSync('block')) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    }
    if (label === 'throws' && fs.existsSync('fault')) throw new Error('Fixture lost its source');
    return { value: label === 'asserts' && fs.existsSync('fault') ? 0 : value };
  }
} } };
`);
  json('project.json', {
    format: 'ink-studio/graph-project', version: 1,
    inputs: { label: 'string', value: 'number' },
    nodes: { probe: { op: 'probe', inputs: { label: { input: 'label' }, value: { input: 'value' } } } },
    outputs: { result: { node: 'probe' } },
    exports: { result: { output: 'result', format: 'json' } },
    assertions: [{ id: 'positive', output: 'result', path: [], op: 'min', value: 1 }]
  });
  return { root, at, args, write, read, cases, invoke, run };
}

const resumable = ['--out', 'out', '--resume', '--progress', 'ndjson'];

test('a host can observe a committed case, kill the batch and resume without redoing it', { timeout: 20000 }, async t => {
  const { root, args, at, write, read, cases, invoke, run } = workspace(t);
  cases({ first: 3, slow: 6, last: 7 });
  write('block', '');
  const child = spawn(process.execPath, [cli, ...args, ...resumable], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const closed = once(child, 'close');
  const events = createInterface({ input: child.stdout });
  let committed, observedError = '';
  child.stderr.on('data', chunk => { observedError += chunk; });
  for await (const line of events) {
    const event = JSON.parse(line);
    if (event.type === 'case-finished' && event.id === 'first') {
      committed = event;
      break;
    }
  }
  assert(committed, observedError);
  assert.equal(committed.status, 'completed');
  const first = 'out/cases/first/';
  assert.equal(committed.reportSha256, sha256(fs.readFileSync(at(first + 'report.json'))));
  assert.equal(committed.artifacts[0].sha256, sha256(fs.readFileSync(at(first + 'artifacts/result.json'))));
  const before = fs.statSync(at(first + 'artifacts/result.json'));
  const other = invoke(...resumable);
  assert.equal(other.status, 1, other.stderr || other.stdout);
  assert.match(other.stderr, /Another graph batch is writing/);

  child.kill('SIGKILL');
  const [, signal] = await closed;
  assert.equal(signal, 'SIGKILL');
  fs.unlinkSync(at('block'));
  fs.appendFileSync(at('out/progress.ndjson'), '{"torn":');
  const history = run(0, ...resumable);
  assert.deepEqual(finished(history), { first: 'reused', slow: 'completed', last: 'completed' });
  assert.deepEqual(history.at(-1).report.resume, { completed: 2, reused: 1, failed: 0, error: 0, progress: 'progress.ndjson' });
  assert.equal(history.at(-1).code, 0);
  assert.equal(read('evaluations.txt').split('\n').filter(id => id === 'first').length, 1);
  assert.equal(fs.statSync(at(first + 'artifacts/result.json')).ino, before.ino);
  assert.equal(history.find(row => row.status === 'reused').reportSha256, committed.reportSha256);
  const journal = parseLines(read('out/progress.ndjson'));
  assert.equal(journal.at(-1).type, 'batch-finished');
  assert.equal(journal.filter(row => row.type === 'batch-started').length, 2);
  assert.deepEqual(JSON.parse(read('out/report.json')), history.at(-1).report);
  assert.deepEqual(fs.readdirSync(at('out/.ink-batch')), []);
});

test('failed and errored cases retry, and only verified success is retained', t => {
  const { at, write, read, cases, run } = workspace(t);
  cases({ good: 5, asserts: 4, throws: 8, damaged: 7, last: 9 });
  write('fault', '');
  const before = run(1, ...resumable, '--cache', 'cache');
  assert.deepEqual(finished(before), { good: 'completed', asserts: 'failed', throws: 'error', damaged: 'completed', last: 'completed' });
  assert.match(JSON.parse(read('out/cases/throws/report.json')).error, /lost its source/);
  assert.equal(JSON.parse(read('out/cases/asserts/artifacts/result.json')), 0);
  fs.unlinkSync(at('fault'));
  write('out/cases/damaged/artifacts/result.json', '0\n');
  const after = run(0, ...resumable, '--cache', 'cache');
  assert.deepEqual(finished(after), { good: 'reused', asserts: 'completed', throws: 'completed', damaged: 'completed', last: 'reused' });
  assert.equal(JSON.parse(read('out/cases/asserts/artifacts/result.json')), 4);
  assert.equal(JSON.parse(read('out/cases/throws/artifacts/result.json')), 8);
  assert.equal(JSON.parse(read('out/cases/damaged/artifacts/result.json')), 7);
  assert.deepEqual(read('evaluations.txt').trim().split('\n'), ['good', 'asserts', 'throws', 'damaged', 'last', 'asserts', 'throws']);

  cases({ last: 9, good: 12 });
  const edited = run(0, ...resumable);
  assert.deepEqual(finished(edited), { last: 'reused', good: 'completed' });
  assert.equal(JSON.parse(read('out/cases/good/artifacts/result.json')), 12);
});

test('streaming can start a batch without resume, and preserves assertion exit status', t => {
  const { cases, read, run } = workspace(t);
  cases({ normal: 1, failed: 0 });
  const streamed = run(2, '--progress', 'ndjson', '--out', 'out');
  assert.deepEqual(finished(streamed), { normal: 'completed', failed: 'failed' });
  assert.equal(streamed.at(-1).code, 2);
  const report = run(2, '--out', 'out', '--resume');
  assert.deepEqual(report.resume, { completed: 0, reused: 1, failed: 1, error: 0, progress: 'progress.ndjson' });
  assert.equal(read('evaluations.txt'), 'normal\nfailed\nfailed\n');
  assert.deepEqual(finished(run(2, '--progress', 'ndjson')), { normal: 'completed', failed: 'failed' });
});
