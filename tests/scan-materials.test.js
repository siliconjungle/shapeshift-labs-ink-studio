const assert=require('node:assert/strict');
const {test}=require('node:test');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {resolve,join}=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const {readGlb}=require('../cli/glb-file.js');

function fixture({rough=false,flat=false}={}) {
  const width=20,height=20,count=width*height, depth=new Float32Array(count).fill(3);
  const data=new Uint8Array(count*4), diffuse=new Uint8Array(count*4), normal=new Uint8Array(count*4);
  const roughness=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const x=i%width,y=Math.floor(i/width), a=i*4;
    if (x<3 && y<3)depth[i]=0;
    data.set([174,74,28,255],a);
    diffuse.set([48,88,128,255],a);
    normal.set(flat || x<10 ? [128,128,255,255]:[192,128,237,255],a);
    roughness[i]=rough?255:x<10?40:100;
  }
  const image=data=>({width,height,channels:4,data});
  return {input:{width,height,depth,camera:{type:'orthographic',height:2},image:image(data)},
    options:{residualLimit:0,materials:{diffuse:image(diffuse),normal,roughness,captured:true,
      daylight:{ambient:.55,light:[.72,.1,.68],specular:.9}}}};
}
const view={w:96,h:96,px:1,raw:true,ortho:true,target:[0,0,-3],dist:3.35,yaw:0,pitch:0};
const light=x=>({id:'lamp',shape:'disk',at:[x,0,-2.25],normal:[0,0,-1],
  size:[.12,.12],color:'#ffe7bc',intensity:2.5,radius:1.2,sampleGrid:1,visible:false,shadows:false});
const pixel=(im,x,y)=>Array.from(im.rgb.subarray(3*(y*im.w+x),3*(y*im.w+x+1)));

async function scan(config) {
  const {input,options}=fixture(config);
  const result=await ink.scanToMesh(input,options);
  return {result,world:await result.world()};
}

test('default-view captured appearance is independent of native geometry and relightable material maps',async()=>{
  const {result,world}=await scan();
  const {gltf}=readGlb(result.glb), material=gltf.materials[0];
  assert.equal(gltf.images.length,4);
  assert(material.normalTexture.index!==material.pbrMetallicRoughness.metallicRoughnessTexture.index);
  assert.equal(world.gltfParts.parts[0].capturedAppearance,true);
  const passes=['opaque-surface'];
  const layers=[0,.5,1].map(scanAppearance=>ink.render(world,{...view,scanDaylight:false,passes,scanAppearance}));
  const [base,blend,captured]=layers.map(im=>pixel(im,48,48));
  assert(base[2]>base[0]*2);
  assert.deepEqual(captured,[174,74,28]);
  assert(blend[0]>base[0]&&blend[0]<captured[0]);
  assert.deepEqual(layers[0].passes.depth,layers[2].passes.depth);
  assert.deepEqual(layers[0].passes.objectId,layers[2].passes.objectId);
  const far={...view,yaw:1.12};
  assert.deepEqual(ink.render(world,far).rgb,ink.render(world,{...far,scanAppearance:1}).rgb);
  assert.throws(()=>ink.render(world,{...view,scanAppearance:1.5}),/appearance weight/);
  const {world:flat}=await scan({flat:true});
  const aligned=pixel(ink.render(world,view),60,46), unmapped=pixel(ink.render(flat,view),60,46);
  assert(aligned[2]>unmapped[2]+5);
});

test('a moving area-light highlight responds to registered roughness in the headless renderer',async()=>{
  const {world}=await scan({flat:true}), {world:matte}=await scan({flat:true,rough:true});
  const base={...view,scanDaylight:false};
  const render=(subject,x)=>ink.render(subject,{...base,areaLights:[light(x)]});
  const left=render(world,-.44),right=render(world,.44),leftMatte=render(matte,-.44);
  assert(pixel(left,31,48)[0]>pixel(right,31,48)[0]+15);
  assert(pixel(right,65,48)[0]>pixel(left,65,48)[0]+15);
  assert(pixel(left,31,48)[0]>pixel(leftMatte,31,48)[0]+12);
});

