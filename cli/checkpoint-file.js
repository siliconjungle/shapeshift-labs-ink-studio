const fs = require('node:fs');
const path = require('node:path');
const { format, openCheckpointStore } = require('../src/simulation-checkpoint-store.js');

function resolveCheckpoint(file, document, { onBlock, readBlock } = {}) {
  if (document?.format !== format) return document;
  if (typeof document.store !== 'string' || !document.store.trim()) throw new TypeError('Checkpoint reference needs a store path');
  const store = path.resolve(path.dirname(file), document.store);
  return openCheckpointStore(store, { readBlock: block => {
    onBlock?.(block);
    return readBlock ? readBlock(block) : fs.readFileSync(block);
  } }).load(document);
}

function readCheckpoint(file, options) {
  return resolveCheckpoint(file, JSON.parse(fs.readFileSync(file, 'utf8')), options);
}

module.exports = { readCheckpoint, resolveCheckpoint };
