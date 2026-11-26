const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Ink = require('..');

const fixtures = path.resolve(__dirname, '../examples/font-resources/fonts');
const fixture = name => path.join(fixtures, name + '.ttf');
const facesFrom = () => ['SourceSerif4-Regular', 'SourceSerif4-It', 'NightMarks'].map(name =>
  Ink.load().KIT.procedural.fontResources.create(fs.readFileSync(fixture(name))));
const fallback = [{ family: 'Night Marks', style: 'Regular' }];
const read = (node, port = 'value') => ({ node, port });
const project = (fields = {}) => ({ format: 'ink-studio/graph-project', version: 1, ...fields });

test('TrueType face selection, pair kerning, line metrics and fallback are independent of system fonts', () => {
  const font = Ink.load().KIT.procedural.fontResources, faces = facesFrom();
  assert.deepEqual(faces.map(({ family, style }) => [family, style]),
    [['Source Serif 4', 'Regular'], ['Source Serif 4', 'Italic'], ['Night Marks', 'Regular']]);
  const options = { width: 240, height: 108, size: 28, at: [120, 4], tracking: 1.75, lineHeight: 36,
    align: 'center', family: 'Source Serif 4', style: 'Italic', fallback };
  const text = 'AV ☾\r\nCafé ✶';
  const { value, layout, anchors } = font.render(text, faces, options);
  assert.equal(layout.text, text);
  assert.equal(layout.arranged, 'AV ☾\nCafé ✶');
  assert.equal(layout.lines[1].baseline - layout.lines[0].baseline, 36);
  assert.equal(anchors['line:0'][0], 120);
  assert.equal(layout.glyphs[0].x, 120 - layout.lines[0].width / 2);
  assert.deepEqual(layout.glyphs.filter(row => row.fallback).map(row => [row.char, row.family]),
    [['☾', 'Night Marks'], ['✶', 'Night Marks']]);
  const missing = font.render(text, faces, { ...options, fallback: [] });
  assert.deepEqual(missing.layout.glyphs.filter(row => row.missing).map(row => row.char), ['☾', '✶']);
  assert.notDeepEqual(value.data, missing.value.data);
  assert.notDeepEqual(value.data, font.render(text, faces, { ...options, style: 'Regular' }).value.data);
  const unkerned = font.layout('AV', faces, { size: 70, kerning: false }).layout.width;
  assert.ok(font.layout('AV', faces, { size: 70 }).layout.width < unkerned);
  assert.throws(() => font.render(text, faces, { ...options, style: 'Bold' }), /Unknown font face/);
  assert.throws(() => font.create(Uint8Array.from({length: 24}, () => 0)), /TrueType/);
});

test('automatic wrapping, alignment and tracking preserve authored text and distinct baselines', () => {
  const font = Ink.load().KIT.procedural.fontResources, faces = facesFrom(), text = 'North Dome\n\nAfter Dark';
  const options = { size: 20, maxWidth: 60, wrap: 'word', align: 'right', vertical: 'baseline', at: [100, 24],
    lineHeight: 23, tracking: 1 };
  const proof = font.layout(text, faces, options).layout;
  assert.equal(proof.text, text);
  assert.equal(proof.arranged, 'North\nDome\n\nAfter\nDark');
  assert.deepEqual(proof.lines.map(line => line.baseline), [24, 47, 70, 93, 116]);
  assert.ok(proof.lines.every(line => line.width <= 60));
  assert.equal(proof.glyphs[0].x, 100 - proof.lines[0].width);
  assert.equal(font.layout('NORTH', faces, { ...options, wrap: 'none' }).layout.arranged, 'NORTH');
  const character = font.layout('NORTH', faces, { ...options, maxWidth: 24, wrap: 'character' }).layout;
  assert.equal(character.arranged.replaceAll('\n', ''), 'NORTH');
  assert.ok(character.lines.every(line => line.width <= 24));
  assert(font.layout('North', faces, { ...options, tracking: 0 }).layout.lines[0].width < proof.lines[0].width);
});

