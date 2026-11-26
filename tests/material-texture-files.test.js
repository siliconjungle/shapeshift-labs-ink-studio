const assert=require('node:assert/strict');
const { execFileSync }=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Ink=require('..');

const P=Ink.load().KIT.procedural;
const profile={icc:fs.readFileSync(path.join(__dirname,'../examples/texture-formats/srgb.icc')).toString('base64')};
const width=3,height=2;
const pixel=(data,channels,descriptor)=>P.graphImages.declare({width,height,channels,data},descriptor);
const rgbaData=Uint16Array.of(4080,2049,63,20001,10000,64321,777,0,38400,59722,18121,50000,
  65535,33000,1,65535,7,5501,25001,32769,21116,44022,139,65535);
const rgba=pixel(rgbaData,4,{intent:'color'});
const assoc=pixel(Uint16Array.from(rgbaData,(n,i)=>i%4===3?n:Math.min(n,rgbaData[i-i%4+3])),
  4,{intent:'color',alpha:'premultiplied'});
const maskData=Uint16Array.of(0,31,4777,32768,65498,65535);
const mask=pixel(maskData,1,{intent:'mask'});
const relief=Float32Array.of(-.75,-.125,0,.25,1.25,3.125);
const raised=pixel(relief,1,{intent:'height',units:'mm'});
const exrMask='mask.registered-engraving-threshold';
const ref=(node,port='value')=>({node,port});

test('native PNG16 and TIFF16 preserve samples and ICC; float TIFF and PFM keep physical range',()=>{
  for(const encoding of ['png','tiff']){
    const encoded=Ink.encodeTexture({image:rgba,profile},{encoding,bitDepth:16});
    const got=Ink.readTexture(encoded);
    assert.equal(got.encoding,encoding);
    assert.equal(got.bitDepth,16);
    assert.equal(got.alpha,'straight');
    assert.equal(got.profile.icc,profile.icc);
    assert.deepEqual(got.data,rgbaData);
    assert.throws(()=>Ink.readTexture(encoded.subarray(0,encoded.length-3)));
    if(encoding==='png'){
      const corrupted=Buffer.from(encoded);
      corrupted[20]^=1;
      assert.throws(()=>Ink.readTexture(corrupted),/checksum/);
    }
  }
  const tiff=Ink.readTexture(Ink.encodeTexture(assoc,{encoding:'tiff',bitDepth:16,compression:'none'}));
  assert.equal(tiff.alpha,'premultiplied');
  assert.deepEqual(tiff.data,assoc.raster.data);
  for(const encoding of ['tiff','pfm']){
    const source=Ink.readTexture(Ink.encodeTexture(raised,{encoding,bitDepth:32}));
    assert.equal(source.bitDepth,32);
    assert.deepEqual(source.data,relief);
  }
  assert.throws(()=>Ink.encodeTexture(raised,{encoding:'png'}),/Physical height/);
});

test('flat OpenEXR stores aligned named masks and unclamped height with half or float channels',()=>{
  const base=P.graphImages.convert(rgba,{intent:'color',colorSpace:'srgb-linear',precision:'float32'});
  const material=P.materialChannels.pack({baseColor:base,height:raised,[exrMask]:mask});
  const bytes=Ink.encodeTexture(material,{encoding:'exr',bitDepth:32});
  const texture=Ink.readTexture(bytes), channels=['A','B','G','R','height',exrMask];
  assert.deepEqual(texture.available.map(row=>row.name),channels);
  assert.deepEqual(texture.names,['R','G','B','A']);
  assert.equal(texture.alpha,'straight');
  assert.deepEqual(texture.data,base.raster.data);
  assert.equal(texture.profile.chromaticities.length,8);
  assert.deepEqual(Ink.readTexture(bytes,{channels:['height']}).data,relief);
  assert.deepEqual(Ink.readTexture(bytes,{channels:[exrMask]}).data,Float32Array.from(maskData,n=>n/65535));
  for(const compression of ['none','zips','zip']){
    const half=Ink.readTexture(Ink.encodeTexture(raised,{encoding:'exr',bitDepth:16,compression}));
    assert.equal(half.available[0].storage,'half');
    assert.deepEqual(half.data,relief);
  }
  assert.throws(()=>Ink.readTexture(bytes,{channels:['mask.missing']}),/existing EXR channels/);
  assert.throws(()=>Ink.readTexture(bytes.subarray(0,-2)),/Truncated texture data/);
});

