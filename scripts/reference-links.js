const fs = require('node:fs');
const path = require('node:path');
const { markdownSections } = require('./reference-guides.js');

const references = /!?\[[^\]\n]+\]\(\s*(?:<([^>\n]+)>|([^\s)]+))|^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm;
const htmlAnchors = /<(?:a|span)\s+(?:id|name)=["']([^"']+)["']/g;
const fences = /^ {0,3}(`{3,}|~{3,})/;

function markdownLinks(markdown) {
  let fence;
  const text = markdown.split(/\r?\n/).map(line => {
    const marker = fences.exec(line)?.[1];
    if (!fence && marker) { fence = marker; return ''; }
    if (!fence) return line;
    if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    return '';
  }).join('\n');
  return [...text.matchAll(references)].map(match => match.slice(1).find(Boolean));
}

function checkLinks(root, guides, generated, entries) {
  const failures = [];
  const files = new Map(generated);
  function read(file) {
    if (files.has(file)) return files.get(file);
    const absolute = path.join(root, file);
    const stat = fs.statSync(absolute, { throwIfNoEntry: false });
    const content = !stat ? undefined : stat.isFile() && file.endsWith('.md') ? fs.readFileSync(absolute, 'utf8') : null;
    files.set(file, content);
    return content;
  }
  const anchors = new Map();
  function check(from, raw, base) {
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return;
    const [name, anchor] = raw.split('#', 2).map(decodeURIComponent);
    const file = name ? path.posix.normalize(path.posix.join(base, name)) : from;
    const content = read(file);
    if (content === undefined) {
      failures.push(from + ' → ' + raw);
      return;
    }
    if (!anchor || typeof content !== 'string' || !file.endsWith('.md')) return;
    if (!anchors.has(file)) anchors.set(file, new Set([
      ...markdownSections(content).map(section => section.anchor),
      ...[...content.matchAll(htmlAnchors)].map(match => match[1])
    ]));
    if (!anchors.get(file).has(anchor)) failures.push(from + ' → ' + raw);
  }
  for (const file of [...guides, ...generated.keys()]) {
    if (!file.endsWith('.md')) continue;
    for (const link of markdownLinks(read(file))) check(file, link, path.posix.dirname(file));
  }
  for (const { id, docs, source } of entries) {
    for (const link of [...docs, source]) check(id, link, '.');
  }
  if (failures.length)
    throw new Error('Broken local documentation links:\n  ' + [...new Set(failures)].join('\n  '));
}

module.exports = { checkLinks, markdownLinks };
