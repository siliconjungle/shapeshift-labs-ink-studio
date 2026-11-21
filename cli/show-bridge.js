const http = require('node:http');
const dgram = require('node:dgram');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { encodeArtDmx, encodeSacn, decodeArtTimeCode, encodeOsc, decodeOsc } = require('./show-protocols');

const root = path.resolve(__dirname, '..');
const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const loopback = '127.0.0.1';
const maxBody = 12000;
const outputPort = { artnet: 6454, sacn: 5568 };
const mime = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript' };

function listen(socket, argument, bind, host = loopback) {
  return new Promise((resolve, reject) => {
    function ready() { socket.off('error', reject); resolve(); }
    socket.once('error', reject);
    socket.once('listening', ready);
    bind.call(socket, argument, host);
  });
}

async function body(request) {
  const parts = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > maxBody) throw new RangeError('Stage request is too large');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts, length).toString('utf8'));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(payload));
}

function asset(url) {
  if (url === '/examples/live-show/') return '/examples/live-show/index.html';
  if (/^\/examples\/live-show\/[a-z][a-z0-9-]*\.(html|mjs|css)$/.test(url) ||
      /^\/src\/show\/[a-z][a-z0-9-]*\.mjs$/.test(url) || url === '/show-control.mjs') return url;
  return null;
}

