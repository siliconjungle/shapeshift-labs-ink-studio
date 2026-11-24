const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout:pause } = require('node:timers/promises');
const { withChrome } = require('../cli/canvas-grid-chrome.js');

const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
  { cwd:path.resolve(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','pipe'] });
const mark = (x,swatch)=>({ at:[x,27],swatch });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-multiview-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const file = name=>path.join(directory,name), save = (name,doc)=>fs.writeFileSync(file(name),JSON.stringify(doc));
  const read = name=>JSON.parse(fs.readFileSync(file(name)));
  const scene = { id:'multi-view-plate',style:'slate',
    camera:{ target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0,projection:'orthographic' },
    solids:[{ kind:'box',id:'plate',at:[0,0,0],half:[.8,.7,.23],res:.07,mat:'stone',
      surfaceState:{ charts:{ face:{ origin:[-.8,-.7,.23],u:[1.6,0,0],v:[0,1.4,0],depth:.045 } } } }] };
  const design = { format:'ink-studio/pixel-art',version:2,width:80,height:56,pixelAspect:[1,1],
    palette:{ orange:'#ee935f',cyan:'#55dbca' },layers:[{ id:'ink' }],frames:[{ id:'art',durationMs:100,cels:{} }],
    sceneBindings:[{ id:'plate',scene:file('scene.json'),object:'plate',frame:'art' }],
    destinations:[{ id:'paint',kind:'surface-channel',binding:'plate',chart:'face',channel:'paint' }] };
  const plan = { format:'ink-studio/pixel-multiview',version:1,id:'pattern',destination:'paint',size:[8,8],
    views:[{ id:'front',approved:true,marks:[mark(38,'orange'),mark(39,'orange')] },
      { id:'quarter',approved:true,camera:{ yaw:.3,pitch:0,ortho:true },marks:[mark(40,'cyan'),mark(42,'cyan')] },
      { id:'check',camera:{ yaw:-.4,pitch:0,ortho:true },marks:[mark(38,'cyan')] }] };
  save('scene.json',scene);
  save('design.json',design);
  function assemble(...extra) {
    save('plan.json',plan);
    return JSON.parse(cli('multiview',file('design.json'),file('plan.json'),...extra));
  }
  return { directory,file,save,read,scene,design,plan,assemble };
}

test('approved camera marks resolve one chart patch which applies and replays as one native edit',t=>{
  const { file,save,read,scene,plan,assemble } = fixture(t);
  plan.views[1].marks.unshift(mark(37,'cyan'));
  const request = ['--sdf-assist','on','--patch',file('edit.json')];
  assert.throws(()=>assemble(...request),error=>{
    assert.equal(error.status,2);
    const found = JSON.parse(error.stdout);
    assert.equal(found.status,'needs-review');
    assert.equal(found.unresolved,1);
    assert.deepEqual(found.conflicts[0].cell,[3,3]);
    assert.deepEqual([...new Set(found.conflicts[0].samples.map(sample=>sample.view))],['front','quarter']);
    assert.ok(found.views.some(view=>view.counts.conflict > 0));
    return true;
  });
  assert.equal(fs.existsSync(file('edit.json')),false);

  plan.resolve = 'facing';
  assert.equal(assemble('--sdf-assist','on').conflicts[0].winner.view,'front');
  delete plan.resolve;
  plan.overrides = [{ cell:[3,3],view:'quarter',pixel:[37,27] }];
  const result = assemble(...request);
  assert.equal(result.conflicts[0].winner.view,'quarter');
  assert.equal(result.status,'ready');
  assert.equal(result.views[2].accepted,0);
  assert.equal(result.views[2].ignored,1);
  assert.ok(result.views[2].counts.changed > 0);
  const patch = read('edit.json');
  assert.equal(patch.operation.stamps.length,1);
  assert.equal(patch.operation.stamps[0].value,'#55dbca');
  assert.equal(patch.sourceRevision,result.sourceRevision);
  assert.equal(patch.revision,result.documentRevision);

  const receipt = JSON.parse(cli('edit',file('design.json'),file('edit.json'),'--scene',file('scene.json'),'--out',file('edited.json')));
  save('receipt.json',receipt);
  cli('replay',file('design.json'),file('receipt.json'),'--scene',file('scene.json'),'--out',file('replayed.json'));
  assert.deepEqual(read('edited.json'),read('replayed.json'));
  assert.deepEqual(read('scene.json'),scene);
  assert.equal(receipt.affectedTargets.length,1);
  assert.deepEqual(read('edited.json').solids[0].surfaceState.charts.face.stamps,
    patch.operation.stamps.map(stamp=>({...stamp,channel:'paint'})));

  plan.sourceRevision = result.sourceRevision;
  scene.solids[0].half[0] += .06;
  save('scene.json',scene);
  assert.throws(()=>assemble('--sdf-assist','on'),/different scene revision/);
  assert.throws(()=>cli('edit',file('design.json'),file('edit.json'),'--scene',file('scene.json'),'--out',file('bad.json')),
    /Inspected scene source or binding has changed/);
  assert.equal(fs.existsSync(file('bad.json')),false);
});

test('native verification shows view seams and splat spill in an unpainted camera',t=>{
  const { assemble } = fixture(t);
  const traced = assemble('--sdf-assist','on');
  const splats = assemble();
  for (const report of [traced,splats]) {
    assert.equal(report.status,'ready');
    const heldOut = report.views[2];
    assert.ok(heldOut.counts.seams > 0);
    assert.ok(heldOut.runs.seams.length > 0);
    assert.ok(heldOut.counts.changed > 0);
  }
  assert.equal(traced.views[2].counts.bleed,0);
  assert.ok(splats.views[2].counts.bleed > 0);
  assert.ok(splats.views[2].runs.bleed.length > 0);
});

test('unverified, protected and stale view marks require review before a patch can be written',t=>{
  const { file,save,design,plan,assemble } = fixture(t);
  design.protectedDetails = [{ id:'glint',pixels:[[38,27]] }];
  design.sceneBindings[0].stale = [[27,39,1]];
  save('design.json',design);
  plan.views[1].marks.push(mark(0,'cyan'));
  const result = assemble('--sdf-assist','on');
  assert.equal(result.status,'needs-review');
  assert.deepEqual(result.views[0].rejected.map(row=>row.reason),['protected-pixel','stale-binding-pixel']);
  assert.equal(result.views[1].rejected[0].reason,'outside-visible-target');
  assert.equal(result.views[0].counts.rejected,2);
  assert.equal(fs.existsSync(file('edit.json')),false);
});

test('the offline review overlays seams and bleed on the held-out view',{skip:!process.env.INK_TEST_CHROME},async t=>{
  const { directory,file,assemble } = fixture(t);
  const report = assemble('--review',file('review.html'));
  const [y,x] = report.views[2].runs.bleed[0];
  await withChrome(directory,{hardware:true},async browser=>{
    await browser.send('Page.navigate',{url:pathToFileURL(file('review.html')).href});
    for (let i=0;i<100;i++) {
      if (await browser.evaluate("document.querySelector('#view option:nth-child(3)')?.textContent === 'check'")) break;
      await pause(30);
    }
    await browser.evaluate(`document.querySelector('#view').selectedIndex=2;
      document.querySelector('#overlay').value='bleed';
      document.querySelector('#overlay').dispatchEvent(new Event('change'));`);
    let shown;
    for (let i=0;i<100;i++) {
      shown = await browser.evaluate(`document.querySelector('.ink-grid-diagnostic')?.getContext('2d').getImageData(${x},${y},1,1).data[3]`);
      if (shown) break;
      await pause(30);
    }
    assert.ok(shown);
    assert.match(await browser.evaluate("document.querySelector('#status').textContent"),/0 approved marks.*possible bleed pixels/);
  });
});
