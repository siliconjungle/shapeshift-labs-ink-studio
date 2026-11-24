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

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-track-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const file = name=>path.join(directory,name);
  const write = (name,value)=>{
    fs.writeFileSync(file(name),typeof value === 'string' ? value : JSON.stringify(value));
    return file(name);
  };
  return { directory,file,write };
}

function setup({ write },binding,pixels,samples,grid = [64,48]) {
  const [width,height] = grid;
  const design = { format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],
    palette:{ bronze:'#bb763e' },layers:[{ id:'ink' }],
    frames:[{ id:'key',durationMs:100,cels:{} }],
    selections:[{ id:'accent',frame:'key',pixels }],
    sceneBindings:[{ id:'study',frame:'key',...binding }] };
  const document = write('design.json',design), plan = write('plan.json',{version:1,samples});
  const run = (...options)=>JSON.parse(cli('track',document,'--selection','accent','--binding','study','--views',plan,...options));
  return { run,document };
}

function scene({ write },overlap = false) {
  return write('animated.js',`module.exports = ({KIT:K,makeBuilder,SpriteSurface}) => ({
    id:'tracked-splats',name:'Tracked splats',build() {
      const B = makeBuilder(12,[0x222234,0xeea729,0x469c89]);
      B.iso(0,0,0,.3,B.P[1],3,{splatId:'moving-rest'});
      B.describeSplats(0,1,{object:'assembly',target:{entity:'plant',part:'stem'}});
      if (${overlap}) {
        B.iso(0,0,.2,.3,B.P[1],.35,{nd:true,splatId:'stem-overlap'});
        B.describeSplats(1,2,{object:'assembly',target:{entity:'plant',part:'stem'}});
      }
      const cover = SpriteSurface.make(16);
      const points = [1,-.8,.8, 3,-.8,.8, 2,1,.8];
      cover.meshRegion({points,restPoints:points,uvs:[0,0,1,0,.5,1],triangles:[0,1,2]},
        cover.reserve(4,4,()=>0x469c89),{id:'cover-chart',objectId:'cover'});
      const surface = cover.finish(), rest = surface.vertices.slice();
      const world = B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,ortho:true},radius:10,dither:0});
      world.spriteSurfaces = surface;
      K.stage(world).add({pre(_dt,t) {
        const beat = Math.round(t);
        world.data[0] = beat === 0 || beat >= 4 ? 0 : beat === 3 ? 7 : .45;
        for (let i=0;i<rest.length;i+=5) {
          surface.vertices[i] = rest[i]-(beat === 2 || beat === 5 ? 1.55 : 0);
          surface.vertices[i+2] = rest[i+2]+.08*Math.sin(t);
        }
        surface.vertices[3] = rest[3]+(beat === 5 ? .05 : 0);
        SpriteSurface.markGeometryDirty(surface);
      }});
      return world;
    }
  });`);
}

const count = (visible,moved,occluded,lost)=>({ visible,moved,occluded,lost });

test('stable splat selection follows pose and camera, records depth occlusion, and returns after a loss',t=>{
  const space = workspace(t), binding = { scene:scene(space),object:'plant',part:'stem' };
  const samples = [{ id:'rest',time:0 },{ id:'shifted',time:1 },{ id:'hidden',time:2 },{ id:'outside',time:3 },
    { id:'back',time:0,cut:true },{ id:'camera',time:0,camera:{ target:[.4,0,0],yaw:0,pitch:0,ortho:true } }];
  const { run,document } = setup(space,binding,[[32,24],[33,24],[0,0]],samples);
  const report = run();
  assert.deepEqual(report.samples.map(row=>row.counts),[
    count(2,0,0,1),count(2,2,0,1),count(0,0,2,1),count(0,0,0,3),count(2,0,0,1),count(2,2,0,1)
  ]);
  const [rest,shifted,hidden,outside,back,camera] = report.samples;
  assert.equal(rest.examples[0].source.id,'moving-rest');
  assert.deepEqual(shifted.runs.moved,[[24,40,2]]);
  assert.deepEqual(hidden.runs.occluded,shifted.runs.moved);
  assert.equal(hidden.examples[0].blocker.object,'cover');
  assert.equal(outside.reasons['outside-view'],2);
  assert.deepEqual(outside.runs.lost,[[0,0,1],[24,32,2]]);
  assert.deepEqual(back.runs.visible,rest.runs.visible);
  assert.deepEqual(camera.runs.moved,[[24,25,2]]);
  assert.deepEqual(run(),report);
  assert.deepEqual(JSON.parse(fs.readFileSync(document)).selections[0].pixels,[[32,24],[33,24],[0,0]]);
  assert.throws(()=>run('--out',document),/separate paths/);
});

