const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPixelEditor } = require('..');
const Motion = require('../src/pixel-motion-checks.js');

const colors = [0x273945,0xf4f9ba,0x9d3667];
function frame(id,rows,meta) {
  const width = rows[0].length, height = rows.length;
  const slots = rows.flatMap(row=>[...row].map(char=>char === '.' ? -1 : Number(char)));
  return Motion.fromRaster({ width,height,slots,colors },{ id,...meta });
}

test('registered movement follows the part and reports the exact drifting highlight',()=>{
  const first = frame('front',[
    '........','..0000..','..0100..','..0000..','........'
  ],{ anchor:[2.5,1.5] });
  const stable = frame('shifted',[
    '........','...0000.','...0100.','...0000.','........'
  ],{ anchor:[3.5,1.5] });
  const corrected = Motion.audit([first,stable]);
  assert.deepEqual(corrected.transitions[0].shift,[1,0]);
  assert.deepEqual(corrected.findings,[]);
  const movingLight = frame('drifting',[
    '........','...0000.','...0010.','...0000.','........'
  ],{ anchor:[3.5,1.5] });
  const hit = Motion.audit([first,movingLight]).findings.find(row=>row.kind === 'highlight');
  assert.deepEqual(hit.evidence.map(row=>row.at),[[3,2],[5,2]]);
  assert.equal(hit.drift.distance,1);
  assert.deepEqual(hit.runs,[[2,5,1]]);
  assert.equal(Motion.audit([first,{ ...stable,anchor:[3,1.5] }]).transitions[0].skipped,'fractional-registration');
  assert.equal(Motion.audit([first,{ ...stable,anchor:undefined }]).transitions[0].skipped,'missing-registration');
});

test('native checks find cluster splitting, filled openings and A–B–A flicker separately',()=>{
  const a = frame('a',[
    '.........','..00000..','..0.0.0..','..00000..','.........','..00000..','.........'
  ]);
  const b = frame('b',[
    '.........','..00000..','..000.0..','..00000..','.........','..00.00..','.........'
  ]);
  const report = Motion.audit([a,b,{ ...a,id:'c' }]);
  assert.ok(report.transitions[0].splits > 0);
  assert.ok(report.transitions[1].merges > 0);
  assert.deepEqual(report.findings.find(row=>row.kind === 'gap').at,[3,2]);
  assert.deepEqual(report.findings.find(row=>row.kind === 'gap').evidence.map(row=>row.rgba[3]),[0,255]);
  const flash = report.findings.find(row=>row.kind === 'flicker' && row.at[0] === 4);
  assert.deepEqual(flash.evidence.map(row=>row.rgba[3]),[255,0,255]);
  const cut = Motion.audit([a,{ ...b,cut:true },{ ...a,id:'c' }]);
  assert.equal(cut.transitions[0].skipped,'cut');
  assert.equal(cut.counts.flicker.pixels,0);
  const intentional = Motion.audit([a,b,{ ...a,id:'c' }],{ ignore:[
    { sample:'b',kind:'gap',rect:[3,2,1,1],reason:'The gate closes.' }
  ] });
  assert.equal(intentional.counts.gap.acceptedPixels,1);
  assert.equal(intentional.exceptions[0].reason,'The gate closes.');
  assert.equal(intentional.counts.gap.pixels,0);
});

test('surface correspondence masks disocclusions and many-to-one mappings',()=>{
  const left = frame('a',['......','.000..','......'],{ cameraKey:'one' });
  const right = frame('b',['......','..000.','......'],{ cameraKey:'two' });
  const valid = new Uint8Array(18), vectors = new Float32Array(36);
  for (const p of [8,9,10]) { valid[p] = 255; vectors[2*p] = 1; }
  assert.equal(Motion.audit([left,right]).transitions[0].skipped,'unregistered-camera');
  const tracked = Motion.audit([left,{ ...right,valid,vectors }],{ alignment:'surface' });
  assert.equal(tracked.transitions[0].pairedPixels,3);
  assert.deepEqual(tracked.findings,[]);
  vectors[2*9] = 2;
  assert.equal(Motion.audit([left,{ ...right,valid,vectors }],{ alignment:'surface' }).transitions[0].pairedPixels,1);
});

function document() {
  const frame = (id,x,spot='dim')=>({ id,durationMs:id === 'steady' ? 200 : 100,cels:{
    paint:{ marks:[{ shape:{ type:'rect',rect:[x,1,4,3] },swatch:'dim' },{ at:[x+1,2],swatch:spot }] }
  } });
  return { format:'ink-studio/pixel-art',version:2,width:8,height:5,pixelAspect:[1,1],
    palette:{ dim:'#273945',bright:'#f4f9ba' },layers:[{ id:'paint' }],
    frames:[frame('before',1),frame('blink',2,'bright'),frame('steady',2)],
    guides:[{ id:'origin-a',kind:'registration',frame:'before',at:[1,1] },
      { id:'origin-b',kind:'registration',frame:'blink',at:[2,1] },
      { id:'origin-c',kind:'registration',frame:'steady',at:[2,1] }]
  };
}

test('the editor and CLI use registration guides and export a portable motion review',t=>{
  const source = document(), editor = createPixelEditor(source);
  const defaultReport = editor.motion({ layer:'paint' });
  assert.deepEqual(defaultReport.samples.map(row=>row.durationMs),[100,100,200]);
  assert.deepEqual(defaultReport.findings.find(row=>row.kind === 'flicker').evidence.map(row=>row.at),[[2,2],[3,2],[3,2]]);
  assert.equal(editor.motion({ plan:{ version:1,samples:[{ frame:'before' },{ frame:'blink',cut:true },{ frame:'steady' }] } }).counts.flicker.pixels,0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-motion-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const design = path.join(dir,'design.json'), review = path.join(dir,'review.html'), out = path.join(dir,'report.json');
  fs.writeFileSync(design,JSON.stringify(source));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js',...args],{ cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  cli('pixel-art','motion',design,'--layer','paint','--out',out,'--review',review);
  assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')),JSON.parse(JSON.stringify(defaultReport)));
  assert.match(fs.readFileSync(review,'utf8'),/data:image\/png;base64/);

  const scene = path.join(dir,'scene.json'), views = path.join(dir,'views.json');
  fs.writeFileSync(scene,JSON.stringify({ id:'motion-plate',style:'slate',
    camera:{ target:[0,0,0],dist:4,pitch:0,yaw:0,projection:'orthographic' },
    solids:[{ id:'plate',kind:'box',at:[0,0,0],half:[1,.7,.25],res:.12,mat:'stone' }] }));
  const samples = [{ id:'front',time:0,camera:{ yaw:0 } },{ id:'orbit',time:.1,camera:{ yaw:.09 } },
    { id:'cut',time:.2,camera:{ yaw:-.7 },cut:true }];
  fs.writeFileSync(views,JSON.stringify({ version:1,settings:{ alignment:'surface' },samples }));
  const rendered = JSON.parse(cli('pixel-art','motion',scene,'--views',views,'--subject','plate','--w','56','--h','40'));
  assert.deepEqual(rendered.grid,[56,40]);
  assert.equal(rendered.samples[1].camera.yaw,.09);
  assert.ok(rendered.transitions[0].pairedPixels > 0);
  assert.equal(rendered.transitions[1].skipped,'cut');
});
