'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const PNG = require('../cli/png.js');
const ink = require('..');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const native = [6,4];
const [width,height] = native;
const colors = [[172,74,50],[172,74,50],[37,177,160]];
const full = {kind:'rect',min:[0,0],max:[1,1]};
const getUV = (doc,[x,y])=>{
  const {size,offset,scale} = doc.sceneBindings[0].canvas;
  return [(offset[0]+(x+.5)*scale[0])/size[0],1-(offset[1]+(y+.5)*scale[1])/size[1]];
};
const chart = scene=>scene.solids[0].surfaceState.charts.face;
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));

function space(t,channel,stamps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-bound-paint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name), save = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const scene = {
    id:'painted-part',style:'slate',solids:[{
      id:'plate',kind:'box',at:[0,0,0],half:[.8,.7,.23],res:.075,mat:'stone',
      surfaceState:{charts:{face:{origin:[-.8,-.7,.23],u:[1.6,0,0],v:[0,1.4,0],padding:[.2,.1],stamps}}}
    }]
  };
  const document = {
    format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[2,1],
    palette:{brick:'#ac4a32',oxide:'#ac4a32',mint:'#25b1a0'},
    layers:[{id:'clip',kind:'mask'},{id:'coat',kind:'surface',destination:'paint-face',clip:'clip'}],
    frames:[{id:'art',durationMs:100,cels:{
      clip:{marks:[{swatch:'brick',shape:{type:'rect',rect:[0,0,width,height]}},{clear:true,runs:[[2,2,1]]}]}
    }}],
    protectedDetails:[{id:'keep',kind:'accent',pixels:[[1,1]],frame:'art'}],
    sceneBindings:[{id:'plate',scene:file('scene.json'),object:'plate',frame:'art',layer:'coat',
      canvas:{size:[8,6],offset:[1,1],scale:[1,1]},stale:[[3,3,1]]}],
    destinations:[{id:'paint-face',kind:'surface-channel',binding:'plate',chart:'face',channel}]
  };
  save('source.ink.json',document);
  save('scene.json',scene);
  const call = (args,status = 0)=>{
    const result = spawnSync(process.execPath,[cli,'pixel-art',...args],{encoding:'utf8',cwd:dir});
    assert.equal(result.status,status,result.stderr || result.stdout);
    return result.stdout ? JSON.parse(result.stdout) : undefined;
  };
  const command = (action,extra = [],status = 0)=>call([
    'paint',action,file('source.ink.json'),
    ...(action === 'export' ? ['--destination','layer:coat','--out',file('exchange')] :
      [file('exchange/binding.json'),file('edited.png')]),
    '--scene',file('scene.json'),...extra
  ],status);
  return { file,save,scene,document,command,call };
}

function sampled(scene,doc,at,channel) {
  const { surfaceState } = ink.load().KIT.procedural;
  return surfaceState.restSampler(chart(scene),surfaceState.materialChannels()).sample(getUV(doc,at))[channel];
}

test('indexed bound PNG preserves duplicate swatches and imports only the approved source change',t=>{
  const { file,save,scene,document,command,call } = space(t,'pigment',[
    {channel:'pigment',value:{swatch:'brick',color:'#ac4a32'},brush:full}
  ]);
  command('export');
  const manifest = read(file('exchange/binding.json')), base = file('exchange/paint.png');
  assert.equal(manifest.frame,'art');
  assert.equal(manifest.binding.layer,'coat');
  assert.equal(manifest.binding.object,'plate');
  assert.equal(manifest.binding.chart,'face');
  assert.equal(manifest.encoding,'indexed');
  assert.deepEqual(manifest.grid,native);
  assert.deepEqual(manifest.pixelAspect,[2,1]);
  assert.deepEqual(manifest.binding.registration,document.sceneBindings[0].canvas);
  assert.deepEqual(manifest.blocked['protected-pixel'],[[1,1,1]]);
  assert.deepEqual(manifest.blocked['clipped-pixel'],[[2,2,1]]);
  fs.copyFileSync(base,file('edited.png'));
  const noChange = command('preview');
  assert.equal(noChange.status,'unchanged');
  assert.equal(noChange.changed,0);
  assert.equal(noChange.approval,undefined);

  const paint = Array(width*height).fill(0);
  paint[2] = 1; // swap to a distinct swatch with the same RGB bytes
  paint[3] = 2;
  paint[4] = null;
  PNG.writeIndexed(file('edited.png'),width,height,paint,colors);
  const review = command('preview',['--review',file('review.html')]);
  assert.equal(review.status,'ready');
  assert.equal(review.changed,3);
  assert.deepEqual(review.pixels.map(row=>row.afterSwatch),['oxide','mint',null]);
  assert.deepEqual(review.pixels[0].before,review.pixels[0].after);
  assert.deepEqual(review.pixels[0].uv,getUV(document,[2,0]));
  assert.deepEqual(review.runs.eligible,[[0,2,3]]);
  assert.deepEqual(review.sources.map(row=>[row.object,row.fields]),[['plate',['surfaceState']]]);
  assert.match(fs.readFileSync(file('review.html'),'utf8'),/proposed native chart pixels/i);
  assert.match(review.approval,/^[a-f0-9]{64}$/);
  assert.deepEqual(read(file('scene.json')),scene);

  const out = file('applied.json');
  paint[width+2] = 2;
  PNG.writeIndexed(file('edited.png'),width,height,paint,colors);
  const mismatch = command('apply',['--approval',review.approval,'--out',out],2);
  assert.equal(mismatch.conflicts[0].code,'approval-mismatch');
  assert.equal(fs.existsSync(out),false);
  paint[width+2] = 0;
  PNG.writeIndexed(file('edited.png'),width,height,paint,colors);
  const receipt = command('apply',['--approval',review.approval,'--out',out]);
  assert.equal(receipt.status,'applied');
  assert.equal(receipt.inputs.sourceRevision,manifest.sourceRevision);
  assert.equal(receipt.affectedTargets[0].object,'plate');
  const result = read(out);
  assert.deepEqual(sampled(result,document,[2,0],'pigment'),{swatch:'oxide',color:'#ac4a32'});
  assert.deepEqual(sampled(result,document,[3,0],'pigment'),{swatch:'mint',color:'#25b1a0'});
  assert.equal(sampled(result,document,[4,0],'pigment'),null);
  assert.deepEqual(sampled(result,document,[3,1],'pigment'),{swatch:'brick',color:'#ac4a32'});
  assert.deepEqual(read(file('scene.json')),scene);

  save('receipt.json',receipt);
  call(['replay',file('source.ink.json'),file('receipt.json'),'--scene',file('scene.json'),'--out',file('replayed.json')]);
  assert.deepEqual(read(file('replayed.json')),result);
});

