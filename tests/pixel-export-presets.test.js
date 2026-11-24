'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { createPixelEditor,readSpriteAtlas,writeSpriteAtlas } = require('..');
const { documentFromDeck } = require('../cli/pixel-art.js');
const PNG = require('../cli/png.js');

const doc = {
  format:'ink-studio/pixel-art',version:2,width:5,height:4,pixelAspect:[1,1],
  palette:{ rust:'#ad5437',ivory:'#fff6d3' },layers:[{ id:'ink' }],
  frames:[
    { id:'idle',durationMs:80,cels:{ ink:{ marks:[
      {swatch:'rust',at:[1,1]}, {swatch:'ivory',at:[2,2]}, {alpha:17,runs:[[2,2,1]]}
    ] } } },
    { id:'lit',durationMs:120,cels:{ ink:{ hold:'idle/ink' } } }
  ],
  slices:[{ id:'panel',keys:[
    {frame:'idle',bounds:[1,1,3,3],pivot:[.5,1],nineSlice:[1,1,1,1]},
    {frame:'lit',bounds:[0,0,4,4],pivot:[2,1],nineSlice:[1,1,1,1]}
  ] }],
  tags:[{ id:'pulse',start:'idle',end:'lit',direction:'ping-pong',loop:false }]
};
const preset = {
  format:'ink-studio/pixel-export-preset',version:1,id:'panel-asset',
  outputs:['png','document','layer-deck','frames','atlas'],slice:'panel',tag:'pulse',
  atlas:{ maxWidth:32,maxHeight:32,padding:2,extrude:1 }
};
const load = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const at = ({width,rgba},x,y)=>[...rgba.subarray(((y*width+x)*4),((y*width+x)*4)+4)];
const rgb = [173,84,55,255];
const mapBytes = (w,h,seed)=>Uint8Array.from({length:w*h*4},(_,i)=>i%4 === 3 ? 255 : (i*3+seed)%256);

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-export-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  return dir;
}

