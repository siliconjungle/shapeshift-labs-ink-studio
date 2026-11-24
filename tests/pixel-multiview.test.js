const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout:pause } = require('node:timers/promises');
const { withChrome } = require('../cli/canvas-grid-chrome.js');
const { KIT } = require('..').load();

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

test('inspection exposes chart edges and padding without paint, and checks signed facing and depth',t=>{
  const { file,save,scene,plan,assemble } = fixture(t);
  const face=scene.solids[0].surfaceState.charts.face;
  Object.assign(face,{padding:[.08,.06],twoSided:true,depth:.08});
  face.origin[2]=.25;
  save('scene.json',scene);
  const [front,quarter,back]=plan.views;
  Object.assign(back,{camera:{yaw:Math.PI},marks:[mark(39,'cyan')]});
  for (const view of plan.views) view.approved=false;
  plan.projection={minFacing:.98,maxDepth:.035,padding:[0,1]};
  const inspection=assemble('--sdf-assist','on');
  assert.equal(inspection.status,'inspection');
  assert.equal(inspection.cells,0);
  assert.deepEqual(inspection.projection.inset,[1,1]);
  assert.ok(inspection.views[0].counts.chartEdges>0);
  assert.ok(inspection.views[0].counts.padding>0);
  assert.ok(inspection.views[1].counts.grazing>0);
  assert.ok(inspection.views[2].counts.backfaces>0);
  assert.throws(()=>assemble('--sdf-assist','on','--patch',file('inspect.json')),error=>error.status===2);
  assert.ok(!fs.existsSync(file('inspect.json')));

  const [y,x]=inspection.views[0].runs.padding[0];
  front.marks=[{at:[x,y],swatch:'cyan'},mark(39,'cyan')];
  for (const view of plan.views) view.approved=true;
  plan.projection.maxDepth=.01;
  const depth=assemble('--sdf-assist','on');
  assert.equal(depth.status,'needs-review');
  assert.equal(depth.views[0].rejected[1].reason,'projection-depth');
  assert.ok(depth.views[0].rejected[1].distance>.01);
  assert.equal(depth.views[1].rejected[0].reason,'grazing-angle');
  assert.ok(depth.views[1].rejected[0].facing<.98);
  assert.equal(depth.views[2].rejected[0].reason,'backface');
  assert.ok(depth.views[2].rejected[0].chartFacing<0);
  plan.projection.maxDepth=.035;
  const padded=assemble('--sdf-assist','on');
  assert.equal(padded.views[0].rejected[0].reason,'protected-chart-padding');
  assert.equal(padded.views[0].accepted,1);
});

test('the applied patch preserves authored edge paint and keeps the projected depth and side limits',t=>{
  const { file,save,read,scene,plan,assemble } = fixture(t);
  const state=scene.solids[0].surfaceState, face=state.charts.face;
  const full={kind:'rect',min:[0,0],max:[1,1]};
  Object.assign(face,{padding:[.08,.06],twoSided:true,depth:.08,
    stamps:[{channel:'paint',value:'#ee935f',brush:{...full,max:[.08,1]}}]});
  save('scene.json',scene);
  plan.views[0].marks=[mark(39,'cyan')];
  plan.views[1].approved=false;
  plan.projection={maxDepth:.03,padding:[1,1]};
  const report=assemble('--sdf-assist','on','--patch',file('edit.json'));
  assert.equal(report.status,'ready');
  const [stamp]=read('edit.json').operation.stamps;
  assert.deepEqual(stamp.projection,{maxDepth:.03,frontOnly:true});
  cli('edit',file('design.json'),file('edit.json'),'--scene',file('scene.json'),'--out',file('edited.json'));
  const applied=read('edited.json').solids[0].surfaceState;
  assert.deepEqual(applied.charts.face.stamps[1].clip,{min:[.08,.06],max:[.92,.94]});
  assert.deepEqual(applied.charts.face.stamps[0],face.stamps[0]);
  const atY=stamp.brush.rows.findIndex(row=>row.includes('#')), atX=stamp.brush.rows[atY].indexOf('#');
  const center=[-.8+1.6*(atX+.5)/8,-.7+1.4*(1-(atY+.5)/8),.23];
  const locate=KIT.procedural.surfaceState.projection(applied);
  const sample=(p,normal)=>locate(p,normal)?.values.paint;
  assert.deepEqual(sample(center,[0,0,1]).color,[0x55,0xdb,0xca].map(n=>n/255));
  assert.equal(sample([center[0],center[1],.28],[0,0,1]),null);
  assert.equal(sample(center,[0,0,-1]),null);

  const direct={id:'clear-chart',frame:'art',destination:'paint',revision:report.documentRevision,
    operation:{stamp:{brush:full,mode:'clear'}}};
  save('scene.json',read('edited.json'));
  save('direct.json',direct);
  cli('edit',file('design.json'),file('direct.json'),'--scene',file('scene.json'),'--out',file('cleared.json'));
  const cleared=KIT.procedural.surfaceState.projection(read('cleared.json').solids[0].surfaceState);
  assert.equal(cleared(center,[0,0,1]).values.paint,null);
  assert.ok(cleared([-.76,0,.23],[0,0,1]).values.paint);
});

