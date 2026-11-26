const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');

const cli = path.resolve(__dirname, '../cli/ink-studio.js'), exec = promisify(execFile);

test('managed workers authenticate declared assets, cancel jobs, enforce budgets and verify shared artifacts', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-task-worker-'));
  const plan = path.join(root, 'plan.json'), out = path.join(root, 'worker'), source = path.join(root, 'fixture.js');
  const secret = randomBytes(24).toString('base64url');
  const env = { ...process.env, INK_TASK_WORKER_TOKEN: secret };
  fs.writeFileSync(source, `module.exports = ({ makeBuilder }) => ({
    id: 'worker-fixture', seed: 6, build(seed) {
      if (process.env.INK_TASK_WORKER_TOKEN) throw new Error('Token reached the task process');
      console.log('fixture started');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 650);
      const B = makeBuilder(seed, [0x182030, 0x8cc3b0]);
      B.iso(0, 0, 0, .5, B.P[1], 2.7);
      return B.finish({ cam: { target: [0,0,0], dist: 4, yaw: .3, pitch: .1, sway: 0 } });
    }
  });`);
  fs.writeFileSync(plan, JSON.stringify({ format: 'ink-studio/task-graph', version: 1, tasks: {
    image: { command: 'render', inputs: { scene: 'fixture.js' }, outputs: { png: 'frame.png' },
      args: [{ input: 'scene' }, '--w', '72', '--h', '48', '--out', { output: 'png' }] }
  } }));
  const worker = spawn(process.execPath, [cli, 'tasks', 'serve', plan, '--out', out],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(worker, 'close');
  const lines = createInterface({ input: worker.stdout });
  let errors = '';
  worker.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => {
    worker.kill('SIGTERM');
    await closed;
    lines.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [line] = await Promise.race([once(lines, 'line'), closed.then(() => { throw Error(errors || 'Worker exited'); })]);
  const { url, manifest } = JSON.parse(line);
  const api = (route, { method, body, auth = secret } = {}) => fetch(url + route, {
    method, headers: { authorization: 'Bearer ' + auth, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) })
  });
  async function json(route, config, status = 200) {
    const response = await api(route, config), value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  }
  const submit = budget => json('/v1/jobs', { method: 'POST', body: { manifest, budget } }, 202);
  const jobRoute = job => '/v1/jobs/' + job.id;
  async function wait(job, passes) {
    for (let i = 0; i < 200; i++) {
      const state = await json(jobRoute(job));
      if (passes(state)) return state;
      await delay(40);
    }
    assert.fail('Worker job did not reach expected state');
  }
  assert.equal((await api('/v1/manifest', { auth: 'incorrect' })).status, 401);
  await json('/v1/jobs', { method: 'POST', body: { manifest: 'stale' } }, 409);
  assert.deepEqual(Object.keys((await json('/v1/manifest')).manifest.assets), ['fixture.js']);

  const interrupted = await submit();
  await wait(interrupted, state => state.progress.some(row => row.event === 'task-started'));
  await json(jobRoute(interrupted), { method: 'DELETE' });
  const cancelled = await wait(interrupted, state => state.status === 'cancelled');
  assert.equal(cancelled.report.tasks[0].status, 'cancelled');
  assert.equal(cancelled.report.tasks[0].artifacts, undefined);

  const timeLimit = await wait(await submit({ taskMs: 1 }), state => state.status === 'failed');
  assert.equal(timeLimit.report.tasks[0].code, 'TASK_TIMEOUT');
  const sizeLimit = await wait(await submit({ outputBytes: 1 }), state => state.status === 'failed');
  assert.equal(sizeLimit.report.tasks[0].code, 'RESOURCE_LIMIT');

  const complete = await wait(await submit(), state => state.status === 'completed');
  assert.match(complete.logs[0].text, /fixture started/);
  const [first] = complete.report.tasks;
  assert.equal(first.status, 'completed');
  const reused = await wait(await submit(), state => state.status === 'completed');
  assert.equal(reused.report.tasks[0].status, 'reused');
  assert.equal(reused.report.tasks[0].key, first.key);
  const downloaded = path.join(root, 'downloaded.png');
  await exec(process.execPath, [cli, 'tasks', 'fetch', url, reused.id, 'image', 'png', '--out', downloaded], { env });
  assert.equal(fs.readFileSync(downloaded).subarray(1, 4).toString(), 'PNG');
  const cached = path.join(out, 'cache', 'tasks', 'image', first.key, 'artifacts', 'frame.png');
  fs.writeFileSync(cached, 'damaged');
  await json(jobRoute(reused) + '/artifacts/image/png', undefined, 400);
  const rebuilt = await wait(await submit(), state => state.status === 'completed');
  assert.equal(rebuilt.report.tasks[0].status, 'completed');
  assert.deepEqual(fs.readFileSync(cached), fs.readFileSync(downloaded));
  fs.appendFileSync(source, '\n// revised asset\n');
  const changed = await wait(await submit(), state => state.status === 'failed');
  assert.match(changed.error, /Registered assets changed/);
});
