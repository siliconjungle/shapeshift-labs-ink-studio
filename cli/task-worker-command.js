const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const Graph = require('./task-graph.js');
const Process = require('./task-process.js');
const Worker = require('./task-worker.js');
const Artifact = require('./task-worker-artifact.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const print = value => console.log(JSON.stringify(value, null, 2));
const slug = /^[a-z][a-z0-9_-]{0,79}$/;
const jobId = /^[0-9a-f-]{36}$/;

function options(opt, allowed, switches = []) {
  if (Object.entries(opt).some(([key, value]) => !allowed.includes(key) ||
      (switches.includes(key) ? value !== true : typeof value !== 'string' || !value)))
    throw new TypeError('Invalid tasks command option');
}

async function withSignals(work) {
  const controller = new AbortController();
  const stop = () => controller.abort(Process.taskError('CANCELLED', 'Task command was interrupted'));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try { return await work(controller.signal); }
  finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

function connect(endpoint) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      url.protocol !== 'https:' && !(url.protocol === 'http:' && Worker.loopback.has(url.hostname)))
    throw new TypeError('Use a loopback HTTP task worker URL or an HTTPS task worker URL');
  const authorization = 'Bearer ' + Worker.token();
  async function request(route, method, data) {
    const response = await fetch(new URL(route, url), { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { authorization, ...(data && { 'Content-Type': 'application/json' }) },
      ...(data && { body: JSON.stringify(data) }) });
    if (!response.ok) {
      const failure = await Worker.readJson(response.body, 16 * 1024);
      throw new Error('Task worker HTTP ' + response.status + ': ' + failure.error);
    }
    return response;
  }
  return {
    async json(route, method, data) {
      const response = await request(route, method, data);
      return Worker.readJson(response.body, 8 * 1024 * 1024);
    },
    async download(route, relative, file, bytes) {
      const query = new URLSearchParams({ file: relative });
      const response = await request(route + '?' + query);
      if (response.headers.get('content-length') !== String(bytes)) {
        await response.body.cancel();
        throw new Error('Worker artifact file length differs from its inventory');
      }
      let received = 0;
      const measure = new Transform({ transform(chunk, _, next) {
        received += chunk.length;
        next(received > bytes ? new Error('Worker artifact exceeded its declared length') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), measure, fs.createWriteStream(file, { flags: 'wx' }));
      if (received !== bytes) throw new Error('Incomplete worker artifact file');
    }
  };
}

async function command([mode, target, detail, task, artifact, ...extra], opt, { load, entry }) {
  if (!target || extra.length) throw new TypeError('Use tasks plan, run, serve, manifest, submit, status, cancel or fetch');
  switch (mode) {
    case 'plan': {
      options(opt, []);
      if (detail) throw new TypeError('Use tasks plan <plan.json>');
      const plan = Graph.prepare(target);
      print(plan.order.map(id => ({ id, dependencies: plan.tasks.get(id).dependencies })));
      return;
    }
    case 'run': {
      options(opt, ['out', 'resume', 'budget', 'progress'], ['resume', 'progress']);
      if (detail || !opt.out) throw new TypeError('Use tasks run <plan.json> --out directory [--resume --budget limits.json --progress]');
      const directory = path.resolve(opt.out), plan = Graph.prepare(target);
      const limits = opt.budget && Process.budget(read(opt.budget));
      const report = await withSignals(signal => Graph.run(plan, directory, {
        resume: opt.resume === true, kit: load(), entry, signal, limits,
        progress: opt.progress && (event => console.error(JSON.stringify(event)))
      }));
      console.log('wrote', path.join(directory, 'report.json'));
      if (!report.passed) process.exitCode = report.stop?.code === 'CANCELLED' ? 130 : 2;
      return;
    }
    case 'serve': {
      options(opt, ['out', 'host', 'port', 'budget', 'tls-cert', 'tls-key']);
      if (detail || !opt.out || Boolean(opt['tls-cert']) !== Boolean(opt['tls-key']))
        throw new TypeError('Use tasks serve <plan.json> --out directory [--host IP --port N --budget limits.json --tls-cert CERT --tls-key KEY]');
      const limits = Process.budget(opt.budget ? read(opt.budget) : undefined);
      const tls = opt['tls-cert'] && { cert: fs.readFileSync(opt['tls-cert']), key: fs.readFileSync(opt['tls-key']) };
      return withSignals(signal => Worker.serve(Graph.prepare(target), opt.out, {
        kit: require('../index.js').load(), entry, limits, host: opt.host ?? '127.0.0.1', port: Number(opt.port ?? 0), tls,
        signal, ready: event => console.log(JSON.stringify(event))
      }));
    }
    case 'manifest': {
      options(opt, []);
      if (detail) throw new TypeError('Use tasks manifest <worker-url>');
      print(await connect(target).json('/v1/manifest'));
      return;
    }
    case 'submit': {
      options(opt, ['budget', 'wait'], ['wait']);
      if (!detail || task) throw new TypeError('Use tasks submit <worker-url> <plan.json> [--budget limits.json --wait]');
      const client = connect(target), remote = await client.json('/v1/manifest');
      const limits = Process.budget(remote.limits);
      const manifest = Graph.manifest(Graph.prepare(detail), limits);
      const budget = opt.budget && read(opt.budget);
      if (budget) Process.budget(budget, limits, limits);
      let job = await client.json('/v1/jobs', 'POST', { manifest: manifest.id, budget });
      if (opt.wait) {
        console.error('Worker job ' + job.id);
        while (Worker.active.has(job.status)) {
          await delay(300);
          job = await client.json('/v1/jobs/' + job.id);
        }
        if (job.status !== 'completed') process.exitCode = 2;
      }
      print(job);
      return;
    }
    case 'status':
    case 'cancel': {
      options(opt, []);
      if (!jobId.test(detail) || task) throw new TypeError('Use tasks ' + mode + ' <worker-url> <job-id>');
      print(await connect(target).json('/v1/jobs/' + detail, mode === 'cancel' ? 'DELETE' : 'GET'));
      return;
    }
    case 'fetch': {
      options(opt, ['out']);
      if (!jobId.test(detail) || !task || !artifact || !slug.test(task) || !slug.test(artifact) || !opt.out)
        throw new TypeError('Use tasks fetch <worker-url> <job-id> <task-id> <artifact-id> --out path');
      const client = connect(target), route = '/v1/jobs/' + detail;
      const job = await client.json(route), row = job.report?.tasks.find(row => row.id === task);
      if (!Object.hasOwn(row?.artifacts ?? {}, artifact)) throw new Error('Job artifact has no verified receipt');
      const source = route + '/artifacts/' + task + '/' + artifact;
      const metadata = await client.json(source);
      const destination = path.resolve(opt.out);
      await Artifact.receive({ metadata, destination, limits: Process.budget(job.limits),
        expected: { key: row.key, digest: row.artifacts[artifact] },
        download: (relative, file, bytes) => client.download(source, relative, file, bytes) });
      console.log('wrote', destination);
      return;
    }
    default: throw new TypeError('Use tasks plan, run, serve, manifest, submit, status, cancel or fetch');
  }
}

module.exports = { command };
