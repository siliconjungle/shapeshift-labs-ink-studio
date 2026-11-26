/* Glaze Archive. One editable master and verified native deliveries. */
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const Ink=require('../..'), PNG=require('../../cli/png.js'), NativePNG=require('../../cli/texture-png.js');
const files=require('../../cli/asset-files.js');
const {KIT}=Ink.load(), P=KIT.procedural;
const directory=path.resolve(process.argv[2]??'studio/out/texture-formats'), at=name=>path.join(directory,name);
const width=284,height=216,count=width*height,profile={name:'sRGB',icc:fs.readFileSync(path.join(__dirname,'srgb.icc')).toString('base64')};
const clamp=n=>Math.max(0,Math.min(1,n));
const base=new Uint16Array(count*4), ornament=new Uint16Array(count*4), gilding=new Uint16Array(count*4);
const glaze=new Uint16Array(count), inlay=new Uint16Array(count), relief=new Float32Array(count);
const color=(painter,p,rgb,alpha=1,shade=0)=>{
  for(let c=0;c<3;c++)painter[p*4+c]=Math.round(clamp(((rgb>>(16-8*c))&255)/255+shade)*65535);
  painter[p*4+3]=Math.round(clamp(alpha)*65535);
};
const brass=[0x382b32,0x795044,0xb48359,0xe4b77b,0xfbd798];
const teal=[0x102936,0x173e4b,0x245767,0x3e7880,0x5d9a93,0x85b3a1];
const ivory=[0x9e6d67,0xb58873,0xe1b58e,0xf9dba1,0xffecc3];
const island=[[-100,56],[-83,45],[-58,47],[-47,28],[-28,23],[-21,10],[-8,-8],[2,-6],[11,18],[26,27],[44,46],[67,52],[84,43],[100,48],[100,65],[-100,65]];
const second=[[-100,62],[-84,55],[-64,60],[-46,54],[-35,48],[-23,52],[-12,41],[5,32],[20,43],[36,49],[56,53],[73,51],[90,45],[100,51],[100,73],[-100,73]];
function polygon(x,y,points){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const [ax,ay]=points[i], [bx,by]=points[j];
    if((ay>y)!==(by>y)&&x<ax+(bx-ax)*(y-ay)/(by-ay))inside=!inside;
  }
  return inside;
}
const stars=[[-74,-44],[-62,-23],[-46,-53],[-30,-35],[-23,-61],[13,-45],[47,-58],[79,-26],[65,-41],[88,-57],[-77,4],[-55,12],[57,16],[95,-7]];
const screws=[[-102,-73],[102,-73],[-102,73],[102,73]];
for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p++){
  const u=x-width/2+.5,v=y-height/2+.5, dx=Math.abs(u),dy=Math.abs(v);
  const boundary=Math.max(dx-120,dy-88,(dx+dy-190)*.71);
  if(boundary>=.5)continue;
  const alpha=clamp(.5-boundary), grain=Math.sin(u*.33+v*.16)*Math.cos(v*.24-u*.13);
  if(boundary>-10){
    const stripe=boundary>-1.5?0:boundary>-3.5?2:boundary>-5?3:boundary>-7?1:boundary>-8?2:0;
    color(base,p,brass[Math.min(brass.length-1,stripe+Number(grain>.45))],alpha,grain*.008);
    relief[p]=.18+.37*clamp((-1-boundary)/6);
  }else{
    const sky=clamp((v+66)/142), drift=Math.sin(u*.055-v*.07)+.8*Math.cos(v*.19+u*.06);
    let ink=teal[1+Number(sky>.35)+Number(drift>1.15)];
    const silhouette=polygon(u,v,island), foreground=polygon(u,v,second);
    if(silhouette) ink=teal[1+Number(grain>.61)];
    if(foreground) ink=teal[dx<60&&grain>.55?3:2];
    if(dy>68&&dy<70&&dx<86)ink=teal[4];
    color(base,p,ink,alpha,grain*.008);
    relief[p]=silhouette?.16:-.16+grain*.016;
    const moon=clamp(33.5-Math.hypot(u-31,v+26))*clamp(Math.hypot(u-44,v+39)-29.5);
    const cloud=v-2.4*Math.sin(.045*u)-.066*u;
    const band=(Math.abs(cloud-15)<.72&&u>-86&&u<73)||(Math.abs(cloud-20.4)<.56&&u>-63&&u<87);
    if(moon || band){
      const shade=Math.min(4,Math.max(0,Math.round(2+(-v-15)*.063+grain*.26)));
      color(ornament,p,moon?ivory[shade]:teal[4],moon || .76,grain*.006);
      glaze[p]=Math.round(65535*(moon||.68));
      relief[p]=moon?-.16+.86*moon:.17;
    }
    const star=stars.some(([a,b],i)=>Math.abs(u-a)+Math.abs(v-b)*(i%3?.8:.57)<(i%3?1.5:2));
    const etched=dy<64&&Math.abs(dx-100)<.8;
    if(star||etched){
      color(gilding,p,star?ivory[4]:brass[2],star?.87:.73);
      inlay[p]=star?60000:37000;
      relief[p]=star?.52:-.29;
    }
  }
  for(const [a,b] of screws) {
    const r=Math.hypot(u-a,v-b);
    if(r>5)continue;
    color(gilding,p,brass[r>4.1?0:Math.abs(v-b-.27*(u-a))<.55?1:u+v<a+b?4:2],1,grain*.004);
    inlay[p]=65535;
    relief[p]=.39+.40*clamp((4-r)/4);
  }
}
const rgb=(data)=>P.graphImages.declare({width,height,channels:4,data},{intent:'color'});
const mask=(data)=>P.graphImages.declare({width,height,channels:1,data},{intent:'mask'});
const a=rgb(base), b=rgb(ornament), c=rgb(gilding);
const flat=P.graphImages.blend(P.graphImages.blend(a,b,{mode:'copy'}),c,{mode:'copy'});
const heightMap=P.graphImages.declare({width,height,channels:1,data:relief},{intent:'height',units:'mm'});
const rgba=flat.raster.data;
const encode=(image,encoding,bitDepth)=>Ink.encodeTexture(image,{encoding,bitDepth});
const encoded=(bytes,encoding='png')=>({format:'bitmap',source:{encoding,base64:bytes.toString('base64')}});
const dataPng=data=>NativePNG.write({width,height,channels:1,data},{});
const assets={
  plate:encoded(encode({image:flat,profile},'png',16)),
  undercoat:encoded(encode(a,'png',16)), glazed:encoded(encode(b,'png',16)), trim:encoded(encode(c,'png',16)),
  relief:{...encoded(encode(heightMap,'pfm',32),'pfm'),interpretation:{intent:'height',units:'mm'}},
  glaze:{...encoded(dataPng(glaze)),interpretation:{intent:'mask'}},
  inlay:{...encoded(dataPng(inlay)),interpretation:{intent:'mask'}}
};
const ref=(node,port='value')=>({node,port}), op=(op,inputs)=>({op,inputs});
const nodes=Object.fromEntries(Object.keys(assets).map(name=>[name,op('bitmapAsset',{name})]));
Object.assign(nodes,{
  profile:op('data.get',{record:ref('plate','info'),key:'profile'}),
  tagged:op('data.record',{image:ref('plate'),profile:ref('profile')}),
  'coat-layer':op('data.record',{name:'Ceramic body',image:ref('undercoat')}),
  'glaze-layer':op('data.record',{name:'Moon glaze',image:ref('glazed')}),
  'gilt-layer':op('data.record',{name:'Brass inlay',image:ref('trim')}),
  'layer-table':op('data.record',{gilt:ref('gilt-layer'),glaze:ref('glaze-layer'),body:ref('coat-layer')}),
  layers:op('data.collect',{source:ref('layer-table'),keys:['gilt','glaze','body']}),
  masks:op('data.record',{'mask.glaze':ref('glaze'),'mask.inlay':ref('inlay')}),
  layered:op('data.record',{width,height,layers:ref('layers'),masks:ref('masks'),profile:ref('profile'),composite:ref('plate')}),
  maps:op('data.record',{baseColor:ref('plate'),height:ref('relief'),'mask.glaze':ref('glaze'),'mask.inlay':ref('inlay')}),
  material:op('material.pack',{maps:ref('maps')})
});
const entry=(output,encoding,bitDepth)=>({output,format:'texture',options:{encoding,bitDepth}});
const project={format:'ink-studio/graph-project',version:1,assets,nodes,
  outputs:{tagged:ref('tagged'),layered:ref('layered'),height:ref('relief'),maps:ref('material')},
  exports:{albedo:entry('tagged','png',16),'albedo-master':entry('tagged','tiff',16),
    'layered-master':entry('layered','psd',16),channels:entry('maps','exr',32),
    'relief-float':entry('height','tiff',32),'relief-half':entry('height','exr',16),relief:entry('height','pfm',32)}
};
const material=Ink.openMaterialGraph(project,{id:'glaze-archive'});
material.label='Glaze Archive';
const saved=Ink.writeMaterialGraph(at('glaze-archive.material.json'),material);
const {artifacts}=Ink.createGraphProject(saved).run();
const paths=Object.fromEntries(artifacts.map(({name,file,bytes})=>{files.write(at(file),bytes);return [name,file];}));
const reopen=(name,channels)=>Ink.readTexture(at(paths[name]),channels?{channels}:undefined);
const png=reopen('albedo'), tiff=reopen('albedo-master'), psd=reopen('layered-master');
const exr=reopen('channels'), exrHeight=reopen('channels',['height']), pfm=reopen('relief'), float=reopen('relief-float');
assert.deepEqual(png.data,rgba);assert.deepEqual(tiff.data,rgba);
assert.equal(tiff.profile.icc,profile.icc);assert.equal(png.profile.icc,profile.icc);assert.equal(psd.profile.icc,profile.icc);
assert.deepEqual(psd.layers.map(row=>row.name),['Brass inlay','Moon glaze','Ceramic body']);
assert.deepEqual(psd.layers[1].image.data,ornament);
assert.deepEqual(psd.masks['mask.glaze'].data,glaze);assert.deepEqual(psd.masks['mask.inlay'].data,inlay);
for(const recovered of [exrHeight,pfm,float])assert.deepEqual(recovered.data,relief);
for (const [name,source] of [['mask.glaze',glaze],['mask.inlay',inlay]])
  assert.deepEqual(reopen('channels',[name]).data,Float32Array.from(source,n=>n/65535));
