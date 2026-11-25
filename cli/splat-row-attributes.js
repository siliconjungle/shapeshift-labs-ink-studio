'use strict';

const Provenance = require('../src/splat-provenance.js');
const Frames = require('../src/splat-frames.js');
const Footprints = require('../src/splat-footprints.js');
const SurfaceLook = require('../src/surface-look.js');

const keys = ['opacity','position','scale','orientation'];
const unitScale = [1,1,1], identity = [0,0,0,1];
const vector = (v,length,valid) => Array.isArray(v) && v.length===length && Array.from(v).every(valid);
const inRange = (v,min,max) => Number.isFinite(v) && v>=min && v<=max;
const kit = () => require('../index.js').load().KIT;

function prepare(name,value) {
  if (name==='opacity' && inRange(value,0,1)) return value;
  if (name==='position' && vector(value,3,n=>inRange(n,-1e6,1e6))) return value.slice();
  if (name==='scale') {
    const scale = typeof value==='number' ? [value,value,value] : value;
    if (vector(scale,3,n=>inRange(n,.01,100))) return scale.slice();
  }
  if (name==='orientation' && vector(value,4,Number.isFinite)) {
    const q=kit().Q.normalize(value);
    const first=q[3] || q.find(n=>n!==0);
    return q.map(n=>(first<0 ? -n : n) || 0);
  }
  throw new RangeError('Invalid splat '+name+' attribute');
}

function transformable(world,i) {
  const rest=Provenance.restData(world);
  return (Math.round(rest[i*16+11])&15)===0 && !world.reconstructionPose?.poses?.has(i);
}

function valuesAt(world,i,overrides) {
  const rest=Provenance.restData(world), q=i*16;
  return {opacity:overrides?.opacity??Math.min(1,rest[q+3]),
    position:overrides?.position?.slice()??Array.from(rest.subarray(q,q+3)),
    scale:(overrides?.scale??unitScale).slice(),orientation:(overrides?.orientation??identity).slice()};
}

const same = (a,b) => Array.isArray(a) ? Array.isArray(b) && a.length===b.length &&
  a.every((n,j)=>n===b[j]) : a===b;

function transport(world, source, edits) {
  const data=world.data.slice(), rest=Provenance.restData(source);
  let renderMetadata, surfaceData, pix, fine, frames;
  const normalsCopied=new Set();
  const layout=Footprints.validate(source);
  const { M }=kit();
  const read = (array,at)=>Array.from(array.subarray(at,at+3));
  const unit = vector=>{
    const len=Math.hypot(...vector);
    return len ? vector.map(n=>n/len) : vector;
  };
  for (const [i,{opacity,position,matrix}] of edits) {
    const q=i*16, n=i*3, s=i*SurfaceLook.STRIDE, p=i*8, f=i*12;
    if (position) data.set(position,q);
    if (opacity!==undefined) data[q+3]=opacity===1 ? Math.max(1,source.data[q+3]) : opacity;
    if (!matrix) continue;
    const normal=M.tr(M.inv(matrix));
    const covariance=Frames.covariance(source.data,q,matrix,M);
    for (const [offset,value] of [[4,covariance[0]],[5,covariance[1]],[6,covariance[2]],
      [8,covariance[4]],[9,covariance[5]],[10,covariance[8]]]) data[q+offset]=value;
    for (const name of ['normals','shadingNormals']) {
      const input=source.renderMetadata?.[name];
      if (!input) continue;
      renderMetadata ??= {...world.renderMetadata};
      if (!normalsCopied.has(name)) {
        renderMetadata[name]=input.slice();
        normalsCopied.add(name);
      }
      renderMetadata[name].set(unit(M.app(normal,read(input,n))),n);
    }
    if (source.surfaceData?.[s]) {
      surfaceData ??= world.surfaceData.slice();
      surfaceData.set(unit(M.app(normal,read(source.surfaceData,s+1))),s+1);
      surfaceData.set(unit(M.app(matrix,read(source.surfaceData,s+5))),s+5);
    }
    if (source.pix?.[p]) {
      pix ??= world.pix.slice();
      pix.set(unit(M.app(normal,read(source.pix,p+3))),p+3);
    }
    if (source.fine?.[f+11]) {
      fine ??= world.fine.slice();
      fine.set(M.app(matrix,read(source.fine,f+4)),f+4);
      fine.set(M.app(matrix,read(source.fine,f+8)),f+8);
    }
    if (layout?.frames && i*6+6<=layout.frames.length && layout.indices[i]) {
      if (!frames) {
        frames=new Float32Array(world.count*6);
        frames.set(layout.frames);
      }
      Footprints.carryFrame(frames,i*6,layout.frames,i*6,matrix);
    }
  }
  return { ...world,data,rest,...(renderMetadata&&{renderMetadata}),...(surfaceData&&{surfaceData}),
    ...(pix&&{pix}),...(fine&&{fine}),...(frames&&{splatFootprints:Footprints.layout(world.count,
      layout.styles,Uint16Array.from({length:world.count},(_,i)=>layout.indices[i]??0),frames)}) };
}

function apply(world,source,edits) {
  const { Q }=kit();
  const transforms = Array.from(edits, ([row,{opacity,position,scale,orientation}]) => [
    row,{opacity,position,matrix:scale || orientation ?
      Q.toMatrix(orientation??identity).map((v,j)=>v*(scale??unitScale)[j%3]) : undefined}
  ]);
  return transport(world,source,transforms);
}

module.exports={keys,prepare,valuesAt,transformable,same,apply,transport};
