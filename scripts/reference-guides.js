const fs = require('node:fs');
const path = require('node:path');

function files(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? files(file, extension) : file.endsWith(extension) ? [file] : [];
    });
}

function headingId(heading) {
  return heading.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
}

function readMarkdown(file) {
  return markdownSections(fs.readFileSync(file, 'utf8'));
}

function markdownSections(markdown) {
  const sections = [];
  let fence;
  let section = { title: '', text: '' };
  const anchors = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    else {
      const heading = !fence && /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
      if (heading) {
        const title = heading.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replaceAll('`', '');
        const base = headingId(title);
        let anchor = base;
        for (let suffix = 1; anchors.has(anchor); suffix++) anchor = base + '-' + suffix;
        anchors.add(anchor);
        section = { title, anchor, text: '' };
        sections.push(section);
      } else section.text += line + '\n';
    }
  }
  return sections;
}

function loadGuides(root) {
  const master = path.join(root, 'README.md');
  const list = [master, ...files(path.join(root, 'docs'), '.md')];
  const generated = path.join(root, 'docs', 'reference') + path.sep;
  const refs = new Map();
  const guides = [];
  const documents = new Map();
  for (const file of list) {
    if (file.startsWith(generated)) continue;
    const relative = path.relative(root, file).split(path.sep).join('/');
    const sections = readMarkdown(file);
    documents.set(relative, sections);
    const title = sections[0]?.title || path.basename(file, '.md');
    const summary = sections.map(section => section.text.trim()).find(Boolean)?.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').slice(0, 300);
    guides.push({
      id: relative, kind: 'guide', title, ...(summary && { summary }),
      use: sections.slice(1).map(section => section.title).join(' · '), docs: [relative]
    });
    for (const section of sections) {
      const link = relative + (section === sections[0] ? '' : '#' + section.anchor);
      const apiNames = [...(section.text + '\n' + section.title).matchAll(/\b(KIT|K|ink|studio)\.([A-Za-z_$][\w.$]*)/g)];
      const codeNames = [...section.text.matchAll(/`([A-Za-z][\w-]*(?:\.[A-Za-z_$][\w-]*)+)`/g)].map(match => match[1]);
      for (const name of [
        ...apiNames.map(([, scope, key]) => (['KIT', 'K'].includes(scope) ? 'KIT.' : 'node.') + key.replace(/\.$/, '')),
        ...codeNames
      ]) {
        if (!refs.has(name)) refs.set(name, new Set());
        refs.get(name).add(link);
      }
    }
  }
  return { guides, docsFor: id => Array.from(refs.get(id) ?? []).slice(0, 5), documents };
}

module.exports = { headingId, loadGuides, markdownSections };