assert(reopen('relief-half').data.every((n,i)=>Math.abs(n-relief[i])<.0005));

const toDisplay=require('../../src/color-space.js').prepare('srgb-linear','srgb');
function preview(name,image,mode='color'){
  const output=new Uint8Array(width*height*4), {channels,data}=image;
  const divisor=data instanceof Uint16Array?65535:data instanceof Uint8Array?255:1;
  for(let p=0;p<count;p++){
    const i=p*channels, n=data[i]/divisor;
    if(mode==='height'){
      const q=clamp((n+.35)/1.23);
      output.set([Math.round(48+184*q),Math.round(43+128*q),Math.round(77+42*q),rgba[p*4+3]?255:0],p*4);
    }else if(mode==='mask'){
      const v=Math.round(clamp(n)*255);
      output.set([v,v,v,rgba[p*4+3]?255:0],p*4);
    }else{
      let src=[data[i]/divisor,data[i+1]/divisor,data[i+2]/divisor];
      if(image.colorSpace?.endsWith('-linear'))src=toDisplay(src);
      output.set([...src.map(x=>Math.round(255*clamp(x))),channels===4?Math.round(255*clamp(data[i+3]/divisor)):255],p*4);
    }
  }
  const file='previews/'+name+'.png';
  files.write(at(file),PNG.encode(width,height,output,4));
  return file;
}
const probe=[171,110], p=probe[1]*width+probe[0];
function row(title,name,image,encoding,detail,mode='color'){
  const report=Ink.reportTexture(at(paths[name]),name==='channels'&&mode!=='color'?{channels:[mode==='height'?'height':title]}:undefined);
  return {title,file:paths[name],encoding,detail,bitDepth:report.bitDepth,
    precision:report.bitDepth+'-bit '+(encoding==='EXR'?(report.bitDepth===16?'half':'float'):report.bitDepth===32?'float':'integer'),
    ...(report.alpha&&{alpha:report.alpha}),profile:report.profile?.iccBytes?'ICC profile':report.profile.chromaticities?'Chromaticities':'',
    fileBytes:fs.statSync(at(paths[name])).size,
    sample:Array.from(image.data.subarray(p*image.channels,(p+1)*image.channels)),
    image:preview(name+'-'+mode+'-'+title.replace(/[^a-z0-9]+/ig,'-').toLowerCase(),image,mode),
    ...(report.available&&{channels:report.available.map(row=>row.name)}),
    ...(report.layers&&{layers:report.layers,masks:Object.keys(report.masks)})};
}
const rows=[
  row('Albedo','albedo',png,'PNG','Exact 16-bit pigment and straight alpha.'),
  row('Albedo','albedo-master',tiff,'TIFF','Same samples and ICC profile in a TIFF master.'),
  row('Layer composite','layered-master',psd.composite,'PSD','Composite reopened from three editable raster layers.'),
  ...psd.layers.map(layer=>row(layer.name+' layer','layered-master',layer.image,'PSD','Isolated layer read from the PSD, with its own alpha.')),
  ...Object.entries(psd.masks).map(([name,image])=>row(name,'layered-master',image,'PSD','Named document alpha channel reopened from the PSD.','mask')),
  row('Linear pigment','channels',exr,'EXR','Linear color and alpha from the multichannel OpenEXR master.'),
  row('Signed relief','channels',exrHeight,'EXR','Signed millimeter values from the named height channel.','height'),
  row('mask.glaze','channels',reopen('channels',['mask.glaze']),'EXR','Named grayscale channel.','mask'),
  row('mask.inlay','channels',reopen('channels',['mask.inlay']),'EXR','Named grayscale channel.','mask'),
  row('Signed relief','relief-float',float,'TIFF','32-bit float TIFF preserves negative relief.','height'),
  row('Signed relief','relief-half',reopen('relief-half'),'EXR','16-bit half-float delivery.','height'),
  row('Signed relief','relief',pfm,'PFM','Float interchange with signed samples.','height')
];
const data={width,height,probe,rows};
files.json(at('verification.json'),data);
files.write(at('data.js'),'const textures = '+JSON.stringify(data)+';\n');
for(const file of ['index.html','live.js'])files.write(at(file),fs.readFileSync(path.join(__dirname,file)));
console.log(at('index.html'));
