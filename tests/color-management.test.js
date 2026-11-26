const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {spawnSync,execFileSync}=require('node:child_process');
const Ink=require('..');
const PNG=require('../cli/texture-png.js');
const Color=require('../cli/color-management.js');
const ColorFiles=require('../cli/color-management-files.js');

const python=process.env.INK_OCIO_PYTHON||'python3';
const available=spawnSync(python,['-c','import PyOpenColorIO,numpy'],{stdio:'ignore'}).status===0;
const lcms=available&&spawnSync(python,['-c',
  'import ctypes,ctypes.util,os; assert ctypes.CDLL(os.environ.get("INK_LCMS_LIBRARY") or ctypes.util.find_library("lcms2") or "liblcms2.so.2")'],
  {stdio:'ignore'}).status===0;
const directory=t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-color-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  return temp;
};
const primary={display:'sRGB - Display',view:'ACES 2.0 - SDR 100 nits (Rec.709)',encoding:'srgb'};
const config={config:'aces.ocio',inkLinear:'Linear Rec.709 (sRGB)',display:primary.display,view:primary.view,
  displayEncoding:'srgb',paletteView:primary,whiteNits:100,sources:{
    srgb:'sRGB Encoded Rec.709 (sRGB)','srgb-linear':'Linear Rec.709 (sRGB)',
    'rec2100-pq':'Rec.2100-PQ - Display','display-p3-linear':'Linear P3-D65'
  }};
const hdr={display:'Rec.2100-PQ - Display',view:'ACES 2.0 - HDR 1000 nits (Rec.2020)',encoding:'rec2100-pq'};
const fixture=(dir,icc=false)=>{
  if(icc)execFileSync(python,[path.join(__dirname,'../examples/color-management/make-config.py'),dir]);
  else fs.writeFileSync(path.join(dir,'aces.ocio'),execFileSync(python,['-c',
    'import PyOpenColorIO as o; print(o.Config.CreateFromBuiltinConfig("cg-config-v4.0.0_aces-v2.0_ocio-v2.5").serialize(),end="")']));
};
const close=(a,b,tolerance=1e-4)=>assert(Math.abs(a-b)<=tolerance,[a,b].join(' differs from '));

test('HDR PNG tags and scene-linear EXR metadata round-trip without altering samples',()=>{
  const data=Uint16Array.from([200,4507,61500,4000,5000,5543]);
  const metadata={mastering:{chromaticities:[.708,.292,.170,.797,.131,.046,.3127,.329],
    minNits:.005,maxNits:1000},lightLevels:{maxCLL:878.93,maxFALL:221.85}};
  const image={width:2,height:1,channels:3,data,alpha:'none'};
  const png=ColorFiles.display(image,'rec2100-pq',metadata);
  const decoded=Ink.readTexture(png);
  assert.deepEqual(decoded.data,data);
  assert.deepEqual(decoded.profile,{cicp:{primaries:9,transfer:16,matrix:0,fullRange:true},...metadata});
  assert.throws(()=>ColorFiles.display(image,'srgb',metadata),/HDR/);

  const pixels=Float32Array.of(-.125,1.25,6);
  const exr=ColorFiles.exr({width:1,height:1,channels:3,data:pixels,alpha:'none'},ColorFiles.inkLinearTags(100));
  const linear=Ink.readTexture(exr);
  assert.deepEqual(linear.data,pixels);
  assert.equal(linear.profile.ocioColorSpace,'Linear Rec.709 (sRGB)');
  assert.equal(linear.profile.whiteLuminance,100);
  close(linear.profile.chromaticities[0],.64);
});