test('the CLI authors registered scan maps and can toggle the captured layer from GLB',async t=>{
  const {input,options:{materials}}=fixture();
  const dir=mkdtempSync(join(tmpdir(),'ink-scan-materials-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const paths=Object.fromEntries(['depth','image','diffuse','normal','roughness','glb','off','on'].map(key=>
    [key,join(dir,key+(key==='depth'?'.json':key==='glb'?'.glb':'.png'))]));
  const {width,height,depth,camera}=input;
  writeFileSync(paths.depth,JSON.stringify({width,height,camera,depth:Array.from(depth)}));
  for(const [key,data] of Object.entries({image:input.image.data,diffuse:materials.diffuse.data,normal:materials.normal}))
    writeFileSync(paths[key],PNG.encode(width,height,data,4));
  writeFileSync(paths.roughness,PNG.encodeGray(width,height,materials.roughness));
  const cli=(...args)=>execFileSync(process.execPath,[resolve(__dirname,'../cli/ink-studio.js'),...args],{stdio:'pipe'});
  cli('scan-mesh',paths.depth,'--image',paths.image,'--diffuse',paths.diffuse,'--normal',paths.normal,
    '--roughness',paths.roughness,'--capture-layer','--residual-limit','0','--out',paths.glb);
  const expected={diffuse:'supplied',normal:'tangent-map',roughness:'texture',captured:true};
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'glb.scan.json'))).material,expected);
  for(const [weight,key] of [['0','off'],['1','on']])
    cli('render',paths.glb,'--w','96','--h','96','--px','1','--scan-appearance',weight,'--yaw','0','--pitch','0','--out',paths[key]);
  assert(!readFileSync(paths.off).equals(readFileSync(paths.on)),'capture layer should affect the CLI render');
  const {meshes:[mesh]}=await ink.readGaussianGltf(paths.glb), material=mesh.materials[0];
  const doc=join(dir,'document.json'), command=join(dir,'stroke.json'), asset=join(dir,'paint.json');
  writeFileSync(doc,JSON.stringify(editDocument(paths.glb,mesh.objectId,{kind:'scan-material',mesh:mesh.id,material})));
  const observed=JSON.parse(cli('pixel-art','targets',doc,'--scene',paths.glb,'--destination','channels'));
  const texels=Array.from({length:400},(_,i)=>({at:[i%20,Math.floor(i/20)],pigment:'mint'}));
  writeFileSync(command,JSON.stringify({id:'wash',destination:'channels',frame:'front',revision:observed.documentRevision,
    sourceRevision:observed.sourceRevision,operation:{texels}}));
  assert(JSON.parse(cli('pixel-art','preview',doc,command,'--scene',paths.glb)).valid);
  assert.equal(JSON.parse(cli('pixel-art','edit',doc,command,'--scene',paths.glb,'--out',asset)).status,'applied');
  for (const [weight,key] of [['0','off'],['1','on']]) {
    const output=join(dir,key+'-paint.png');
    cli('render',paths.glb,'--w','96','--h','96','--px','1','--scan-paint',asset,'--scan-appearance',weight,'--yaw','0','--pitch','0','--out',output);
    assert.equal(readFileSync(output).equals(readFileSync(paths[key])),weight==='1');
  }
});