test('mesh barycentrics follow the posed triangle from a registered crop and reject changed topology addresses',t=>{
  const space = workspace(t), binding = { scene:scene(space),object:'cover',
    canvas:{ size:[64,48],offset:[61,23],scale:[1,1] } };
  const samples = [{ id:'rest',time:0 },{ id:'moved',time:2,camera:{ yaw:.16,pitch:.07,ortho:false } },
    { id:'uv-changed',time:5 },{ id:'back',time:0,cut:true }];
  const { run } = setup(space,binding,[[0,0],[1,0]],samples,[2,1]);
  const report = run(), [rest,moved,changed,back] = report.samples;
  assert.deepEqual(report.grid,[64,48]);
  assert.deepEqual(report.documentGrid,[2,1]);
  assert.deepEqual(rest.examples[0].referenceAt,[61,23]);
  assert.equal(rest.examples[0].source.chart,'cover-chart');
  assert.equal(rest.examples[0].source.triangle,0);
  assert.deepEqual(moved.counts,count(2,2,0,0));
  assert.deepEqual(changed.counts,count(0,0,0,2));
  assert.deepEqual(back.runs.visible,rest.runs.visible);
});

test('traced SDF locations reproject through a camera orbit and detect self-occlusion on the same field',t=>{
  const space = workspace(t), file = space.write('sdf.json',{ id:'plate-study',style:'slate',
    camera:{ target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0,projection:'orthographic' },
    solids:[{ id:'plate',kind:'box',at:[0,0,0],half:[.9,.6,.25],res:.1,mat:'stone' }] });
  const views = [{ id:'front',time:0 },
    { id:'orbit',time:0,camera:{ target:[.25,0,0],yaw:.3,pitch:.12,ortho:true } },
    { id:'behind',time:0,camera:{ yaw:Math.PI,pitch:0,ortho:true } }];
  const { run } = setup(space,{ scene:file,object:'plate' },[[32,24],[34,24]],views);
  const [front,orbit,behind] = run('--sdf-assist','on').samples;
  assert.equal(front.examples[0].source.kind,'sdf');
  assert.ok(Math.abs(front.examples[0].source.local[2]-.25) < .01);
  assert.deepEqual(orbit.counts,count(2,2,0,0));
  assert.deepEqual(behind.counts,count(0,0,2,0));
  assert.equal(behind.examples[0].blocker.object,'plate');
});

test('overlapping contributors stay unresolved in the standalone review',t=>{
  const space = workspace(t), binding = { scene:scene(space,true),object:'plant' };
  const html = space.file('track.html');
  const { run } = setup(space,binding,[[32,24]],[
    { id:'start',time:0 },{ id:'later',time:1 }
  ]);
  const [start,later] = run('--review',html).samples;
  assert.equal(start.reasons['reference-ambiguous-source'],1);
  assert.deepEqual(later.runs.lost,[[24,32,1]]);
  assert.match(fs.readFileSync(html,'utf8'),/data:image\/png;base64/);
});

test('the standalone review shows lost marks over the reference grid',{ skip:!process.env.INK_TEST_CHROME },async t=>{
  const space = workspace(t), binding = { scene:scene(space),object:'plant' };
  const html = space.file('track.html');
  const { run } = setup(space,binding,[[32,24]],[{ id:'start',time:0 },{ id:'gone',time:3 }]);
  run('--review',html);
  await withChrome(space.directory,{ hardware:true },async browser=>{
    await browser.send('Page.navigate',{ url:pathToFileURL(html).href });
    let status;
    for (let i=0;i<120 && !status?.includes('1 lost');i++) {
      status = await browser.evaluate("document.querySelector('#summary')?.textContent");
      await pause(25);
    }
    assert.match(status,/1 lost/);
    await browser.evaluate("document.querySelector('#mark').value='lost'; document.querySelector('#mark').dispatchEvent(new Event('change'));");
    let alpha = 0;
    for (let i=0;i<120 && !alpha;i++) {
      alpha = await browser.evaluate(
        "document.querySelector('.ink-grid-diagnostic').getContext('2d').getImageData(32,24,1,1).data[3]");
      await pause(25);
    }
    assert.ok(alpha > 0);
    assert.match(await browser.evaluate("document.querySelector('#summary').textContent"),/reference view/);
  });
});