test('working data, HDR delivery and SDR palette proof stay distinct, with unchanged alpha',{
  skip:!available&&'The optional OCIO backend is unavailable'
},t=>{
  const dir=directory(t); fixture(dir);
  const selection={...config,display:hdr.display,view:hdr.view,displayEncoding:hdr.encoding};
  const managed=Color.configure(selection,{baseDir:dir});
  const raw={encoding:'exr',width:2,height:1,channels:4,alpha:'premultiplied',
    data:Float32Array.of(4.2,1.6,.45,.5,1.2,.2,.05,1)};
  const converted=managed.importColor(raw,{}, {target:'working'});
  assert(converted.raw.data[0]>1);
  close(converted.raw.data[3],.5);
  const selected=managed.output(converted.raw,{fromWorking:true});
  const proof=Color.configure(config,{baseDir:dir}).output(converted.raw,{fromWorking:true});
  assert.deepEqual(selected.value,proof.value);
  assert.equal(selected.value.data[3],128);
  assert.equal(selected.display.data[3],32768);
  assert.notDeepEqual(selected.display.data,proof.display.data);
  assert.equal(selected.report.proof.encoding,'srgb');
  assert.equal(selected.report.display.encoding,'rec2100-pq');
  assert.throws(()=>Color.configure({...selection,paletteView:undefined},{baseDir:dir}),/SDR palette proof/);
  const tagged=Ink.readTexture(ColorFiles.display(selected.display,'rec2100-pq'));
  assert.equal(managed.sourceDescription(tagged,{}).space,hdr.display);
});

test('editable material resolves one embedded ICC profile and honors an explicit resource override',{
  skip:!lcms&&'The optional OCIO and Little CMS backends are unavailable'
},t=>{
  const dir=directory(t); fixture(dir,true);
  const file=path.join(dir,'enamel.png');
  const icc=fs.readFileSync(path.join(dir,'paint-profile.icc')).toString('base64');
  fs.writeFileSync(file,PNG.write({width:1,height:1,channels:4,data:Uint16Array.of(60119,10421,26815,32768),alpha:'straight'},{icc}));
  const ref=(node,port='value')=>({node,port});
  const graph={format:'ink-studio/graph-project',version:1,colorManagement:config,
    assets:{
      tagged:{format:'bitmap',source:{file:'enamel.png'}},
      forced:{format:'bitmap',source:{file:'enamel.png'},interpretation:{ocio:{mode:'space',space:config.sources.srgb}}},
      mask:{format:'bitmap',source:{file:'enamel.png'},interpretation:{intent:'data',channel:'r'}}
    },
    nodes:{
      tagged:{op:'bitmapAsset',inputs:{name:'tagged'}},forced:{op:'bitmapAsset',inputs:{name:'forced'}},
      mask:{op:'bitmapAsset',inputs:{name:'mask'}},proof:{op:'color.paletteInput',inputs:{source:ref('tagged')}},
      palette:{op:'palette.resolve',inputs:{source:ref('proof'),policy:{palette:['#f18a20','#010203']},options:{method:'solid'}}}
    },
    outputs:{tagged:ref('tagged'),forced:ref('forced'),mask:ref('mask'),proof:ref('proof'),
      palette:ref('palette'),info:ref('tagged','info'),view:ref('proof','report')}
  };
  const material=Ink.openMaterialGraph(graph,{id:'color'});
  const save=path.join(dir,'color.material.json');
  Ink.writeMaterialGraph(save,material);
  const project=Ink.readGraphProject(save);
  const {outputs}=project.run();
  assert(project.sourceFiles().includes(path.join(dir,'aces.ocio')));
  assert.equal(outputs.tagged.descriptor.colorSpace,'srgb-linear');
  assert.equal(outputs.mask.raster.data[0],60119);
  assert.equal(outputs.info.color.method,'icc');
  assert.match(outputs.info.color.profile.iccSha256,/^[0-9a-f]{64}$/);
  assert.equal(outputs.info.profile.icc,undefined);
  assert.notDeepEqual(outputs.tagged.raster.data,outputs.forced.raster.data);
  close(outputs.tagged.raster.data[3],32768/65535);
  assert.equal(outputs.proof.data[3],128);
  assert.deepEqual([...outputs.palette.data],[241,138,32,128]);
  assert.equal(outputs.view.paletteEncoding,'srgb');
  assert.equal(project.plan().colorManagement.working,'ACEScg');
});

