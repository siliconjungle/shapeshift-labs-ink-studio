'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const shortHash = bytes => hash(bytes).slice(0, 20);
const chunkId = (layer, cell) => 'chunk-' + shortHash(JSON.stringify([layer,cell]));
const levelName = (id, level, bytes, sourceFile) => id + '-' + level + '-' + shortHash(bytes) + path.extname(sourceFile);
const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
function rawPayload(data) {
  if (littleEndian) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const bytes = Buffer.allocUnsafe(data.byteLength);
  for (let i=0;i<data.length;i++) bytes.writeFloatLE(data[i],i*4);
  return bytes;
}
module.exports = { hash, shortHash, chunkId, levelName, rawPayload };