function correctionDemo(space) {
  const source = scene(space), frames = ['rest','shifted','hidden','outside','back'];
  const document = {
    format:'ink-studio/pixel-art',version:2,width:64,height:48,pixelAspect:[1,1],
    palette:{ bronze:'#bb763e',light:'#f7ca84',ink:'#262039' },layers:[{ id:'ink' }],
    frames:frames.map((id,i) => ({ id,durationMs:100,cels:{ ink:{ marks:[
      { swatch:'bronze',runs:[[24,i > 0 && i < 4 ? 40 : 32,3]] }
    ] } } })),
    protectedDetails:[{ id:'locked-accent',kind:'accent',frame:'back',pixels:[[32,24]] }],
    sceneBindings:[{ id:'study',scene:source,object:'assembly',frame:'rest' }]
  };
  const plan = {
    format:'ink-studio/pixel-tracked-correction',version:1,id:'enamel-edge',binding:'study',layer:'ink',
    marks:[
      { kind:'highlight',at:[32,24],swatch:'light' },
      { kind:'contour',at:[33,24],swatch:'ink' },
      { kind:'gap',at:[34,24],swatch:null,anchors:[[33,24],[35,24]] }
    ],
    samples:frames.map((frame,i) => ({ id:frame,frame,time:i === 4 ? 0 : i,...(i === 4 && { cut:true }) }))
  };
  const input = space.write('correction-input.json',document), planFile = space.write('correction-plan.json',plan);
  return { document, input, planFile, source, run:(...args) => JSON.parse(cli('correct',input,planFile,...args)) };
}

test('approved corrections propagate per pixel and leave blocked, lost and protected edits for review',t=>{
  const space = workspace(t), { document,input,run } = correctionDemo(space);
  const resultFile = space.file('corrected.json'), review = space.file('correction.html');
  const preview = run('--review',review);
  const [rest,shifted,hidden,outside,back] = preview.frames;
  assert.equal(preview.mode,'preview');
  assert.deepEqual(rest.marks.map(mark=>mark.status),['verified','verified','verified']);
  assert.deepEqual(shifted.marks.map(mark=>mark.at),[[40,24],[41,24],[42,24]]);
  assert.equal(hidden.marks[0].correspondence.blocker.object,'cover');
  assert.equal(hidden.marks[2].reason,'gap-anchor-unresolved');
  assert.equal(outside.marks[0].reason,'outside-view');
  assert.equal(back.marks[0].reason,'protected-pixel');
  assert.deepEqual(preview.unresolvedFrames,['hidden','outside','back']);
  assert.match(fs.readFileSync(review,'utf8'),/Correction preview/);
  assert.throws(()=>run('--apply',resultFile),/--approval/);
  assert.throws(()=>run('--apply',input,'--approval',preview.approval),/separate output paths/);
  const applied = run('--apply',resultFile,'--approval',preview.approval);
  assert.equal(applied.mode,'applied');
  assert.equal(applied.resultRevision,preview.resultRevision);
  const corrected = JSON.parse(fs.readFileSync(resultFile));
  const editor = require('..').createPixelEditor(corrected);
  const sample = at => editor.sample(at,{ mode:'layer',frame:'shifted',layer:'ink' }).swatch;
  assert.equal(sample([40,24]),'light');
  assert.equal(sample([41,24]),'ink');
  assert.equal(sample([42,24]),null);
  assert.deepEqual(corrected.frames.slice(2,4),document.frames.slice(2,4));
  assert.deepEqual(JSON.parse(fs.readFileSync(input)),document);
});

test('an approval expires when the document or rendered tracking evidence changes',t=>{
  const space = workspace(t);
  const { document, input, run, source } = correctionDemo(space);
  const { approval } = run(), out = space.file('corrected.json');
  const changed = structuredClone(document);
  changed.palette.ink = '#322c42';
  fs.writeFileSync(input,JSON.stringify(changed));
  assert.throws(()=>run('--apply',out,'--approval',approval),/approval is stale/);
  fs.writeFileSync(input,JSON.stringify(document));
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('7 : .45','7 : .57'));
  assert.throws(()=>run('--apply',out,'--approval',approval),/approval is stale/);
  assert.equal(fs.existsSync(out),false);
});

test('the correction review jumps to unresolved frames and retains scene evidence',
  { skip:!process.env.INK_TEST_CHROME },async t=>{
    const space = workspace(t), { run } = correctionDemo(space);
    const html = space.file('correction.html');
    run('--review',html);
    await withChrome(space.directory,{ hardware:true },async browser=>{
      await browser.send('Page.navigate',{ url:pathToFileURL(html).href });
      let status;
      for (let i=0;i<120 && !status?.includes('shifted');i++) {
        status = await browser.evaluate("document.querySelector('#sample-summary')?.textContent");
        await pause(25);
      }
      assert.match(status,/shifted.*3 verified/);
      await browser.evaluate("document.querySelector('#pending').click()");
      assert.match(await browser.evaluate("document.querySelector('#sample-summary').textContent"),/hidden.*3 unresolved/);
      assert.match(await browser.evaluate("document.querySelector('tbody').textContent"),/Occluded · cover/);
      assert.equal(await browser.evaluate("document.querySelectorAll('#samples button').length"),3);
    });
  });

