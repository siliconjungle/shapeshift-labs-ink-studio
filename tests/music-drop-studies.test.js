const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WAV = require('../cli/wav.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');

test('dance drop studies export playable patches and controlled drum auditions',t=>{
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-drop-studies-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const run = (...args)=>execFileSync(process.execPath,[cli,'music',...args],{encoding:'utf8'});
  run('production','drop-studies','--out',out);
  const read = file=>JSON.parse(fs.readFileSync(path.join(out,file)));
  const manifest = read('manifest.json');
  assert.deepEqual(manifest.studies.map(row=>row.id),['dnb','dubstep','rave']);
  for (const {mix,measurements} of manifest.studies) {
    const print = WAV.read(path.join(out,mix));
    assert.equal(print.channels,2);
    assert.equal(print.sampleRate,48000);
    assert.ok(measurements.integratedLufs > -18 && measurements.truePeakDbTP <= -1.45);
    assert.equal(print.samples.length/2,measurements.frames);
  }

  const comparison = read('dnb/audition-report.json');
  assert.equal(comparison.comparison.length,5);
  const reference = read('dnb/session.json').session;
  const referencePrint = fs.readFileSync(path.join(out,'dnb/auditions/tight-crack.wav'));
  for (const take of comparison.comparison) {
    assert.ok(Math.abs(take.integratedLufs-comparison.targetLufs) < .1);
    assert.equal(take.frames,comparison.comparison[0].frames);
    const {session} = read('dnb/'+take.session);
    assert.deepEqual(session.mixer,reference.mixer);
    for (const lane of ['break','bass','reese','signal'])
      assert.deepEqual(session.production.tracks[lane],reference.production.tracks[lane]);
    for (const lane of ['kick','snare'])
      assert.deepEqual(session.production.tracks[lane].clips,reference.production.tracks[lane].clips);
    if (take.id!==comparison.selection) {
      const changed = ['kick','snare'].filter(lane=>
        JSON.stringify(session.production.patches[lane])!==JSON.stringify(reference.production.patches[lane]));
      assert.equal(changed.length,1);
      assert.ok(!referencePrint.equals(fs.readFileSync(path.join(out,'dnb',take.audition))));
    }
  }
  const {before,after} = read('dnb/kick-bass-adjustment.json');
  assert.ok(before.pairs.length>10 && after.pairs.length===before.pairs.length);
  assert.ok(before.pairs.every(row=>row.audibleGapMs>25));
  assert.ok(after.pairs.every(row=>row.audibleGapMs>=14 && row.audibleGapMs<=22));
  const {bass,reese} = reference.production.tracks;
  assert.deepEqual(reese.timingEdits,bass.timingEdits.map(edit=>({...edit,at:{...edit.at,clip:'reese-phrase'}})));

  const dubstep = read('dubstep/session.json').session;
  for (const id of ['vowel','growl']) {
    const patch = read(manifest.studies[1].instruments[id]);
    assert.deepEqual(patch,dubstep.production.patches[id]);
    assert.ok(Object.values(patch.nodes).some(node=>node.cutoff?.by?.breath>100));
    assert.equal(patch.nodes.lfo.ratio.by.contact,4);
    assert.ok(patch.nodes.wet.amount.by.pressure>0);
  }
  const phrases = ['vowel','growl'].flatMap(id=>
    dubstep.production.tracks[id].clips[0].voices[0].notes).sort((a,b)=>a.beat-b.beat);
  assert.ok(phrases.slice(1).every((row,i)=>row.beat>=phrases[i].beat+phrases[i].duration));
  assert.ok(phrases.some((row,i)=>i>0 && row.beat-phrases[i-1].beat-phrases[i-1].duration>1));

  const rave = read('rave/session.json').session;
  assert.deepEqual(Object.keys(rave.production.tracks),['kick','bass','lead']);
  assert.equal(Object.values(rave.production.patches.lead.nodes).filter(node=>node.wave==='saw').length,7);
  assert.ok(manifest.studies[2].measurements.monoLossDb > -1);
});
