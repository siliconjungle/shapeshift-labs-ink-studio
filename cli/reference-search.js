const fs = require('node:fs');
const path = require('node:path');
const { markdownSections } = require('../scripts/reference-guides.js');

function matchingGuide(entry, words, read) {
  const sections = markdownSections(read(entry.id));
  for (const section of sections) {
    const paragraphs = [section.title, ...section.text.trim().split(/\n\s*\n/)];
    if (!words.every(word => paragraphs.some(paragraph => paragraph.toLowerCase().includes(word)))) continue;
    const [summary] = paragraphs
      .map(text => ({ text, matches: words.filter(word => text.toLowerCase().includes(word)).length }))
      .sort((a, b) => b.matches - a.matches)
      .map(({ text }) => text.replace(/\s+/g, ' ').slice(0, 300));
    const link = entry.id + (section === sections[0] ? '' : '#' + section.anchor);
    return { ...entry, summary, docs: [link], match: section.title };
  }
}

function search(reference, terms, readGuide) {
  const words = terms.flatMap(term => term.toLowerCase().split(/\s+/)).filter(Boolean);
  const query = words.join(' ');
  const ranked = [];
  for (const entry of reference.entries) {
    const id = entry.id.toLowerCase();
    const title = (entry.title ?? entry.id).toLowerCase();
    const primary = [id, title, entry.kind].join(' ');
    const text = [primary, entry.summary, entry.use, entry.parameters, entry.source, entry.keywords,
      ...(entry.flags ?? []).map(flag => '--' + flag), ...entry.docs].join(' ').toLowerCase();
    if (!words.every(word => text.includes(word))) {
      if (entry.kind === 'guide' && readGuide) {
        const matched = matchingGuide(entry, words, readGuide);
        if (matched) ranked.push({ entry: matched, score: 3 });
      }
      continue;
    }
    const score = id === query || title === query ? 0 : words.every(word => primary.includes(word)) ? 1 : 2;
    ranked.push({ entry, score });
  }
  return ranked.sort((a, b) => a.score - b.score).map(row => row.entry);
}

function print(terms, options) {
  const root = path.join(__dirname, '..');
  const file = path.join(root, 'docs/reference/index.json');
  if (!fs.existsSync(file)) throw new Error('Public reference is missing. Run npm run docs:build from the Ink Studio checkout.');
  const reference = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = search(reference, terms, guide => fs.readFileSync(path.join(root, guide), 'utf8'));
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
