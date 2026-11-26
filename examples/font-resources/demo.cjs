const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const files = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');

const directory = path.resolve(process.argv[2] ?? 'studio/out/font-resources'), at = name => path.join(directory, name);
const fontFile = name => 'fonts/' + name + '.ttf';
for (const name of ['SourceSerif4-Regular', 'SourceSerif4-It']) {
  const file = fontFile(name);
  files.write(at(file), fs.readFileSync(path.join(__dirname, file)));
}
const license = 'fonts/SourceSerif4-LICENSE.md';
files.write(at(license), fs.readFileSync(path.join(__dirname, license)));
const marks = fs.readFileSync(path.join(__dirname, fontFile('NightMarks'))).toString('base64');
const options = { width: 760, height: 350, size: 74, tracking: 1.75, lineHeight: 99, align: 'center',
  at: [380, 63], family: 'Source Serif 4', style: 'Regular', fallback: [{ family: 'Night Marks' }],
  color: '#f9d59a', kerning: true, maxWidth: 602, wrap: 'word' };
const text = 'The Night Atlas\n☾  After Dark  ✶';
const ref = (node, port = 'value') => ({ node, port });
const input = name => ({ input: name });
const project = {
  format: 'ink-studio/graph-project', version: 1,
  assets: {
    regular: { format: 'ttf', file: fontFile('SourceSerif4-Regular') },
    italic: { format: 'ttf', file: fontFile('SourceSerif4-It') },
    marks: { format: 'ttf', data: marks }
  },
  inputs: { text: { type: 'string', default: text }, options: { type: 'record', default: options } },
  nodes: {
    regular: { op: 'fontAsset', inputs: { name: 'regular' } },
    italic: { op: 'fontAsset', inputs: { name: 'italic' } },
    marks: { op: 'fontAsset', inputs: { name: 'marks' } },
    catalog: { op: 'data.record', inputs: { regular: ref('regular'), italic: ref('italic'), marks: ref('marks') } },
    stack: { op: 'font.stack', inputs: { names: ['regular', 'italic', 'marks'], resources: ref('catalog') } },
    sign: { op: 'draw.fontText', inputs: { text: input('text'), options: input('options'), faces: ref('stack') } }
  },
  outputs: { plate: ref('sign'), layout: ref('sign', 'layout'), anchors: ref('sign', 'anchors') },
  exports: { lettering: { output: 'plate', format: 'png' }, layout: { output: 'layout', format: 'json' } }
};
const material = Ink.openMaterialGraph(project, { id: 'night-atlas' });
material.label = 'The Night Atlas';
const source = Ink.writeMaterialGraph(at('night-atlas.material.json'), material);
const published = Ink.publishMaterialSubgraph(at('night-atlas.group.json'), source, { baseDir: directory });
const group = JSON.parse(fs.readFileSync(published.file, 'utf8'));
const before = Ink.readGraphProject(at('night-atlas.material.json')).run();
const after = Ink.createGraphProject({
  format: project.format, version: 1, groups: { Sign: 'night-atlas.group.json' },
  nodes: { sign: { op: 'Sign' } }, outputs: { plate: ref('sign', 'plate'), layout: ref('sign', 'layout') }
}, { baseDir: directory }).run();
assert.deepEqual(after.outputs, { plate: before.outputs.plate, layout: before.outputs.layout });
assert.deepEqual(after.outputs.layout.glyphs.filter(glyph => glyph.fallback).map(glyph => glyph.char), ['☾', '✶']);
const { width, height, data } = after.outputs.plate;
files.write(at('lettering.png'), PNG.encode(width, height, data, 4));
files.json(at('layout.json'), after.outputs.layout);
files.write(at('publication.js'), 'const fontPublication = ' + JSON.stringify(group) + ';\n');
files.write(at('ink-studio.browser.js'), Ink.bundle());
for (const file of ['index.html', 'live.js']) files.write(at(file), fs.readFileSync(path.join(__dirname, file)));
console.log(at('index.html'));