test('a single versioned preset exports exact PNGs, layered art, a timed sequence and a registered atlas',t=>{
  const dir = workspace(t), out = path.join(dir,'out'), { width:w,height:h } = doc;
  const maps = {};
  const all = {};
  for (const [i,frame] of doc.frames.entries()) {
    maps[frame.id] = {};
    all[frame.id] = {};
    for (const [j,name] of ['depth','normal','emission','silhouette'].entries()) {
      const rgba = mapBytes(w,h,20*i+5*j);
      const file = frame.id+'-'+name+'.png';
      all[frame.id][name] = {width:w,rgba};
      fs.writeFileSync(path.join(dir,file),PNG.encode(w,h,rgba,4));
      maps[frame.id][name] = file;
    }
  }
  const options = { ...preset,auxiliary:{ frames:maps,depthRange:[-2,2],depthOrigin:1,normalSpace:'asset' } };
  const editor = createPixelEditor(doc), result = editor.exportPreset(options,{ out,directory:dir });
  const file = relative=>path.join(out,result.content,relative);
  assert.deepEqual(load(file(result.outputs.document.file)),doc);
  assert.deepEqual(documentFromDeck(load(file(result.outputs['layer-deck'].file))).slices,doc.slices);
  const still = file(result.outputs.png.file);
  assert.equal(fs.readFileSync(still)[25],3,'PNG color type is indexed');
  const paint = PNG.paintRaster(still);
  assert.deepEqual(paint.swatchIds,['rust','ivory']);
  assert.equal(paint.alpha[4],17);
  const frames = load(file(result.outputs.frames.file));
  assert.deepEqual(frames.frames.map(row=>[row.frame,row.startMs,row.durationMs]),[['idle',0,80],['lit',80,120],['idle',200,80]]);
  assert.deepEqual(frames.frames[0].sourceBounds,[1,1,3,3]);
  assert.deepEqual(frames.frames[0].pivot,[1,1.5]);
  assert.deepEqual(frames.frames[0].slice.nineSlice,[1,1,1,1]);
  assert.deepEqual(frames.encoding.depthRange,[-2,2]);

  const Atlas = readSpriteAtlas(file(result.outputs.atlas.file)), { images,metadata } = Atlas.snapshot();
  const [first,second,third] = metadata.frames;
  assert.deepEqual([first.rect.width,first.rect.height],[3,3]);
  assert.deepEqual([second.rect.width,second.rect.height],[4,4]);
  assert.deepEqual(third.rect,first.rect);
  assert.deepEqual(first.pivot,{x:1,y:1.5});
  assert.equal(first.depthOrigin,1);
  assert.equal(metadata.normalSpace,'asset');
  assert.equal(Atlas.playback('once')(.08),1);
  assert.equal(Atlas.playback('once')(.2),2);
  const {x,y} = first.rect, px = (name,u,v)=>at({width:metadata.width,rgba:images[name]},u,v);
  assert.deepEqual(px('color',x,y),rgb);
  assert.deepEqual(px('color',x-1,y-1),rgb);
  assert.deepEqual(px('color',x-2,y),[0,0,0,0]);
  for (const name of Object.keys(maps.idle)) {
    const expected = at(all.idle[name],1,1);
    assert.deepEqual(px(name,x,y),expected);
    assert.deepEqual(px(name,x-1,y-1),expected);
    assert.deepEqual(px(name,x-2,y),[0,0,0,0]);
    const decoded = PNG.raster(file(frames.frames[0].maps[name]));
    assert.deepEqual(at({width:decoded.w,rgba:decoded.data},0,0),expected);
  }
  const firstManifest = fs.readFileSync(result.file);
  assert.equal(editor.exportPreset(options,{out,directory:dir}).content,result.content);
  assert.deepEqual(fs.readFileSync(result.file),firstManifest);
  const wrong = { ...options,atlas:{ ...options.atlas,maxWidth:2 } };
  assert.throws(()=>editor.exportPreset(wrong,{out,directory:dir}),/atlas width/);
  assert.deepEqual(fs.readFileSync(result.file),firstManifest);
  assert.deepEqual(fs.readdirSync(path.join(out,'assets')),[path.basename(result.content)]);
});

test('repacking a registered directional source preserves its depth encoding and handoff',t=>{
  const dir = workspace(t), out = path.join(dir,'out'), file = path.join(dir,'base.json');
  const source = structuredClone(doc);
  source.frames[1].durationMs = 80;
  source.directional = { version:1,viewBlend:'depth-reprojected',views:[
    {frame:'idle',pose:7,yaw:0,pitch:0,pivot:[2,2],unitsPerPixel:.25,handoff:'exact'},
    {frame:'lit',pose:7,yaw:1,pitch:0,pivot:[2,2],unitsPerPixel:.25}
  ] };
  const width = doc.width*2, height = doc.height;
  const images = {color:mapBytes(width,height,9),depth:mapBytes(width,height,52),normal:mapBytes(width,height,65)};
  const frames = source.directional.views.map((view,i)=>({
    frame:7,yaw:view.yaw,pitch:0,unitsPerPixel:.25,pivot:{x:2,y:2},
    rect:{x:i*doc.width,y:0,width:doc.width,height},depthOrigin:10+i
  }));
  writeSpriteAtlas({ metadata:{width,height,frames,depthRange:[8,12],depthFormat:'gray',normalSpace:'asset'},images },{ out:file });
  const recipe = { ...preset,tag:undefined,slice:undefined,outputs:['atlas'],auxiliary:{atlas:'base.json'} };
  const result = createPixelEditor(source).exportPreset(recipe,{out,directory:dir});
  const {metadata,images:packed} = readSpriteAtlas(path.join(out,result.content,result.outputs.atlas.file)).snapshot();
  assert.equal(metadata.viewBlend,'depth-reprojected');
  assert.deepEqual(metadata.outputPalette,[0xad5437,0xfff6d3]);
  assert.deepEqual(metadata.frames.map(row=>[row.frame,row.sourcePose,row.yaw,row.depthOrigin,row.handoff]),[
    [0,7,0,10,'exact'],[0,7,1,11,undefined]
  ]);
  const second = metadata.frames[1].rect;
  const expected = at({width,rgba:images.depth},doc.width,0)[0];
  assert.deepEqual(at({width:metadata.width,rgba:packed.depth},second.x,second.y),[expected,expected,expected,255]);

  delete source.directional;
  const still = { ...recipe,frames:['idle'],auxiliary:{atlas:'base.json',bindings:{idle:1}} };
  const single = createPixelEditor(source).exportPreset(still,{out,directory:dir});
  const [registered] = load(path.join(out,single.content,single.outputs.atlas.file)).frames;
  assert.equal(registered.yaw,1);
  assert.equal(registered.depthOrigin,11);
});