async function createShowBridge({ port = 8181, oscInput = 9002, artTimecodeInput, inputHost = loopback, dmx, oscOutput, leaseMs = 1200 } = {}) {
  if (!net.isIPv4(inputHost) || !int(port, 0, 65535) || !int(oscInput, 0, 65535) ||
      artTimecodeInput !== undefined && !int(artTimecodeInput, 0, 65535) || !int(leaseMs, 250, 5000))
    throw new RangeError('Invalid show bridge ports or output lease');
  if (dmx && (!Object.hasOwn(outputPort, dmx.protocol) || !net.isIPv4(dmx.host) ||
      !int(dmx.port ?? outputPort[dmx.protocol], 1, 65535) ||
      !int(dmx.universe, dmx.protocol === 'artnet' ? 0 : 1, dmx.protocol === 'artnet' ? 32767 : 63999)))
    throw new RangeError('DMX output needs a protocol, IPv4 destination and valid universe');
  if (oscOutput && (!net.isIPv4(oscOutput.host) || !int(oscOutput.port, 1, 65535)))
    throw new RangeError('OSC output needs an IPv4 destination and port');

  const { readTimecode } = await import('../src/show/clocks.mjs');
  const key = randomBytes(24).toString('hex'), cid = randomBytes(16), sockets = [];
  const state = { link: null, timecode: null, osc: null, outputError: null };
  const input = dgram.createSocket('udp4');
  const output = dmx || oscOutput ? dgram.createSocket('udp4') : null;
  const timecodeInput = artTimecodeInput === undefined ? null : dgram.createSocket('udp4');
  sockets.push(input, ...[output, timecodeInput].filter(Boolean));
  let next = new Uint8Array(512), updated = false, active = false, expires = 0, sequence = 0, last = -Infinity;
  let ticker, closed, closing = false, lease = null;
  const pending = new Set();

  function send(packet, host, port) {
    if (!output) return Promise.resolve();
    const task = new Promise(resolve => output.send(packet, port, host, error => {
      if (error) state.outputError = error.message;
      resolve();
    }));
    pending.add(task);
    void task.finally(() => pending.delete(task));
    return task;
  }

  function transmit(channels, terminated = false) {
    const { protocol, host, universe } = dmx;
    sequence = protocol === 'artnet' ? sequence % 255 + 1 : (sequence + 1) & 255;
    const fields = { universe, sequence, channels, cid, terminated };
    const packet = protocol === 'artnet' ? encodeArtDmx(fields) : encodeSacn(fields);
    return send(packet, host, dmx.port ?? outputPort[protocol]);
  }

  function stopOutput() {
    expires = 0;
    lease = null;
    if (!active) return;
    active = false;
    const zeros = new Uint8Array(512);
    const count = dmx.protocol === 'sacn' ? 3 : 1;
    for (let i = 0; i < count; i++) void transmit(zeros, true);
  }

  function tick() {
    const now = performance.now();
    if (now >= expires) { stopOutput(); return; }
    if (updated || now - last >= 700) {
      updated = false;
      active = true;
      last = now;
      void transmit(next);
    }
  }

  input.on('message', (packet, remote) => {
    try {
      const { address, args } = decodeOsc(packet), sentAt = Date.now();
      if (address === '/ink/link' && remote.address === loopback) {
        const [bpm, beat, playing, peers] = args;
        if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 && Number.isFinite(beat) &&
            (typeof playing === 'boolean' || playing === 0 || playing === 1) && int(peers, 0, 65535))
          state.link = { bpm, beat, playing: Boolean(playing), peers, sentAt };
      } else {
        state.osc = { address, args, sentAt };
      }
    } catch { /* Ignore other UDP traffic on the configured OSC port. */ }
  });
  timecodeInput?.on('message', packet => {
    try {
      const code = decodeArtTimeCode(packet);
      if (code) state.timecode = { ...readTimecode(code), source: 'ArtTimeCode', sentAt: Date.now() };
    } catch { /* Ignore invalid timecode labels. */ }
  });

  const server = http.createServer(async (request, response) => {
    if (closing) return sendJson(response, 503, { error: 'Show bridge is closing' });
    const assigned = server.address().port, host = request.headers.host, origin = request.headers.origin;
    const allowed = [loopback + ':' + assigned, 'localhost:' + assigned];
    if (!allowed.includes(host) || origin && origin !== 'http://' + host ||
        request.headers['sec-fetch-site'] === 'cross-site')
      return sendJson(response, 403, { error: 'Show bridge only accepts its local origin' });
    const url = request.url.split('?')[0];
    try {
      if (request.method === 'GET' && url === '/') {
        response.writeHead(302, { Location: '/examples/live-show/' });
        response.end();
        return;
      }
      if (request.method === 'GET' && url === '/show/session')
        return sendJson(response, 200, { key, dmx: dmx?.protocol ?? null, universe: dmx?.universe ?? null,
          oscOutput: Boolean(oscOutput), oscInput: input.address().port });
      if (request.method === 'GET' && url === '/show/state')
        return sendJson(response, 200, { ...state, armed: Boolean(dmx && expires > performance.now()) });
      if (request.method === 'POST' && (url === '/show/dmx' || url === '/show/osc')) {
        if (request.headers['x-ink-show'] !== key || !request.headers['content-type']?.startsWith('application/json'))
          return sendJson(response, 403, { error: 'Stage requests need the current show session key' });
        if (url === '/show/dmx') {
          const values = await body(request);
          if (closing) return sendJson(response, 503, { error: 'Show bridge is closing' });
          if (values?.action === 'disarm') stopOutput();
          else if (values?.action === 'arm') {
            if (!dmx) throw new Error('DMX output has no configured destination');
            stopOutput();
            next = new Uint8Array(512);
            lease = randomBytes(16).toString('hex');
            updated = true;
            expires = performance.now() + leaseMs;
            return sendJson(response, 200, { lease });
          } else {
            if (!lease || values?.lease !== lease || expires <= performance.now())
              return sendJson(response, 409, { error: 'Stage output must be armed before sending DMX' });
            if (!Array.isArray(values.channels) || values.channels.length !== 512 || !values.channels.every(n => int(n, 0, 255)))
              throw new RangeError('DMX output requires 512 byte-valued channels');
            next = Uint8Array.from(values.channels);
            updated = true;
            expires = performance.now() + leaseMs;
          }
        } else {
          if (!oscOutput) throw new Error('OSC output has no configured destination');
          const { address, args } = await body(request);
          if (closing) return sendJson(response, 503, { error: 'Show bridge is closing' });
          await send(encodeOsc(address, args), oscOutput.host, oscOutput.port);
        }
        return sendJson(response, 200, { ok: true });
      }
      const file = request.method === 'GET' && asset(url);
      if (file) {
        const data = await fs.readFile(path.join(root, file.slice(1)));
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff' });
        response.end(data);
        return;
      }
      sendJson(response, 404, { error: 'Unknown show bridge route' });
    } catch (error) {
      if (!response.destroyed) sendJson(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
    }
  });
  server.requestTimeout = 5000;
  async function shutdown() {
    closing = true;
    clearInterval(ticker);
    stopOutput();
    await Promise.allSettled([...pending]);
    const stopped = new Promise(resolve => server.close(() => resolve()));
    server.closeAllConnections?.();
    for (const socket of sockets) {
      try { socket.close(); } catch { /* Socket did not reach its bound state. */ }
    }
    await stopped;
  }
  try {
    await listen(input, oscInput, input.bind, inputHost);
    if (timecodeInput) await listen(timecodeInput, artTimecodeInput, timecodeInput.bind, inputHost);
    await listen(server, port, server.listen);
    for (const socket of sockets) socket.on('error', error => { state.outputError = error.message; });
    if (dmx) ticker = setInterval(tick, 25);
    return { url: 'http://' + loopback + ':' + server.address().port,
      oscPort: input.address().port, artTimecodePort: timecodeInput?.address().port,
      close() { return closed ??= shutdown(); } };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

module.exports = { createShowBridge };
