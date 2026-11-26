const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { isIP } = require('node:net');
const { once } = require('node:events');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const Graph = require('./task-graph.js');
const Process = require('./task-process.js');
const Artifact = require('./task-worker-artifact.js');

const tokenVariable = 'INK_TASK_WORKER_TOKEN';
const loopback = new Set(['127.0.0.1', '::1', '[::1]']);
const active = new Set(['queued', 'running', 'cancelling']);
const logLimit = 32 * 1024;
const jobPath = /^\/v1\/jobs\/([0-9a-f-]{36})(?:\/artifacts\/([a-z][a-z0-9_-]{0,79})\/([a-z][a-z0-9_-]{0,79}))?$/;
const hash = value => createHash('sha256').update(value).digest();

function token() {
  const secret = process.env[tokenVariable];
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{24,256}$/.test(secret))
    throw new Error('Set ' + tokenVariable + ' to a private token of 24–256 URL-safe characters');
  return secret;
}

async function readJson(stream, limit) {
  let bytes = 0;
  const chunks = [];
  const input = stream.iterator?.({ destroyOnReturn: false }) ?? stream;
  for await (const value of input) {
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > limit) {
      stream.resume?.();
      throw Process.taskError('PAYLOAD_LIMIT', 'Worker message exceeds its byte limit');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString());
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function publicJob(job) {
  return { id: job.id, status: job.status, manifest: job.manifest, limits: job.limits,
    progress: job.progress, logs: job.logs.map(([task, chunk]) => ({ task, text: chunk.toString() })),
    ...(job.error && { error: job.error }),
    ...(job.report && { report: { ...job.report, tasks: job.report.tasks.map(({ outputs, log, ...row }) => row) } }) };
}

function notify(job, event) {
  job.progress.push({ sequence: job.progress.length + 1, ...event });
}

function cancellation() {
  return Process.taskError('CANCELLED', 'Worker job was cancelled');
}

async function serve(plan, directory, { kit, entry, limits, host, port, tls, signal, ready }) {
  if (!isIP(host) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('Worker needs a literal IP address and a port from 0 to 65535');
  if (!tls && !loopback.has(host)) throw new Error('Non-loopback task workers need a TLS certificate and key');
  const authorization = hash('Bearer ' + token());
  const registered = Graph.manifest(plan, limits), jobs = new Map();
  const directoryPath = path.resolve(directory), cache = path.join(directoryPath, 'cache');
  for (const name of Object.keys(registered.assets)) {
    const relative = path.relative(path.resolve(plan.root, name), directoryPath);
    if (relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
      throw new Error('Keep the worker cache outside declared asset paths');
  }
  const env = { ...process.env, INK_STUDIO_PORTABLE_SHOT: '1' };
  delete env[tokenVariable];
  let executing, closing = false;

  function cancel(job) {
    if (job.status === 'queued') {
      job.status = 'cancelled';
      notify(job, { event: 'job-finished', status: job.status });
    } else if (job.status === 'running') {
      job.status = 'cancelling';
      job.controller.abort(cancellation());
    }
  }

  async function run(job) {
    job.status = 'running';
    notify(job, { event: 'job-started' });
    try {
      if (Graph.manifest(plan, job.limits).id !== registered.id) throw new Error('Registered assets changed. Restart the worker with the updated recipe.');
      job.report = await Graph.run(plan, cache, {
        kit, entry, resume: true, limits: job.limits, signal: job.controller.signal, env,
        progress: event => notify(job, event),
        output(task, chunk) {
          const part = chunk.subarray(0, logLimit - job.logged);
          if (part.length) {
            job.logged += part.length;
            const last = job.logs.at(-1);
            if (last?.[0] === task) last[1] = Buffer.concat([last[1], part]);
            else job.logs.push([task, part]);
          }
        }
      });
      job.status = job.report.stop?.code === 'JOB_TIMEOUT' ? 'timed-out' :
        job.report.stop ? 'cancelled' : job.report.passed ? 'completed' : 'failed';
    } catch (error) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = error.message;
    } finally {
      notify(job, { event: 'job-finished', status: job.status });
    }
  }

  function pump() {
    if (executing || closing) return;
    const next = [...jobs.values()].find(job => job.status === 'queued');
    if (!next) return;
    executing = run(next).finally(() => {
      executing = undefined;
      setImmediate(pump);
    });
  }

  function submit(body, response) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['manifest', 'budget'].includes(key)))
      return send(response, 400, { error: 'Expected a manifest ID and optional task budget' });
    if (body.manifest !== registered.id) return send(response, 409, { error: 'Declared asset or recipe hashes differ from the worker registration' });
    if (closing || [...jobs.values()].filter(job => active.has(job.status)).length >= 9)
      return send(response, 429, { error: 'Task worker queue is full' });
    const requested = Process.budget(body.budget, limits, limits);
    if (jobs.size >= 64) jobs.delete([...jobs.values()].find(job => !active.has(job.status)).id);
    const job = { id: randomUUID(), manifest: registered.id, limits: requested, status: 'queued',
      controller: new AbortController(), progress: [], logs: [], logged: 0 };
    jobs.set(job.id, job);
    notify(job, { event: 'job-queued' });
    setImmediate(pump);
    send(response, 202, publicJob(job));
  }

  async function handle(request, response) {
    if (!timingSafeEqual(hash(request.headers.authorization ?? ''), authorization)) {
      request.resume();
      return send(response, 401, { error: 'Expected a valid task worker token' });
    }
    try {
      const url = new URL(request.url, 'http://localhost'), method = request.method;
      if (method === 'GET' && url.pathname === '/v1/manifest')
        return send(response, 200, { format: 'ink-studio/task-worker', version: 1, manifest: registered, limits });
      if (method === 'POST' && url.pathname === '/v1/jobs')
        return submit(await readJson(request, 8192), response);
      const match = jobPath.exec(url.pathname), job = match && jobs.get(match[1]);
      if (!job) return send(response, 404, { error: 'Unknown worker job or route' });
      if (!match[2]) {
        if (method === 'DELETE') cancel(job);
        if (method === 'GET' || method === 'DELETE') return send(response, 200, publicJob(job));
      }
      if (method !== 'GET' || !match[2]) return send(response, 404, { error: 'Unknown worker job route' });
      const [, , task, artifact] = match;
      const row = job.report?.tasks.find(row => row.id === task && Object.hasOwn(row.outputs ?? {}, artifact));
      if (!row) return send(response, 404, { error: 'Job artifact is unavailable' });
      const source = row.outputs[artifact], digest = row.artifacts[artifact], relative = url.searchParams.get('file');
      if (relative === null) return send(response, 200, Artifact.inventory(source, digest, row.key, job.limits));
      await Artifact.stream(response, source, relative, digest, job.limits);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) send(response, error.code === 'PAYLOAD_LIMIT' ? 413 : 400, { error: error.message });
      else if (!response.writableEnded) response.destroy();
    }
  }

  const options = { requestTimeout: 10_000, headersTimeout: 5000 };
  const server = tls ? https.createServer({ ...options, ...tls }, handle) : http.createServer(options, handle);
  server.maxConnections = 32;
  server.setTimeout(30_000);
  const closed = new Promise(resolve => server.once('close', resolve));
  function stop() {
    closing = true;
    for (const job of jobs.values()) cancel(job);
    server.close();
    server.closeAllConnections?.();
  }
  try {
    server.listen(port, host);
    await once(server, 'listening');
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    else ready({ event: 'worker-ready', url: (tls ? 'https://' : 'http://') +
      (host.includes(':') ? '[' + host + ']' : host) + ':' + server.address().port, manifest: registered.id });
    await closed;
    await executing;
  } finally {
    signal.removeEventListener('abort', stop);
    if (server.listening) stop();
  }
}

module.exports = { serve, token, loopback, active, readJson };