test('WebGL applies the same normal, roughness and angle-sensitive capture channels',{
  skip:!process.env.INK_TEST_CHROME
},async()=>{
  const {result}=await scan(), {result:flat}=await scan({flat:true}), {result:rough}=await scan({rough:true});
  const input={assets:[result,flat,rough].map(scan=>scan.glb.toString('base64')),lights:[light(-.44),light(.44)]};
  const images=require('../cli/look-webgl.js')({hardware:true,asyncFixture:true},async(kit,assets)=>
    Promise.all(assets.map(asset=>kit.gaussianGltfWorld(Uint8Array.from(atob(asset),c=>c.charCodeAt(0)),{toolkit:kit}))),
  async (kit,build,backend,{assets,lights})=>{
    const [world,flat,rough]=await build(kit,assets);
    const b=backend(96,96,{offscreen:true,camera:{target:[0,0,-3]},dist:3.35,yaw:0,pitch:0,ortho:true,raw:true});
    function render(world,frame) {
      b.draw(world,frame);
      return b.sample({left:[31,48],right:[65,48]});
    }
    const [mesh]=world.meshes, [material]=mesh.materials;
    const source=kit.KIT.sceneMeshes.scanMaterial(mesh,material);
    const scanPaint={format:'ink-studio/scan-paint',version:1,edits:[{mesh:mesh.id,material,registration:source.registration,
      texels:Array.from({length:400},(_,i)=>({at:[i%20,Math.floor(i/20)],pigment:0x55aa88,roughness:.85}))}]};
    try {
      return {day:render(world,{}),flat:render(flat,{}),captured:render(world,{scanAppearance:1}),
        painted:render(world,{scanPaint}),paintedCapture:render(world,{scanPaint,scanAppearance:1}),
        offAxis:render(world,{scanAppearance:1,yaw:1.12}),axisBase:render(world,{yaw:1.12}),
        left:render(world,{scanDaylight:false,areaLights:[lights[0]]}),
        right:render(world,{scanDaylight:false,areaLights:[lights[1]]}),
        rough:render(rough,{scanDaylight:false,areaLights:[lights[0]]})};
    } finally {b.close();}
  },input);
  assert(images.day.right[2]>images.flat.right[2]+4,JSON.stringify(images));
  assert.deepEqual(images.captured.left,[174,74,28]);
  assert.notDeepEqual(images.painted.left,images.day.left);
  assert.deepEqual(images.paintedCapture,images.captured);
  assert.deepEqual(images.offAxis,images.axisBase);
  assert(images.left.left[0]>images.right.left[0]+8);
  assert(images.left.left[0]>images.rough.left[0]+7,JSON.stringify(images));
});

function editDocument(scene,object,destination,part) {
  return {format:'ink-studio/pixel-art',version:2,width:20,height:20,pixelAspect:[1,1],
    palette:{mint:'#55aa88'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'scan',scene,object,...(part&&{part})}],
    destinations:[{id:'channels',binding:'scan',...destination}]};
}

test('registered material edits change the relit layer and preserve the capture across undo and replay',async()=>{
  const {world}=await scan(), [mesh]=world.meshes, [material]=mesh.materials;
  const doc=editDocument('scan.glb',mesh.objectId,{kind:'scan-material',mesh:mesh.id,material},mesh.partId);
  const editor=ink.createPixelEditor(doc), context={world:()=>world};
  const targets=()=>editor.targets('channels',context);
  const initial=targets();
  assert.equal(initial.captured,true);
  assert.deepEqual(initial.sourceView,[0,0,1,0]);
  const texels=[];
  for (let y=5;y<15;y++) for (let x=5;x<15;x++)
    texels.push({at:[x,y],pigment:'mint',roughness:.88,normal:[.3,0,1]});
  const patch={id:'repaint',destination:'channels',frame:'front',revision:editor.describe().revision,
    sourceRevision:initial.sourceRevision,operation:{texels}};
  const options={...view,passes:['opaque-surface','pigment'],scanDaylight:false};
  const draw=(appearance,yaw=0)=>ink.render(world,{...options,yaw,scanAppearance:appearance,...editor.renderOptions('scan.glb')});
  const before=draw(0), capture=draw(1);
  const report=editor.previewEdit(patch,{...context,exact:true,limit:0,view:{scanAppearance:0}});
  assert(report.valid,JSON.stringify(report.conflicts));
  assert.deepEqual(report.diff.renderErrors,[]);
  const changedTexels=report.diff.materials.filter(row=>row.key==='texel');
  assert.equal(changedTexels.length,100);
  assert.deepEqual(changedTexels[0].after,{at:[5,5],pigment:0x55aa88,roughness:.88,normal:[.3,0,1]});
  assert.ok(report.diff.rendered[0].cells.length>0);
  assert.deepEqual(report.diff.geometry,[]);
  assert.equal(report.targets[0].texels.length,100);
  assert.equal(report.targets[0].capturedAppearance,true);
  assert.deepEqual(draw(0).rgb,before.rgb);
  const painted=editor.apply(patch,context), receipt=editor.receipts().at(-1);
  assert.equal(painted.edits[0].registration,initial.registration);
  assert.throws(()=>ink.render(world,{...options,scanPaint:{...painted,edits:[{...painted.edits[0],registration:'obsolete'}]}}),
    /registered material/);
  const after=draw(0);
  assert.notDeepEqual(after.rgb,before.rgb);
  assert.equal(after.passes.pigment[48*96+48],0x55aa88+1);
  assert.deepEqual(after.passes.depth,before.passes.depth);
  assert.deepEqual(draw(1).rgb,capture.rgb);
  assert.deepEqual(draw(1,1.12).rgb,draw(0,1.12).rgb);
  assert.equal(editor.undo(),true);
  assert.deepEqual(draw(0).rgb,before.rgb);
  assert.deepEqual(editor.replay(receipt,context),painted);
  assert.deepEqual(draw(0).rgb,after.rgb);
  assert.throws(()=>editor.apply({...patch,id:'obsolete'},context),/Inspected scene source/);
  const clear={...patch,id:'clear',sourceRevision:targets().sourceRevision,operation:{texels:texels.map(({at})=>
    ({at,pigment:null,roughness:null,normal:null}))}};
  assert.deepEqual(editor.apply(clear,context).edits,[]);
  assert.deepEqual(draw(0).rgb,before.rgb);
});