test('layered PSD keeps layer order, Unicode, visibility, masks, alpha and profile',()=>{
  const source={width,height,profile,layers:[
    {name:'Glaze – Émail',image:rgba,mask,opacity:.75,blend:'screen'},
    {name:'Undercoat',image:rgba,visible:false}
  ],masks:{'mask.inlay':mask},composite:rgba};
  for(const bitDepth of [8,16]){
    const result=Ink.readTexture(Ink.encodeTexture(source,{encoding:'psd',bitDepth}));
    assert.equal(result.bitDepth,bitDepth);
    assert.equal(result.alpha,'straight');
    assert.equal(result.profile.icc,profile.icc);
    assert.deepEqual(result.layers.map(row=>row.name),['Glaze – Émail','Undercoat']);
    assert.equal(result.layers[0].opacity,191/255);
    assert.equal(result.layers[0].blend,'screen');
    assert.equal(result.layers[1].visible,false);
    const expected=bitDepth===8?Uint8Array.from(maskData,n=>Math.round(n/257)):maskData;
    assert.deepEqual(result.layers[0].mask.data,expected);
    assert.deepEqual(result.masks['mask.inlay'].data,expected);
    assert.deepEqual(result.layers[0].image.data,bitDepth===8?Uint8Array.from(rgbaData,n=>Math.round(n/257)):rgbaData);
    assert.equal(result.composite.data[3],bitDepth===8?Math.round(rgbaData[3]/257):rgbaData[3]);
  }
});

test('material graph reimports TIFF and selected EXR planes and carries an ICC profile into graph export',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-texture-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const linked=(name,value,options)=>{
    fs.writeFileSync(path.join(directory,name),Ink.encodeTexture(value,options));
    return {file:name};
  };
  const tiff=linked('color.tiff',{image:rgba,profile},{encoding:'tiff',bitDepth:16});
  const sheet=P.materialChannels.pack({height:raised,[exrMask]:mask});
  const exr=linked('aux.exr',sheet,{encoding:'exr',bitDepth:32});
  const spec={format:'ink-studio/graph-project',version:1,assets:{
    color:{format:'bitmap',source:tiff},
    mask:{format:'bitmap',source:{...exr,channels:[exrMask]},interpretation:{intent:'mask'}},
    height:{format:'bitmap',source:{...exr,channels:['height']},interpretation:{intent:'height',units:'mm'}}
  },nodes:{
    color:{op:'bitmapAsset',inputs:{name:'color'}},
    mask:{op:'bitmapAsset',inputs:{name:'mask'}},
    height:{op:'bitmapAsset',inputs:{name:'height'}},
    profile:{op:'data.get',inputs:{record:ref('color','info'),key:'profile'}},
    tagged:{op:'data.record',inputs:{image:ref('color'),profile:ref('profile')}}
  },outputs:{tagged:ref('tagged'),mask:ref('mask'),height:ref('height')},exports:{
    color:{output:'tagged',format:'texture',options:{encoding:'png',bitDepth:16}}
  },outputUsages:{
    'height-master':{usage:'height',label:'Height',order:1,format:{format:'tiff',bitDepth:32},source:{output:'height'}},
    'inlay':{usage:'mask.inlay',label:'Inlay',order:2,format:{format:'png',bitDepth:16},source:{output:'mask'},export:false},
    'packed-float':{usage:'packed',label:'Packed float data',order:3,format:{format:'tiff',bitDepth:32},
      packing:{r:{map:'inlay'},g:{value:.5},b:{value:.25},a:{value:.125}}}
  }};
  const opened=Ink.openMaterialGraph(spec,{id:'test-texture'});
  const portable=Ink.editMaterialBitmap(opened,{kind:'embed',id:'color'},{baseDir:directory}).document;
  fs.unlinkSync(path.join(directory,'color.tiff'));
  const replay=Ink.createGraphProject(portable,{baseDir:directory}).run();
  assert.deepEqual(replay.outputs.height.raster.data,relief);
  assert.deepEqual(replay.outputs.mask.raster.data,Float32Array.from(maskData,n=>n/65535));
  const recovered=Ink.readTexture(replay.artifacts[0].bytes);
  assert.equal(recovered.profile.icc,profile.icc);
  assert.deepEqual(recovered.data,rgbaData);
  assert.deepEqual(Ink.readTexture(replay.artifacts[1].bytes).data,relief);
  const packed=Ink.readTexture(replay.artifacts[2].bytes);
  assert.equal(packed.alpha,'none');
  assert.deepEqual(packed.data,Float32Array.from([...maskData].flatMap(n=>[n/65535,.5,.25,.125])));
  const ordered=Ink.readTexture(Ink.encodeTexture(pixel(packed.data,4,{intent:'data'}),
    {encoding:'exr',bitDepth:32}));
  assert.deepEqual(ordered.names,['X','Y','Z','W']);
  assert.deepEqual(ordered.data,packed.data);
  const independent={encoding:'tiff',base64:replay.artifacts[2].bytes.toString('base64')};
  const reopened=Ink.createGraphProject({...spec,
    assets:{color:{format:'bitmap',source:independent},
      mask:{format:'bitmap',source:independent,interpretation:{intent:'data',channel:'a'}}},
    nodes:{color:spec.nodes.color,mask:spec.nodes.mask},outputs:{color:ref('color'),mask:ref('mask')},
    exports:{},outputUsages:{}
  },{baseDir:directory}).run().outputs;
  assert.equal(reopened.color.raster.data[3],1);
  assert.deepEqual(reopened.mask.raster.data,new Float32Array(width*height).fill(.125));
  const info=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'graph','texture-info',
    path.join(directory,'aux.exr'),'--channels',exrMask],{encoding:'utf8'}));
  assert.deepEqual(info.names,[exrMask]);
});
