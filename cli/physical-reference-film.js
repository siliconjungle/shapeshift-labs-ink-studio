const { createHash } = require('node:crypto');
const ColorSpace = require('../src/color-space.js');
const { luma,clamp } = require('./physical-reference-math.js');

const display=ColorSpace.prepare('srgb-linear','srgb');
const magic=Buffer.from('INKREF1\0'), header=56, checksum=32;
const sha=value=>createHash('sha256').update(value).digest();

function restore(bytes, scene) {
  const { width,height }=scene.options, pixels=width*height;
  if(bytes.length!==header+pixels*32+checksum||!bytes.subarray(0,8).equals(magic)||
     bytes.readUInt32LE(8)!==width||bytes.readUInt32LE(12)!==height||bytes.readUInt32LE(20)!==0||
     bytes.subarray(24,56).toString('hex')!==scene.signature)
    throw new RangeError('Physical reference checkpoint does not match this scene, grid, seed, or bounce limit');
  const samples=bytes.readUInt32LE(16);
  if(!samples||samples>4096||!sha(bytes.subarray(0,-checksum)).equals(bytes.subarray(-checksum)))
    throw new RangeError('Invalid or damaged physical reference checkpoint');
  const sums=new Float64Array(pixels*4);
  for(let i=0;i<sums.length;i++) {
    sums[i]=bytes.readDoubleLE(header+i*8);
    if(!Number.isFinite(sums[i])||sums[i]<0) throw new RangeError('Invalid accumulated light in checkpoint');
  }
  return {sums,samples};
}
function checkpoint(state,scene) {
  const {sums,samples}=state, {width,height}=scene.options, n=header+sums.length*8;
  const out=Buffer.alloc(n+checksum);
  magic.copy(out,0);
  out.writeUInt32LE(width,8);out.writeUInt32LE(height,12);out.writeUInt32LE(samples,16);
  Buffer.from(scene.signature,'hex').copy(out,24);
  for(let i=0;i<sums.length;i++) out.writeDoubleLE(sums[i],header+i*8);
  sha(out.subarray(0,n)).copy(out,n);
  return out;
}

function resolve({sums,samples}) {
  const count=sums.length/4, rgb=new Float32Array(count*3), variance=new Float32Array(count);
  for(let p=0;p<count;p++) {
    const i=p*4, j=p*3;
    for(let c=0;c<3;c++) rgb[j+c]=sums[i+c]/samples;
    const y=.2126*sums[i]+.7152*sums[i+1]+.0722*sums[i+2];
    variance[p]=samples>1?Math.max(0,(sums[i+3]-y*y/samples)/(samples*(samples-1))):0;
  }
  return {rgb,variance};
}
const tone = n=>clamp(n*(2.51*n+.03)/(n*(2.43*n+.59)+.14));
function visualize(rgb, exposure, linear=false) {
  const strength=2**exposure, bytes=new Uint8Array(rgb.length);
  for(let i=0;i<rgb.length;i+=3) {
    const mapped=Array.from(rgb.subarray(i,i+3),n=>linear?clamp(n*strength):tone(n*strength));
    const color=display(mapped);
    for(let c=0;c<3;c++) bytes[i+c]=Math.round(clamp(color[c])*255);
  }
  return bytes;
}
function noise(variance, exposure) {
  const strength=2**exposure, rgb=new Uint8Array(variance.length*3);
  for(let p=0;p<variance.length;p++) {
    const heat=clamp(Math.log2(1+Math.sqrt(variance[p])*strength*9));
    rgb.set([Math.round(255*heat),Math.round(198*heat*heat),Math.round(76*heat**3)],p*3);
  }
  return rgb;
}

function denoise(raw,guide,width,height,mode) {
  const passes=({off:0,gentle:2,strong:4})[mode];
  if(!passes) return raw.rgb;
  const {depth,normal,albedo,material}=guide, kern=[1,4,6,4,1];
  const levels=Float32Array.from({length:width*height},(_,p)=>luma(raw.rgb.subarray(p*3,p*3+3)));
  let from=raw.rgb;
  for(let step=1;step<2**passes;step*=2) {
    const into=new Float32Array(from.length);
    for(let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
      const at=p*3;
      if(!material[p]) { into.set(from.subarray(at,at+3),at);continue; }
      let total=0;
      for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++) {
        const px=x+i*step, py=y+j*step, q=py*width+px;
        if(px<0||px>=width||py<0||py>=height||material[p]!==material[q]) continue;
        const b=q*3, alignment=normal[at]*normal[b]+normal[at+1]*normal[b+1]+normal[at+2]*normal[b+2];
        const dz=Math.abs(depth[p]-depth[q])/(.0003+depth[p]*.006*step);
        const pigment=(albedo[at]-albedo[b])**2+(albedo[at+1]-albedo[b+1])**2+(albedo[at+2]-albedo[b+2])**2;
        const range=.014+.04*Math.max(0,levels[p])+2.2*Math.sqrt(raw.variance[p]+raw.variance[q]);
        const light=Math.abs(levels[p]-levels[q])/range;
        const weight=kern[i+2]*kern[j+2]*Math.exp(-dz-40*pigment-2*light)*
          (q===p?1:Math.max(0,alignment)**32);
        for(let c=0;c<3;c++) into[at+c]+=from[b+c]*weight;
        total+=weight;
      }
      for(let c=0;c<3;c++) into[at+c]/=total;
    }
    from=into;
  }
  return from;
}

function diagnostics(guide) {
  const {depth,normal,material,albedo}=guide, normalView=new Uint8Array(normal.length), depthView=new Uint8Array(normal.length);
  let near=Infinity,far=0;
  for(const z of depth) if(Number.isFinite(z)) { near=Math.min(near,z);far=Math.max(far,z); }
  for(let p=0;p<depth.length;p++) {
    if(!material[p]) continue;
    const at=p*3, value=1-.83*(depth[p]-near)/(far-near||1);
    for(let c=0;c<3;c++) normalView[at+c]=Math.round((.5+.5*clamp(normal[at+c],-1,1))*255);
    depthView.fill(Math.round(value*255),at,at+3);
  }
  return {albedo:visualize(albedo,0,true),normals:normalView,depth:depthView};
}
module.exports = { restore,checkpoint,resolve,visualize,noise,denoise,diagnostics };