test('blocked pixels and stale document, scene, and sidecar revisions prevent approval',t=>{
  const { file,save,scene,document,command } = space(t,'pigment',[]);
  command('export');
  const paint = Array(width*height).fill(null);
  for (const [x,y] of [[0,0],[1,1],[2,2],[3,3],[4,3]]) paint[y*width+x] = 2;
  PNG.writeIndexed(file('edited.png'),width,height,paint,colors);
  const review = command('preview',[],2);
  assert.equal(review.status,'conflicted');
  assert.equal(review.changed,5);
  assert.equal(review.approval,undefined);
  assert.deepEqual(review.conflicts.map(row=>row.code),
    ['protected-chart-padding','protected-pixel','clipped-pixel','stale-binding-pixel']);
  assert.equal(review.eligible,1);

  const reduced = new Uint8Array(width*height*4);
  reduced.set([172,74,50,255],2*4);
  reduced.set([37,177,160,140],3*4);
  reduced.set([1,2,3,255],4*4);
  fs.writeFileSync(file('edited.png'),PNG.encode(width,height,reduced,4));
  const paletteCheck = command('preview',[],2);
  assert.deepEqual(paletteCheck.conflicts.map(row=>row.code),['ambiguous-swatch','pigment-alpha','unknown-swatch']);

  const sidecar = read(file('exchange/binding.json'));
  save('exchange/binding.json',{ ...sidecar,binding:{ ...sidecar.binding,chart:'elsewhere' } });
  assert.equal(command('preview',[],2).conflicts[0].code,'binding-manifest');
  save('exchange/binding.json',sidecar);
  save('scene.json',{...scene,style:'moss'});
  assert.equal(command('preview',[],2).conflicts[0].code,'stale-source');
  save('scene.json',scene);
  save('source.ink.json',{ ...document,frames:[{ ...document.frames[0],durationMs:125 }] });
  assert.equal(command('preview',[],2).conflicts[0].code,'stale-document');
  assert.equal(fs.existsSync(file('applied.json')),false);
});

test('RGBA exchange preserves exact untouched source values and replaces partial opacity',t=>{
  const prior = {color:[.301,.488,.273],coverage:.813};
  const { file,document,command } = space(t,'paint',[
    {channel:'paint',value:prior.color,strength:prior.coverage,brush:full}
  ]);
  command('export');
  const png = PNG.raster(file('exchange/paint.png')), {data} = png;
  assert.equal(read(file('exchange/binding.json')).encoding,'rgba');
  data.set([48,126,200,63],2*4);
  data.set([1,1,1,0],3*4);
  fs.writeFileSync(file('edited.png'),PNG.encode(width,height,data,4));
  const report = command('preview');
  assert.equal(report.status,'ready');
  assert.equal(report.changed,2);
  const out = file('applied.json');
  command('apply',['--approval',report.approval,'--out',out]);
  const result = read(out);
  assert.deepEqual(sampled(result,document,[2,0],'paint'),{color:[48/255,126/255,200/255],coverage:63/255});
  assert.equal(sampled(result,document,[3,0],'paint'),null);
  assert.deepEqual(sampled(result,document,[4,0],'paint'),prior);
});
