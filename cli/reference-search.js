const fs = require('node:fs');
const path = require('node:path');

function search(reference, terms) {
  const words = terms.flatMap(term => term.toLowerCase().split(/\s+/)).filter(Boolean);
  const query = words.join(' ');
  const ranked = [];
  for (const entry of reference.entries) {
    const id = entry.id.toLowerCase();
    const title = (entry.title ?? entry.id).toLowerCase();
    const primary = [id, title, entry.kind].join(' ');
    const text = [primary, entry.summary, entry.use, entry.parameters, entry.source, entry.keywords,
      ...(entry.flags ?? []).map(flag => '--' + flag), ...entry.docs].join(' ').toLowerCase();
    if (!words.every(word => text.includes(word))) continue;
    const score = id === query || title === query ? 0 : words.every(word => primary.includes(word)) ? 1 : 2;
    ranked.push({ entry, score });
  }
  return ranked.sort((a, b) => a.score - b.score).map(row => row.entry);
}

function print(terms, options) {
  const file = path.join(__dirname, '../docs/reference/index.json');
  if (!fs.existsSync(file)) throw new Error('Public reference is missing. Run npm run docs:build from the Ink Studio checkout.');
  const reference = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = search(reference, terms);
  if (options.json) {
    console.log(JSON.stringify({ ...reference, entries }, null, 2));
    return;
  }
  for (const { id, kind, title, summary, use, parameters, docs, source } of entries) {
    const label = id + ' [' + kind + ']' + (title && id !== title ? ' ' + title : '');
    const details = options.full || entries.length === 1;
    console.log([label, ...(details ? [summary, use ?? parameters, ...docs, source].filter(Boolean).map(line => '  ' + line) : [])].join('\n'));
  }
  if (!entries.length) console.log('nothing matches');
}

module.exports = { print, search };
