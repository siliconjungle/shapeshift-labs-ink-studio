const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const defaults = Object.freeze({
  jobMs: 300_000, taskMs: 120_000, heapMb: 512, logBytes: 512 * 1024,
  inputBytes: 64 * 1024 * 1024, outputBytes: 64 * 1024 * 1024, files: 4096
});
const maxima = {
  jobMs: 3_600_000, taskMs: 3_600_000, heapMb: 8192, logBytes: 8 * 1024 * 1024,
  inputBytes: 512 * 1024 * 1024, outputBytes: 512 * 1024 * 1024, files: 16_384
};

function budget(value = {}, ceiling = maxima, fallback = defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a task budget object');
  for (const [key, amount] of Object.entries(value)) {
    if (!Object.hasOwn(maxima, key) || !Number.isSafeInteger(amount) || amount < (key === 'heapMb' ? 32 : 1) || amount > ceiling[key])
      throw new RangeError('Invalid task budget limit ' + key);
  }
  return { ...fallback, ...value };
}

function taskError(code, message) {
  return Object.assign(new Error(message), { code });
}

function meter(bytes, files, label) {
  let size = 0, count = 0;
  return info => {
    size += info.isFile() ? info.size : 0;
    if (++count > files || size > bytes)
      throw taskError('RESOURCE_LIMIT', label + ' exceeds its byte or file budget');
  };
}

function scan(folder, measure) {
  const pending = [folder];
  while (pending.length) {
    const file = pending.pop(), info = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!info) continue;
    if (!info.isFile() && !info.isDirectory()) throw new TypeError('Task artifacts need ordinary files and directories');
    measure(info);
    if (info.isDirectory()) for (const name of fs.readdirSync(file)) pending.push(path.join(file, name));
  }
}

async function launch(entry, command, args, { cwd, artifacts, signal, limits, env, onOutput }) {
  signal.throwIfAborted();
  const detached = process.platform !== 'win32';
  const runtime = limits ? ['--max-old-space-size=' + limits.heapMb] : [];
  const child = spawn(process.execPath, [...runtime, entry, command, ...args], {
    cwd, env, detached, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise(resolve => {
    let error, bytes = 0;
    const log = [], logLimit = limits?.logBytes ?? maxima.logBytes;
    function stop(reason) {
      if (error) return;
      error = reason;
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (failure) {
        if (failure.code !== 'ESRCH') error = failure;
      }
    }
    const abort = () => stop(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const deadline = limits && setTimeout(() => stop(taskError('TASK_TIMEOUT', 'Task exceeded its time budget')), limits.taskMs);
    const storage = limits && setInterval(() => {
      try { scan(artifacts, meter(limits.outputBytes, limits.files, 'Task output')); }
      catch (failure) {
        if (failure.code !== 'ENOENT') stop(failure);
      }
    }, 200);
    function output(chunk) {
      if (error) return;
      const part = chunk.subarray(0, logLimit - bytes);
      if (part.length) {
        bytes += part.length;
        log.push(part);
        onOutput?.(part);
      }
      if (part.length < chunk.length) stop(taskError('RESOURCE_LIMIT', 'Task log exceeded its byte budget'));
    }
    child.stdout.on('data', output);
    child.stderr.on('data', output);
    child.once('error', failure => { error ??= failure; });
    child.once('close', (status, termination) => {
      clearTimeout(deadline);
      clearInterval(storage);
      signal.removeEventListener('abort', abort);
      resolve({ status, signal: termination, error, log: Buffer.concat(log, bytes) });
    });
  });
}

module.exports = { budget, meter, scan, launch, taskError };
