const fs = require('node:fs');
const path = require('node:path');
const { Session } = require('node:inspector');
const { fileURLToPath } = require('node:url');

function bundleSources(studio, bundle) {
  const intervals = [];
  let offset = 0;
  let line = 0;
  const newlines = text => (text.match(/\n/g) ?? []).length;
  for (const file of [...studio.files(), ...studio.demoFiles()]) {
    const text = fs.readFileSync(file, 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
    const from = bundle.indexOf(text, offset);
    if (from < 0) throw new Error('Cannot map the bundled source ' + file);
    line += newlines(bundle.slice(offset, from));
    const length = newlines(text);
    intervals.push({ from: line, to: line + length, file });
    line += length;
    offset = from + text.length;
  }
  return intervals;
}

async function apiSources(root, studio, members) {
  const session = new Session();
  const scripts = new Map();
  const send = (command, params = {}) => new Promise((resolve, reject) =>
    session.post(command, params, (error, result) => error ? reject(error) : resolve(result)));
  const bundle = studio.nodeBundlePath();
  const intervals = bundleSources(studio, fs.readFileSync(bundle, 'utf8'));
  const identifier = '__INK_STUDIO_PUBLIC_REFERENCE';
  const functions = [...members.keys()];
  if (Object.hasOwn(globalThis, identifier)) throw new Error('The reference source inspection is already running');
  session.connect();
  try {
    globalThis[identifier] = functions;
    session.on('Debugger.scriptParsed', ({ params }) => scripts.set(params.scriptId, params.url));
    await send('Debugger.enable');
    const { result } = await send('Runtime.evaluate', { expression: 'globalThis.' + identifier, objectGroup: identifier });
    const { result: properties } = await send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
    for (const property of properties) {
      if (!/^\d+$/.test(property.name) || !property.value?.objectId) continue;
      const { internalProperties } = await send('Runtime.getProperties', { objectId: property.value.objectId, ownProperties: true });
      const location = internalProperties?.find(detail => detail.name === '[[FunctionLocation]]')?.value.value;
      if (!location) continue;
      const url = scripts.get(location.scriptId);
      if (!url?.startsWith('file:')) continue;
      const script = fileURLToPath(url);
      const source = script === bundle
        ? intervals.find(range => range.from <= location.lineNumber && location.lineNumber <= range.to)?.file
        : script;
      if (!source) continue;
      const file = path.relative(root, source).split(path.sep).join('/');
      if (file.startsWith('../')) continue;
      for (const member of members.get(functions[Number(property.name)])) member.source = file;
    }
    await send('Runtime.releaseObjectGroup', { objectGroup: identifier });
  } finally {
    session.disconnect();
    delete globalThis[identifier];
  }
}

module.exports = { apiSources };
