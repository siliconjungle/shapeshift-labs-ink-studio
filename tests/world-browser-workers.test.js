const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const studio = require('..');
const { KIT: { world: { runtime } } } = studio.load();

test('an async batch keeps the committed query readable and accepts commands for a later tick', async () => {
  const manifest = { dt: 0.1, systems: {
    basin: { kind: 'water', config: { width: 1, height: 1, rain: 0.2 } }
  } };
  let reject;
  const wait = new Promise((_, fail) => { reject = fail; });
  let shouldWait = true, kernel;
  const workerPool = { async: true, size: 1, async solve(world, jobs) {
    if (shouldWait) await wait;
    kernel ??= runtime.partitionKernel(world);
    return { workers: 1, results: new Map(jobs.map(job => [job.name, kernel(job)])) };
  } };
  const run = runtime.create(manifest, { workerPool });
  const initial = run.checkpoint(), query = run.query();
  const pending = run.stepAsync();
  assert.equal(run.query(), query);
  assert.equal(run.checkpoint(), initial);
  assert.equal(run.fork().view().tick, 0);
  assert.throws(() => run.advance(2), /already in progress/);
  await assert.rejects(run.stepAsync(), /already in progress/);
  const note = { action: 'world/event', args: { kind: 'marker' } };
  assert.throws(() => run.schedule([{ ...note, tick: 1 }]), /command tick/);
  run.schedule([{ ...note, tick: 2 }]);
  const savedWhilePending = run.checkpoint();

  reject(Error('lost lane'));
  await assert.rejects(pending, /lost lane/);
  assert.equal(run.checkpoint(), savedWhilePending);
  assert.equal(run.partitions().batches, 0);

  shouldWait = false;
  const seen = [];
  await run.advanceAsync(3, { onTick: view => seen.push(view.tick) });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(run.history.map(row => [row.kind, row.tick]), [['marker', 2]]);
  assert.equal(run.partitions().systems.basin, 3);
  assert.notEqual(run.query(), query);
  assert.throws(() => run.step(), /Use stepAsync or advanceAsync/);
  const restored = await runtime.replayAsync(run.recording(), { workerPool });
  assert.deepEqual(restored.checkpoint(), run.checkpoint());
});

const plugin = `
export let mainSteps = 0;
export default {oscillator: config => ({
  partitionStep: true, combinational: true,
  initial: () => ({sum: 0, steps: 0, seconds: 0}),
  inputs: {energy: 'number'}, outputs: {value: 'number'},
  step(state, ctx) {
    if (typeof document !== 'undefined') mainSteps++;
    else if (config.spin) {
      const limit = performance.now() + config.spin;
      while (performance.now() < limit) {}
    }
    if (config.fail === ctx.tick) throw Error('fault from custom solver');
    if (ctx.substep === 1 || ctx.substep === undefined) ctx.emit('pulse', {at: ctx.time});
    return {sum: state.sum + ctx.input.energy + ctx.random('pulse'), steps: state.steps + 1,
      seconds: state.seconds + ctx.dt};
  },
  output: state => ({value: state.sum})
})};`;

const page = `<!doctype html><script type="module">
import {KIT} from './kit.mjs';
import {createBrowserSimulationWorkers} from './webgl.mjs';
import {mainSteps} from './plugin.mjs';
const runtime = KIT.world.runtime;
const check = (value, message) => { if (!value) throw Error(message); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
async function exercise() {
  const options = {bundle:'./kit.mjs', modules:['./plugin.mjs'], timeoutMs:5000};
  const pool = await createBrowserSimulationWorkers(2, options);
  try {
    const systems = {
      driver: {kind:'oscillator', config:{spin:80}},
      peer: {kind:'oscillator'},
      fast: {kind:'oscillator', schedule:{substeps:3}},
      slow: {kind:'oscillator', schedule:{every:4}}
    };
    const source = {seed:13,dt:.075,causality:true,systems,connections:[
      {from:'driver/value',to:'fast/energy'},
      {from:'fast/value',to:'slow/energy',sample:'average',delay:1}
    ]};
    const run = runtime.create(source, {workerPool:pool});
    let paintTick;
    const paint = new Promise(resolve => requestAnimationFrame(() => {paintTick=run.view().tick; resolve();}));
    const first = run.stepAsync();
    await Promise.all([first,paint]);
    check(paintTick===0,'The page did not paint while committed tick 0 was visible');
    await run.advanceAsync(8);
    check(mainSteps===0,'A custom step was executed in the browser host');
    check(same(run.partitions().systems,{driver:8,fast:24,peer:8,slow:2}), 'Incorrect worker cadences');
    check(run.partitions().peakWorkers===2,'Did not dispatch two independent lanes');
    check(Math.abs(run.view().states.fast.seconds-.6)<1e-10,'Fast solver elapsed time');
    check(Math.abs(run.view().states.slow.seconds-.6)<1e-10,'Slow solver elapsed time');
    const host = runtime.create(source, {implementations:pool.implementations});
    host.advance(8);
    check(same(host.checkpoint(),run.checkpoint()),'Browser worker checkpoint differs from host');
    const restored = await runtime.replayAsync(run.recording(),{workerPool:pool});
    check(same(restored.checkpoint(),run.checkpoint()),'Browser worker replay differs');

    const fault = runtime.create({systems:{fault:{kind:'oscillator',config:{fail:2}}}},{workerPool:pool});
    await fault.stepAsync();
    const boundary = fault.checkpoint();
    let signal;
    try { await fault.stepAsync(); } catch(error) { signal=error.message; }
    check(signal==='fault from custom solver'&&fault.checkpoint()===boundary,'Worker failure committed a partial tick');

    const healthy = runtime.create(source,{workerPool:pool});
    const final = healthy.stepAsync();
    await Promise.resolve();
    pool.close();
    try { await final; throw Error('Pool accepted work after close'); }
    catch(error) { check(error.message.includes('closed')&&healthy.view().tick===0,'Close committed a partial tick'); }
  } finally { pool.close(); }
}
let result='PASS';
try { await exercise(); } catch(error) { result=error.stack || error.message; }
await fetch('/result',{method:'POST',body:result});
</script>`;

test('browser workers run shared modules at independent rates and leave animation frames free',
  { skip: !process.env.INK_TEST_CHROME, timeout: 30000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-browser-worker-'));
    const root = path.resolve(__dirname, '..');
    const bundle = studio.bundle({ format: 'module' });
    let finish;
    const result = new Promise(resolve => { finish = resolve; });
    const server = createServer((req, res) => {
      if (req.url === '/result' && req.method === 'POST') {
        req.setEncoding('utf8');
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => { res.end('ok'); finish(body); });
        return;
      }
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(page);
        return;
      }
      res.setHeader('Content-Type', 'text/javascript');
      if (req.url === '/kit.mjs') { res.end(bundle); return; }
      if (req.url === '/plugin.mjs') { res.end(plugin); return; }
      const name = path.join(root, req.url);
      if ((req.url === '/webgl.mjs' || name.startsWith(root + '/src/')) && fs.existsSync(name) && fs.statSync(name).isFile()) {
        res.end(fs.readFileSync(name));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const child = spawn(process.env.INK_TEST_CHROME, ['--headless=new', '--no-first-run', '--disable-background-networking',
      '--user-data-dir=' + directory, 'http://127.0.0.1:' + server.address().port + '/'], { stdio: 'ignore' });
    child.once('error', error => finish(error.message));
    child.once('exit', code => finish('Chrome exited before verification (' + code + ')'));
    t.after(async () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      server.closeAllConnections();
      server.close();
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 75 });
    });
    assert.equal(await result, 'PASS');
  });
