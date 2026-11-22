const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { EventEmitter, once } = require('node:events');
const { int, loopback } = require('./patch-show-config.js');

const leaseMs = 2000;
const assets = new Map([
  ['/', ['patch-projector.html', 'text/html; charset=utf-8']],
  ['/patch-projector.mjs', ['patch-projector.mjs', 'text/javascript; charset=utf-8']],
  ['/projection.mjs', ['projection.mjs', 'text/javascript; charset=utf-8']]
]);

function send(response, status, type, body, fields = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    'Content-Type': type, ...fields });
  response.end(body);
}

async function readMidi(request) {
  const pieces = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024) throw new RangeError('MIDI request exceeds 1 KiB');
    pieces.push(chunk);
  }
  return JSON.parse(Buffer.concat(pieces, length).toString('utf8'));
}

async function openProjector(config, midi, { afterFrame, afterAttach, onMidi }) {
  const key = randomBytes(24).toString('hex'), stream = randomUUID(), connections = new EventEmitter();
  let client, latest, serial = 0, ended = false, failure, closed;
  const isConnected = () => client && performance.now() - client.seen < leaseMs;

  function frame(request, response, url, snapshot = false) {
    const id = request.headers['x-ink-client'], last = snapshot ? '0' : url.searchParams.get('after');
    if (typeof id !== 'string' || !/^[a-zA-Z\d-]{1,64}$/.test(id) || last === null || !/^\d+$/.test(last))
      return send(response, 400, 'text/plain', 'Expected a projector client and frame sequence');
    if (isConnected() && client.id !== id) return send(response, 409, 'text/plain', 'A projector is already connected');
    const after = Number(last);
    if ((!client || client.id !== id) && after !== 0 || client?.id === id && !int(after, 0, client.offered))
      return send(response, 400, 'text/plain', 'Unknown projector frame sequence');
    const attached = !isConnected(), replaced = client?.id !== id;
    if (replaced) client = { id, ack: 0, offered: 0 };
    if (snapshot || attached) client.ack = 0;
    client.seen = performance.now();
    if (attached) {
      afterAttach(replaced);
      connections.emit('attach');
    }
    if (!snapshot && !attached && after > client.ack) {
      afterFrame(client.ack ? after - client.ack - 1 : 0);
      client.ack = after;
    }
    const headers = { 'X-Ink-Stream': stream, 'X-Ink-State': snapshot || attached ? 'snapshot' : 'live' };
    if (!latest || latest.serial <= after)
      return send(response, 204, 'text/plain', undefined, { ...headers, ...(ended && { 'X-Ink-Ended': 1 }) });
    client.offered = latest.serial;
    return send(response, 200, 'application/octet-stream', latest.bytes, { ...headers, 'Content-Length': latest.bytes.length,
      'X-Ink-Serial': latest.serial, 'X-Ink-Frame': latest.index, 'X-Ink-Width': latest.width, 'X-Ink-Height': latest.height });
  }

  const server = http.createServer(async (request, response) => {
    const port = server.address()?.port, host = request.headers.host, origin = request.headers.origin;
    if (![loopback + ':' + port, 'localhost:' + port].includes(host) || origin && origin !== 'http://' + host ||
        request.headers['sec-fetch-site'] === 'cross-site')
      return send(response, 403, 'text/plain', 'Projector only accepts its local origin');
    try {
      const url = new URL(request.url, 'http://' + host), route = url.pathname;
      if (request.method === 'GET' && assets.has(route)) {
        const [file, type] = assets.get(route);
        return send(response, 200, type, await fs.readFile(path.join(__dirname, '../src/show', file)));
      }
      if (request.method === 'GET' && route === '/session')
        return send(response, 200, 'application/json', JSON.stringify({ key, stream, wait: config.wait, surfaces: config.surfaces,
          midi: midi ? { input: midi.input, channel: midi.channel } : null }));
      if (request.headers['x-ink-session'] !== key) return send(response, 403, 'text/plain', 'Expected this projector session');
      if (request.method === 'GET' && route === '/frame') return frame(request, response, url);
      if (request.method === 'GET' && route === '/snapshot') return frame(request, response, url, true);
      if (request.method === 'POST' && route === '/midi' && midi &&
          request.headers['content-type'] === 'application/json') {
        const value = await readMidi(request);
        if (!isConnected() || client.id !== request.headers['x-ink-client'])
          return send(response, 409, 'text/plain', 'MIDI requires the active projector');
        onMidi(value);
        return send(response, 204, 'text/plain');
      }
      return send(response, 404, 'text/plain', 'Unknown projector route');
    } catch (error) {
      if (!response.destroyed && !response.headersSent) send(response, 400, 'text/plain', error.message);
    }
  });
  server.requestTimeout = 5000;
  server.maxConnections = 16;
  server.listen(config.port, loopback);
  await once(server, 'listening');
  server.on('error', error => { failure = error; });
  return {
    url: 'http://' + loopback + ':' + server.address().port + '/',
    get connected() { return Boolean(isConnected()); },
    get failure() { return failure; },
    async wait(signal) { if (!isConnected()) await once(connections, 'attach', { signal }); },
    publish(index, { width, height, data }) {
      latest = { index, width, height, serial: ++serial, bytes: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
    },
    end() { ended = true; },
    close() {
      if (!closed) {
        closed = new Promise(resolve => server.close(resolve));
        server.closeAllConnections?.();
      }
      return closed;
    }
  };
}

module.exports = { openProjector };
