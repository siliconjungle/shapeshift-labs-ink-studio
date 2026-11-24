'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

const format = 'ink-studio/pixel-edit-session';
const changed = 'The pixel edit session advanced on disk. Reopen it before writing.';
const filename = (directory, revision) => path.join(directory,'checkpoint-' + revision + '.json');

function location(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('A pixel edit session needs a directory');
  return path.resolve(directory);
}

function read(directory) {
  directory = location(directory);
  // A reader can overlap with pruning of a generation that just stopped being current.
  for (let attempt = 0; attempt < 3; attempt++) {
    const revisions = fs.readdirSync(directory).map(name => /^checkpoint-([1-9]\d*)\.json$/.exec(name))
      .filter(Boolean).map(match => Number(match[1]));
    const revision = revisions.reduce((latest,value) => Math.max(latest,value),0);
    if (!Number.isSafeInteger(revision) || !revision) throw new Error('No pixel edit session in ' + directory);
    const contents = JSON.parse(fs.readFileSync(filename(directory,revision),'utf8'));
    if (contents === null) continue;
    if (contents?.format !== format || contents.version !== 1 || contents.revision !== revision)
      throw new Error('Invalid pixel edit session checkpoint');
    return { directory, revision, contents };
  }
  throw new Error('Could not read the current pixel edit session checkpoint');
}

function attach(directory, metadata, document, loaded) {
  directory = location(directory);
  let revision = loaded?.revision ?? 0;
  let previous = loaded && JSON.stringify([loaded.contents.scene,loaded.contents.journal]);
  let error = null;
  function flush() {
    try {
      const { scene, ...identity } = metadata();
      const journal = document.exportSession();
      const data = JSON.stringify([scene,journal]);
      if (data !== previous) {
        const next = revision + 1;
        if (!Number.isSafeInteger(next)) throw new RangeError('Pixel edit session revision overflow');
        const contents = { format, version:1, revision:next, ...identity, scene, journal };
        files.publishJson(filename(directory,next),contents,changed);
        revision = next;
        previous = data;
        if (next > 2) {
          // Keep the previous full checkpoint. The older name still reserves its revision
          // so a stale writer cannot publish into history after it has been pruned.
          try { files.json(filename(directory,next-2),null); } catch { /* The old checkpoint can remain. */ }
        }
      }
      error = null;
    } catch (cause) {
      error = cause.message;
    }
    return error === null;
  }
  if (!loaded && !flush()) throw new Error(error);
  const detach = document.onSessionChange(flush);
  return { directory, flush, detach, status:() => ({ directory, revision, saved:error === null, error }) };
}

module.exports = { read, attach };