test('linked font edits and published groups retain resources, graph defaults and rendered output', t => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-fonts-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  fs.copyFileSync(fixture('SourceSerif4-Regular'), path.join(baseDir, 'main.ttf'));
  const assets = { letters: { format: 'ttf', file: 'main.ttf' },
    marks: { format: 'ttf', data: fs.readFileSync(fixture('NightMarks')).toString('base64') } };
  const text = 'AV ☾ · North Dome', options = { style: 'Regular', fallback, align: 'right', at: [219, 3],
    size: 25, lineHeight: 31, tracking: 2, maxWidth: 100, wrap: 'word', width: 240, height: 128 };
  const nodes = {
    primary: { op: 'fontAsset', inputs: { name: { input: 'face-id' } } },
    marks: { op: 'fontAsset', inputs: { name: 'marks' } },
    resources: { op: 'data.record', inputs: { primary: read('primary'), marks: read('marks') } },
    stack: { op: 'font.stack', inputs: { names: ['primary', 'marks'], resources: read('resources') } },
    text: { op: 'draw.fontText', inputs: { text: { input: 'label' }, faces: read('stack'), options: { input: 'options' } } }
  };
  const inputs = { label: { type: 'string', default: text }, options: { type: 'record', default: options },
    'face-id': { type: 'string', default: 'letters' } };
  const outputs = { plate: read('text'), layout: read('text', 'layout') };
  const master = Ink.openMaterialGraph(project({ assets, inputs, nodes, outputs }), { id: 'label' });
  const embedded = Ink.editMaterialFont(master, { kind: 'embed', id: 'letters' }, { baseDir });
  assert.equal(embedded.document.resources.letters.definition.origin, 'main.ttf');
  assert.equal(embedded.font.storage, 'embedded');
  assert.equal(Ink.describeMaterialFont(master, 'letters', { baseDir }).sha256, embedded.font.sha256);
  const relocated = path.join(baseDir, 'draft', 'label.material.json');
  assert.equal(Ink.writeMaterialGraph(relocated, embedded.document, { baseDir }).resources.letters.definition.origin, '../main.ttf');

  const source = path.join(baseDir, 'label.material.json');
  Ink.writeMaterialGraph(source, master);
  const draft = Ink.readGraphProject(source);
  assert(draft.sourceFiles().includes(path.join(baseDir, 'main.ttf')));
  const initial = draft.run().outputs;
  const group = path.join(baseDir, 'delivery', 'label.group.json');
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const output = execFileSync(process.execPath, [cli, 'graph', 'publish-subgraph', source, '--out', group], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).revision, 1);
  const published = JSON.parse(fs.readFileSync(group, 'utf8'));
  assert.equal(published.nodes.primary.op, 'font.resolve');
  assert.equal(published.inputs.label.default, text);
  assert.deepEqual(published.inputs.options.default, options);
  assert(!JSON.stringify(published).includes('main.ttf'));
  const info = JSON.parse(execFileSync(process.execPath, [cli, 'graph', 'material-font', source, 'letters'], { encoding: 'utf8' }));
  assert.equal(info.sha256, embedded.font.sha256);

  fs.copyFileSync(fixture('SourceSerif4-It'), path.join(baseDir, 'main.ttf'));
  const updated = Ink.editMaterialFont(embedded.document, { kind: 'reimport', id: 'letters' }, { baseDir });
  assert.notEqual(updated.font.sha256, info.sha256);
  assert.equal(updated.font.style, 'Regular');
  fs.unlinkSync(path.join(baseDir, 'main.ttf'));

  const replay = Ink.createGraphProject(project({
    groups: { Sign: group }, inputs: { label: inputs.label },
    nodes: { sign: { op: 'Sign', inputs: { label: { input: 'label' } } } },
    outputs: { plate: read('sign', 'plate'), layout: read('sign', 'layout') }
  }));
  assert.deepEqual(replay.run().outputs, initial);
  assert.equal(replay.run({ inputs: { label: 'Café ✶' } }).outputs.layout.text, 'Café ✶');
  assert.deepEqual(Ink.readGraphProject(relocated).run().outputs, initial);
});