test('the offline review overlays seams and bleed on the held-out view',{skip:!process.env.INK_TEST_CHROME},async t=>{
  const { directory,file,assemble,plan } = fixture(t);
  plan.projection={padding:[1,1]};
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
    assert.ok(report.views[2].runs.padding.length);
    const [padY,padX]=report.views[2].runs.padding[0];
    await browser.evaluate("document.querySelector('#overlay').value='padding'; document.querySelector('#overlay').dispatchEvent(new Event('change'))");
    for (let i=0;i<100;i++) {
      shown=await browser.evaluate(`document.querySelector('.ink-grid-diagnostic').getContext('2d').getImageData(${padX},${padY},1,1).data[3]`);
      if (shown) break;
      await pause(30);
    }
    assert.ok(shown);
  });
});

test('a tracked rest edit writes chart paint and verifies it on a moved part',t=>{
  const { file,save,read,scene,design } = fixture(t);
  scene.parts = { shell:{ joint:[0,0,0] } };
  scene.solids[0].part = 'shell';
  design.sceneBindings[0].part = 'shell';
  scene.timeline = { duration:1,tracks:[{ target:'/poses/shell/translation',
    keys:[{ time:0,value:[0,0,0],ease:'linear' },{ time:1,value:[.3,0,0] }] }] };
  save('scene.json',scene);
  save('design.json',design);
  const plan = { format:'ink-studio/pixel-tracked-correction',version:2,id:'tracked-surface',binding:'plate',
    target:{ kind:'rest',destination:'paint',size:[8,8] },marks:[{ kind:'highlight',at:[38,27],swatch:'orange' }],
    samples:[{ id:'reference',time:0 },{ id:'posed',time:1 }] };
  save('track.json',plan);
  const run = (...args)=>JSON.parse(cli('correct',file('design.json'),file('track.json'),'--sdf-assist','posed',...args));
  const preview = run('--review',file('motion.html'));
  assert.equal(preview.target,'rest');
  assert.equal(preview.status,'ready');
  assert.equal(preview.views[0].accepted,1);
  assert.ok(preview.views[1].counts.changed > 0);
  const applied = run('--apply',file('posed.json'),'--patch',file('track-edit.json'),'--approval',preview.approval);
  assert.equal(applied.resultRevision,preview.resultRevision);
  assert.deepEqual(read('scene.json'),scene);
  assert.equal(read('posed.json').solids[0].surfaceState.charts.face.stamps[0].value,'#ee935f');
  assert.equal(read('track-edit.json').sourceRevision,preview.sourceRevision);
  scene.solids[0].surfaceState.charts.face.depth = .05;
  save('scene.json',scene);
  assert.throws(()=>run('--apply',file('rejected.json'),'--approval',preview.approval),/approval is stale/);
  assert.equal(fs.existsSync(file('rejected.json')),false);
});
