const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

async function withChrome(directory, { chrome, hardware }, run) {
  const executable = chrome || process.env.INK_TEST_CHROME || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].find(file => fs.existsSync(file)) || 'google-chrome';
  const software = hardware ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  const child = spawn(executable, ['--headless', '--no-first-run', '--disable-background-networking',
    '--allow-file-access-from-files', '--force-color-profile=srgb', '--remote-debugging-pipe',
    '--user-data-dir=' + path.join(directory, 'profile'), ...software],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const input = child.stdio[3], output = child.stdio[4], pending = new Map();
  let id = 0, buffered = '', failure;
  function fail(error) {
    failure ??= error;
    for (const request of pending.values()) request.finish(failure);
  }
  child.on('error', error => fail(error.code === 'ENOENT'
    ? new Error('A Chrome or Chromium executable is required. Set --chrome or INK_TEST_CHROME.')
    : error));
  child.on('exit', (code, signal) => fail(new Error('Chrome exited during the canvas check (' + (signal ?? code) + ')')));
  input.on('error', fail);
  output.on('error', fail);
  output.setEncoding('utf8');
  output.on('data', chunk => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf('\0')) >= 0) {
      const message = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        const { id, error, result } = JSON.parse(message);
        pending.get(id)?.finish(error ? new Error(error.message) : null, result);
      } catch (error) {
        fail(error);
      }
    }
  });
  function request(method, params = {}, sessionId) {
    if (failure) return Promise.reject(failure);
    const key = ++id;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        pending.delete(key);
        clearTimeout(timeout);
        if (error) reject(new Error(method + ': ' + error.message));
        else resolve(result);
      };
      const timeout = setTimeout(() => finish(new Error('Chrome request timed out')), 20000);
      pending.set(key, { finish });
      input.write(JSON.stringify({ id: key, method, params, sessionId }) + '\0');
    });
  }
  try {
    const { targetId } = await request('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await request('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => request(method, params, sessionId);
    const evaluate = async expression => {
      const { result, exceptionDetails } = await send('Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    return await run({ send, evaluate });
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close').catch(() => {});
      child.kill();
      const deadline = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await closed; } finally { clearTimeout(deadline); }
    }
  }
}

module.exports = { withChrome };