test('directional Gaussian data survives pigment edits, clones, and row subsets',async()=>{
  const {gaussianSplatWorld}=await import('../src/gaussian-splats.mjs');
  const world=gaussianSplatWorld({count:2,degree:1,positions:new Float32Array([0,0,0,1,0,0]),
    scales:new Float32Array([.19,.19,.01,.19,.19,.01]),rotations:new Float32Array([0,0,0,1,0,0,0,1]),
    opacity:new Float32Array([1,1]),dc:new Float32Array(6),
    sh:new Float32Array([0,0,0,-.3,.15,0,0,0,0, 0,0,0,.2,0,-.18,0,0,0])},
  {size:2,colorMode:'rgb',objectId:'scan'});
  world.id='splat-capture';
  const doc=editDocument(world.id,'scan',{kind:'splat-attributes'}), editor=ink.createPixelEditor(doc);
  const context={world:()=>world}, targets=()=>editor.targets('channels',context);
  const initial=targets(), selected=initial.splats[0];
  assert.equal(selected.directionalAppearance,true);
  const stored=world.gaussianHarmonics, samples=stored.sh.slice();
  const patch={id:'paint',destination:'channels',frame:'front',revision:editor.describe().revision,
    sourceRevision:initial.sourceRevision,operation:{splats:[{splat:selected.id,pigment:'mint',roughness:.8}]}};
  const camera={...view,target:selected.at,dist:4};
  const draw=(appearance,yaw=0)=>ink.render(world,{...camera,yaw,scanAppearance:appearance,
    ...editor.renderOptions(world.id),passes:['coverage','depth','pigment']});
  const base=draw(0);
  editor.apply(patch,context);
  const paint=draw(0), captured=draw(1), turn=draw(1,Math.PI);
  assert.notDeepEqual(base.rgb,paint.rgb);
  assert.notDeepEqual(pixel(captured,48,48),pixel(paint,48,48));
  assert.notDeepEqual(pixel(turn,48,48),pixel(captured,48,48));
  assert.deepEqual(captured.passes.coverage,paint.passes.coverage);
  assert.deepEqual(captured.passes.depth,paint.passes.depth);
  assert.deepEqual(captured.passes.pigment,paint.passes.pigment);
  assert.equal(world.gaussianHarmonics,stored);
  assert.deepEqual(stored.sh,samples);
  const clone=editor.apply({...patch,id:'clone',sourceRevision:targets().sourceRevision,operation:{topology:[
    {op:'clone',from:selected.id,id:'carry',offset:[0,.45,0]},
    {op:'add',id:'new',position:[0,-.5,0],radius:.15,pigment:'mint'}
  ]}},context);
  const fit=require('../cli/splat-fit-asset.js'), expanded=fit.renderWorld(world,fit.prepare(world,clone));
  assert.deepEqual(Array.from(expanded.gaussianHarmonics.available),[1,1,1,0]);
  const source=ink.load().KIT.procedural.splatProvenance.identities(world).rowOf(selected.id);
  assert.deepEqual(expanded.gaussianHarmonics.sh.subarray(18,27),samples.subarray(source*9,source*9+9));
  const reordered=ink.load().KIT.procedural.splatProvenance.subset(expanded,[2,3,source]);
  assert.deepEqual(Array.from(reordered.gaussianHarmonics.available),[1,0,1]);
  assert.deepEqual(reordered.gaussianHarmonics.sh.subarray(0,9),samples.subarray(source*9,source*9+9));
});