test('a motion edit attaches projected paint to explicit cels and keeps other holds unchanged',t=>{
  const space = workspace(t), { document,input,planFile,run } = correctionDemo(space);
  document.layers.push({ id:'accent' });
  document.frames[0].cels.ink.id = 'reference-ink';
  document.frames[1].cels.ink = { id:'moving-ink',hold:'reference-ink' };
  document.frames[1].cels.accent = { id:'moving-accent',marks:[] };
  document.frames[2].cels.ink = { id:'quiet-hold',hold:'moving-ink' };
  fs.writeFileSync(input,JSON.stringify(document));
  const { layer,samples,...old } = JSON.parse(fs.readFileSync(planFile));
  const plan = { ...old,version:2,target:{ kind:'cels' },samples:samples.map(({ frame,...view },i)=>({
    ...view,...(i === 1 ? { cels:['moving-ink','moving-accent'] } : i === 2 ? { cels:['quiet-hold'] } : {})
  })),marks:old.marks.slice(0,1) };
  fs.writeFileSync(planFile,JSON.stringify(plan));
  const preview = run('--review',space.file('motion.html'));
  assert.equal(preview.target,'cels');
  assert.deepEqual(preview.frames[1].marks.map(({ at,cel })=>({ at,cel })),[
    { at:[40,24],cel:'moving-ink' },{ at:[40,24],cel:'moving-accent' }
  ]);
  assert.equal(preview.frames[2].marks[0].reason,'occluded');
  const patchFile = space.file('edit-cels.json'), documentFile = space.file('revised.json');
  const applied = run('--apply',documentFile,'--patch',patchFile,'--approval',preview.approval);
  const patch = JSON.parse(fs.readFileSync(patchFile)), revised = JSON.parse(fs.readFileSync(documentFile));
  const editor = require('..').createPixelEditor(document);
  assert.equal(patch.operation.type,'write-cels');
  assert.deepEqual(editor.apply(patch),revised);
  assert.equal(applied.resultRevision,editor.timeline().revision);
  assert.equal(editor.snapshot().frames[2].cels.ink.hold,'reference-ink');
  assert.equal(editor.sample([32,24],{ frame:'hidden',mode:'layer',layer:'ink' }).swatch,'bronze');
  assert.equal(editor.sample([40,24],{ frame:'shifted',mode:'layer',layer:'accent' }).swatch,'light');
  editor.undo();
  assert.deepEqual(editor.snapshot(),document);
});

test('a tracked shot emits exact keys and skips occlusion and unauthored frames',t=>{
  const space = workspace(t), { planFile,run,source } = correctionDemo(space);
  const prior = JSON.parse(fs.readFileSync(planFile));
  const plan = { format:prior.format,version:2,id:'moving-accent',binding:prior.binding,
    target:{ kind:'shot',frames:[0,3],fps:1 },marks:prior.marks.slice(0,1),
    samples:prior.samples.slice(0,3).map(({ frame,...view },shotFrame)=>({ ...view,shotFrame })) };
  fs.writeFileSync(planFile,JSON.stringify(plan));
  const preview = run('--review',space.file('shot.html'));
  assert.equal(preview.artifact,'shot-corrections');
  assert.deepEqual(preview.frames.map(row=>[row.frame,row.counts.verified,row.counts.unresolved]),[[0,1,0],[1,1,0],[2,0,1]]);
  assert.deepEqual(preview.frames[1].marks[0].at,[40,24]);
  assert.equal(preview.frames[1].marks[0].pin.splat,'moving-rest');
  const asset = space.file('shot.json');
  run('--apply',asset,'--approval',preview.approval);
  const corrections = JSON.parse(fs.readFileSync(asset));
  assert.deepEqual(corrections.corrections[0].keys.map(row=>[row.frame,row.pixels.length]),[[0,1],[1,1],[2,0]]);
  const ink = require('..');
  const kit = ink.load(), build = () => require(source)(kit).build();
  for (const [t,position] of [[0,[32,24]],[1,[40,24]],[2,null],[3,null]]) {
    const world = build();
    require('../cli/diarama-pose.js').pose(world,t,{ kit });
    const options = { w:64,h:48,px:1,t,raw:true };
    const current = ink.render(world,{ ...options,shotCorrections:corrections });
    if (position) {
      const index = (position[1]*64+position[0])*3;
      assert.deepEqual(Array.from(current.rgb.slice(index,index+3)),[247,202,132]);
      assert.equal(current.shotCorrections.corrections[0].painted,1);
    } else assert.deepEqual(current.rgb,ink.render(world,options).rgb);
  }
  plan.samples[1].time = 1.5;
  fs.writeFileSync(planFile,JSON.stringify(plan));
  assert.throws(()=>run(),/times on the shot clock/);
});