test('OCIO context locates external LUTs and changed LUT bytes invalidate the graph', {
  skip:!available&&'The optional OCIO backend is unavailable'
},t=>{
  const dir=directory(t);
  fs.mkdirSync(path.join(dir,'look'));
  const cube=path.join(dir,'look/custom.cube'), conf=path.join(dir,'config.ocio');
  const lut=val=>'LUT_1D_SIZE 2\n0 0 0\n'+[val,val,val].join(' ')+'\n';
  fs.writeFileSync(cube,lut(.5));
  fs.writeFileSync(conf,`ocio_profile_version: 2
environment:
  LOOK_DIR: look
search_path: "$LOOK_DIR"
strictparsing: true
roles:
  scene_linear: Linear Rec.709 (sRGB)
  default: Linear Rec.709 (sRGB)
displays:
  Monitor:
    - !<View> {name: Paint, colorspace: Monitor RGB}
colorspaces:
  - !<ColorSpace>
    name: Linear Rec.709 (sRGB)
    encoding: scene-linear
    isdata: false
  - !<ColorSpace>
    name: Monitor RGB
    encoding: sdr-video
    isdata: false
    from_scene_reference: !<FileTransform> {src: custom.cube}
`);
  const ref=node=>({node,port:'value'});
  const graph={format:'ink-studio/graph-project',version:1,colorManagement:{
    config:'config.ocio',inkLinear:'Linear Rec.709 (sRGB)',displayEncoding:'srgb',context:{LOOK_DIR:'look'}
  },nodes:{
    patch:{op:'image.uniform',inputs:{width:1,height:1,value:[.5,.5,.5],descriptor:{intent:'color',colorSpace:'srgb-linear'}}},
    view:{op:'color.paletteInput',inputs:{source:ref('patch')}}
  },outputs:{value:ref('view')}};
  const first=Ink.createGraphProject(graph,{baseDir:dir});
  const before=first.run().outputs.value.data[0];
  assert(first.sourceFiles().includes(cube));
  assert.equal(first.plan().colorManagement.dependencies[0].file,'look/custom.cube');
  fs.writeFileSync(cube,lut(.8));
  const second=Ink.createGraphProject(graph,{baseDir:dir});
  assert(second.run().outputs.value.data[0]>before);
  assert.notEqual(first.plan().projectHash,second.plan().projectHash);
});

test('changing an OCIO view on a saved physical render retains identical accumulated linear EXR',{
  skip:!available&&'The optional OCIO backend is unavailable'
},async t=>{
  const dir=directory(t); fixture(dir);
  const plan={format:'ink-studio/physical-reference',version:1,label:'Managed physical preview',
    settings:{samples:2,bounces:1,denoise:'off'},view:{width:12,height:8},colorManagement:config,
    camera:{yaw:0,pitch:0,distance:4},materials:{lamp:{baseColor:[.05,.05,.05],emission:[5,1.7,.25]}},
    meshes:[{id:'lamp',kind:'plane',material:'lamp'}]};
  const name=path.join(dir,'plan.json'), original=path.join(dir,'original'), recolored=path.join(dir,'recolored');
  fs.writeFileSync(name,JSON.stringify(plan));
  const a=await Ink.writePhysicalReference(name,{directory:original});
  plan.colorManagement={...config,view:'Un-tone-mapped'};
  fs.writeFileSync(name,JSON.stringify(plan));
  const b=await Ink.writePhysicalReference(name,{directory:recolored,samples:0,resume:path.join(original,'accumulation.bin')});
  assert.equal(a.signature,b.signature);
  assert.deepEqual(fs.readFileSync(path.join(original,'raw.exr')),fs.readFileSync(path.join(recolored,'raw.exr')));
  assert.notDeepEqual(fs.readFileSync(path.join(original,'raw.png')),fs.readFileSync(path.join(recolored,'raw.png')));
  assert.equal(Ink.readTexture(path.join(original,'working.exr')).profile.ocioColorSpace,'ACEScg');
  assert.equal(b.colorManagement.presentation.display.view,'Un-tone-mapped');
});