test('CLI runs a saved preset from a layer deck and rebases its auxiliary paths',t=>{
  const dir = workspace(t), inputs = path.join(dir,'inputs'), out = path.join(dir,'out');
  fs.mkdirSync(inputs);
  const deck = path.join(dir,'layers.json'), recipe = path.join(inputs,'asset.json');
  fs.writeFileSync(deck,JSON.stringify(createPixelEditor(doc).layerDeck()));
  fs.writeFileSync(path.join(inputs,'normal.png'),PNG.encode(doc.width,doc.height,mapBytes(doc.width,doc.height,13),4));
  fs.writeFileSync(recipe,JSON.stringify({ ...preset,tag:undefined,frames:['lit'],outputs:['png'],
    auxiliary:{frames:{lit:{normal:'normal.png'}}} }));
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'pixel-art','export',
    deck,'--preset',recipe,'--out',out,...args],{ encoding:'utf8',cwd:dir });
  const result = JSON.parse(cli());
  assert.deepEqual(result.frames.map(row=>row.frame),['lit']);
  assert(fs.existsSync(path.join(out,result.content,result.outputs.png.maps.normal)));
  assert.deepEqual(load(result.file).content,result.content);
});

test('alpha trimming rebases a named pivot and forced indexing rejects excessive alpha entries',t=>{
  const dir = workspace(t), source = structuredClone(doc);
  source.guides = [{id:'foot',kind:'registration',at:[3,2]}];
  const recipe = { ...preset,tag:undefined,slice:undefined,frames:['idle'],pivot:'foot',unitsPerPixel:.1,outputs:['atlas'],
    atlas:{ ...preset.atlas,trim:true } };
  const out = path.join(dir,'trim'), result = createPixelEditor(source).exportPreset(recipe,{out});
  const [{pivot,trim,rect,unitsPerPixel}] = load(path.join(out,result.content,result.outputs.atlas.file)).frames;
  assert.deepEqual(pivot,{x:2.5,y:1.5});
  assert.deepEqual(trim,{x:1,y:1});
  assert.deepEqual([rect.width,rect.height,unitsPerPixel],[2,2,.1]);

  source.palette = Object.fromEntries(Array.from({length:255},(_,i)=>['slot-'+i,'#'+i.toString(16).padStart(6,'0')]));
  source.frames[0].cels.ink.marks = [
    {swatch:'slot-0',runs:[[0,0,3]]},{alpha:17,runs:[[0,0,1]]},{alpha:33,runs:[[0,1,1]]}
  ];
  const crowded = createPixelEditor(source), invalid = path.join(dir,'invalid');
  const still = { ...recipe,atlas:undefined,outputs:['png'] };
  assert.throws(()=>crowded.exportPreset(still,{out:invalid}),/exact indexed PNG/);
  assert.equal(fs.existsSync(invalid),false);
  const auto = crowded.exportPreset({ ...still,colorMode:'auto' },{out:invalid});
  assert.equal(fs.readFileSync(path.join(invalid,auto.content,auto.outputs.png.file))[25],6);
});
