const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const {catalog, exportSoundPack} = require('../cli/music-sound-library.js');
const {KIT} = ink.load();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('exported sound packs contain playable phrase recipes and complete recording credits', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sound-pack-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const entry of catalog) {
    const folder = path.join(root, entry.id);
    const pack = read(exportSoundPack(entry.id, folder));
    assert.deepEqual(Object.keys(pack.patches), entry.patches);
    assert.deepEqual(Object.keys(pack.provenance), Object.keys(pack.assets));
    assert.equal(read(path.join(folder, pack.rack)).id, entry.rack);
    for (const source of Object.values(pack.provenance)) {
      assert.ok(['CC0-1.0','LicenseRef-Public-Domain-Author'].includes(pack.credits[source.credit].license));
      assert.match(source.original, /\.(wav|ogg|flac)$/i);
    }
    for (const {file} of pack.phrases) {
      const full = path.join(folder, file);
      const {production, assets} = read(full);
      const bank = Object.fromEntries(Object.entries(assets).map(([name, at]) =>
        [name, ink.readWav(path.resolve(path.dirname(full), at))]));
      const rendered = KIT.music.production.render(production, bank, {sampleRate: 8000});
      assert.ok(rendered.report.rms > .002, file + ' should be audible');
    }
  }
  assert.throws(() => ink.loadSoundPack('../missing'), /Unknown sound pack/);
});

test('the recorded reed sounds a key-up sample after the written gate', () => {
  const {patches, assets} = ink.loadSoundPack('breath-and-reed');
  const patch = patches['recorded-reed'];
  const production = {arrangement: {score: {tempoMap: {tempo: 120}, key: {root: 'C4'},
    harmonies: {home: {root: 'C4', quality: 'unison'}}},
    sections: [{id: 'hold', bars: 2, harmony: 'home'}], parts: {reed: {role: 'lead'}}, motifs: {}},
    patches: {reed: patch}, tracks: {reed: {patch: 'reed', clips: [
      {id: 'hold', beat: 0, length: 8, voices: [{id: 'line', notes: [
        {id: 'note', beat: .5, duration: 4.5, midi: 60, velocity: .72}
      ]}]}
    ]}}};
  const sampleRate = 16000;
  const render = source => KIT.music.production.render(source, assets, {sampleRate}).value.samples;
  const release = render(production);
  const body = render({...production, patches: {reed: {...patch, performance: {...patch.performance, rules: []}}}});
  const gate = sampleRate * 5;
  const sustained = release.slice(sampleRate * 4.25, sampleRate * 4.5);
  assert.ok(sustained.some(sample => Math.abs(sample) > .035), 'the held note plays past the end of the source');
  assert.deepEqual(release.slice(0, gate), body.slice(0, gate));
  assert.ok(release.slice(gate, gate + 3000).some((sample, i) => Math.abs(sample - body[gate + i]) > .005));
});

test('Yard Kit alternates acoustic kicks and cuts the open hat on the next closed hit', () => {
  const {kit, assets} = ink.loadSoundPack('drums-and-bass');
  const events = [
    {pad: 'kick', time: .04, velocity: .8}, {pad: 'kick', time: .2, velocity: .8},
    {pad: 'open-hat', time: .4, velocity: .8}, {pad: 'closed-hat', time: .48, velocity: .7}
  ];
  const {report} = KIT.procedural.mediaGraph.sampleKit.render(kit, assets, events, {sampleRate: 16000});
  assert.deepEqual(report.events.slice(0, 2).map(event => event.layers[0].take),
    ['rhythm-kick-hard-a', 'rhythm-kick-hard-b']);
  assert.equal(report.events[2].chokeAt, report.events[3].at);
});
