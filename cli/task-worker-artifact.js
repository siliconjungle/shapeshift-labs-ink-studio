const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { isDeepStrictEqual } = require('node:util');
const Graph = require('./task-graph.js');
const Process = require('./task-process.js');

function inventory(source, expected, key, limits) {
  const meter = Process.meter(limits.outputBytes, limits.files, 'Worker artifact');
  const files = [];
  const actual = Graph.fileDigest(source, Buffer.allocUnsafe(64 * 1024), (info, file) => {
    meter(info);
    const relative = path.relative(source, file).split(path.sep).join('/');
    if (relative && !Graph.filePath(relative)) throw new TypeError('Worker artifact path is not portable');
    files.push({ path: relative, bytes: info.isFile() ? info.size : null });
  });
  if (!isDeepStrictEqual(actual, expected)) throw new Error('Worker artifact no longer matches its receipt');
  return { key, digest: expected, files };
}

async function stream(response, source, relative, expected, limits) {
  if (relative !== '' && (!Graph.filePath(relative) || expected.kind !== 'directory'))
    throw new TypeError('Invalid worker artifact file');
  const base = fs.lstatSync(source);
  if (expected.kind === 'directory' ? !base.isDirectory() : !base.isFile())
    throw new TypeError('Worker artifact changed kind');
  const file = path.join(source, relative), root = fs.realpathSync(source);
  if (path.join(root, relative) !== fs.realpathSync(file)) throw new TypeError('Expected an ordinary worker artifact path');
  const reader = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = await reader.stat();
    if (!info.isFile() || info.size > limits.outputBytes) throw new TypeError('Expected a bounded worker artifact file');
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
    await pipeline(reader.createReadStream({ autoClose: false }), response);
  } finally {
    await reader.close();
  }
}

async function receive({ metadata, expected, destination, download, limits }) {
  if (metadata.key !== expected.key || !isDeepStrictEqual(metadata.digest, expected.digest))
    throw new Error('Worker artifact manifest does not match its receipt');
  const { files } = metadata;
  if (!Array.isArray(files) || !files.length || files.length > limits.files ||
      files[0]?.path !== '' || (files[0].bytes === null) !== (expected.digest.kind === 'directory'))
    throw new TypeError('Invalid worker artifact inventory');
  const entries = new Map();
  let total = 0;
  for (const row of files) {
    if (!row || typeof row.path !== 'string' || entries.has(row.path) ||
        row.path !== '' && (!Graph.filePath(row.path) || entries.get(path.posix.dirname(row.path).replace(/^\.$/, '')) !== null) ||
        row.bytes !== null && (!Number.isSafeInteger(row.bytes) || row.bytes < 0))
      throw new TypeError('Invalid worker artifact inventory entry');
    entries.set(row.path, row.bytes);
    total += row.bytes ?? 0;
    if (total > limits.outputBytes) throw new RangeError('Worker artifact exceeds its byte budget');
  }
  if (fs.existsSync(destination)) throw new Error('Choose a new location for the worker artifact');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = fs.mkdtempSync(path.join(path.dirname(destination), '.ink-worker-download-'));
  try {
    const artifact = path.join(temp, 'artifact');
    for (const [relative, bytes] of entries) {
      const file = path.join(artifact, relative);
      if (bytes === null) fs.mkdirSync(file);
      else await download(relative, file, bytes);
    }
    const digest = Graph.fileDigest(artifact, Buffer.allocUnsafe(64 * 1024));
    if (!isDeepStrictEqual(digest, expected.digest)) throw new Error('Downloaded worker artifact does not match its receipt');
    if (expected.digest.kind === 'file') fs.linkSync(artifact, destination);
    else {
      if (fs.existsSync(destination)) throw new Error('Choose a new location for the worker artifact');
      fs.renameSync(artifact, destination);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { inventory, stream, receive };
