const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');

async function demo() {
  if (process.argv.length !== 3) throw new Error('Supply a new output directory for the task worker demo');
  const out = path.resolve(process.argv[2]), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const plan = path.join(__dirname, 'task-graph-attractor.json');
  fs.mkdirSync(out);
  const file = name => path.join(out, name);
  const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data, null, 2) + '\n');
  const env = { ...process.env, INK_TASK_WORKER_TOKEN: randomBytes(32).toString('base64url') };
  const worker = spawn(process.execPath, [cli, 'tasks', 'serve', plan, '--out', file('worker')],
    { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = once(worker, 'close');
  const lines = createInterface({ input: worker.stdout });
  const exec = promisify(execFile);
  try {
    const [line] = await Promise.race([once(lines, 'line'), closed.then(() => { throw new Error('Task worker stopped'); })]);
    const { url } = JSON.parse(line);
    const run = async (mode, ...args) => (await exec(process.execPath, [cli, 'tasks', mode, url, ...args], { env })).stdout;
    const json = async (...args) => JSON.parse(await run(...args));
    async function wait(id, done) {
      for (let i = 0; i < 160; i++) {
        const status = await json('status', id);
        if (done(status)) return status;
        await delay(75);
      }
      throw new Error('Task worker did not reach the expected status');
    }
    save('manifest.json', await json('manifest'));
    const first = await json('submit', plan);
    await wait(first.id, status => status.progress.some(row => row.event === 'task-started'));
    await json('cancel', first.id);
    save('cancelled.json', await wait(first.id, status => status.status === 'cancelled'));
    console.log('Cancelled a running sweep.');

    save('budget.json', { taskMs: 1 });
    const limited = await json('submit', plan, '--budget', file('budget.json'));
    const exhausted = await wait(limited.id, status => status.status === 'failed');
    assert.equal(exhausted.report.tasks[0].code, 'TASK_TIMEOUT');
    save('budget-exhausted.json', exhausted);
    console.log('Enforced the task deadline.');

    const cold = await json('submit', plan, '--wait');
    const warm = await json('submit', plan, '--wait');
    assert.deepEqual(cold.report.tasks.map(row => row.status), ['completed', 'completed', 'completed']);
    assert.deepEqual(warm.report.tasks.map(row => row.status), ['reused', 'reused', 'reused']);
    assert.deepEqual(cold.report.tasks.map(row => row.key), warm.report.tasks.map(row => row.key));
    save('first-run.json', cold);
    save('reused.json', warm);
    console.log('The second job reused all three verified receipts.');

    await run('fetch', warm.id, 'explore', 'review', '--out', file('sweep'));
    await run('fetch', warm.id, 'reproduce', 'review', '--out', file('replay'));
    assert.deepEqual(fs.readFileSync(file('sweep/cases/005.png')), fs.readFileSync(file('replay/cases/001.png')));
    console.log('Downloaded and verified the sweep and its byte-identical selected frame.');
  } finally {
    worker.kill('SIGTERM');
    await closed;
    lines.close();
  }
}

demo().catch(error => { console.error(error.message); process.exitCode = 1; });
