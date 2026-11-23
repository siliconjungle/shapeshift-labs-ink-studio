// Rest-mesh camera registration for painting into a shared UV bake.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Camera = require('../src/camera-lens.js');
const { projector } = require('../src/drawing-primitives.js');
const { area2 } = require('../src/mesh-uv.js');
const PNG = require('./png.js');

const cameraFormat = 'ink-studio/material-paint-cameras';
const paintFormat = 'ink-studio/material-paint-views';
const idOK = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const geometryHash = (points, faces) => digest(JSON.stringify([points, faces]));
const clip = n => Math.max(0, Math.min(1, n));
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const vector = (value, length) => Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);
const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;

function raster(file, width, height) {
  const bytes = fs.readFileSync(file);
  const layout = PNG.layout(bytes);
  if (layout.w !== width || layout.h !== height) throw new RangeError('Paint PNG dimensions must match its registered camera: ' + file);
  return { ...PNG.raster(bytes), hash:digest(bytes) };
}

function read(value, mode) {
  if (value === undefined) return [];
  const file = typeof value === 'string' && path.resolve(value);
  const spec = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : value;
  const paint = mode === 'paint';
  if (spec?.format !== (paint ? paintFormat : cameraFormat) || spec.version !== 1 ||
      !Array.isArray(spec.views) || !spec.views.length || spec.views.length > 16)
    throw new TypeError('Use a version 1 material ' + mode + ' plan with 1–16 views');
  let pixels = 0;
  const seen = new Set();
  for (const {id, width, height, mesh = 0} of spec.views) {
    if (!idOK(id) || id.length>48 || seen.has(id) || !Number.isSafeInteger(mesh) || mesh < 0 ||
        ![width,height].every(n=>Number.isSafeInteger(n) && n>=8 && n<=2048))
      throw new RangeError('Material views need unique lowercase IDs, a mesh index and dimensions from 8 to 2048');
    seen.add(id);
    pixels += width*height;
  }
  if (pixels > 8000000) throw new RangeError('Material views exceed the combined source pixel budget');
  return spec.views.map(row => {
    const {id,width,height,mesh = 0} = row;
    if (!paint) return {id,width,height,mesh,settings:row.camera??{}};
    const {camera,opacity=1,weight=1,minFacing=.14,depthBias=.002,geometry,mask} = row;
    if (!vector(camera?.view,16) || !Number.isFinite(camera.tangent) || camera.tangent<=0 ||
        !Number.isFinite(camera.aspect) || camera.aspect<=0 || typeof camera.ortho!=='boolean' ||
        !Number.isFinite(camera.clipNear) || camera.clipNear<=0 || !Number.isFinite(camera.clipFar) ||
        camera.clipFar<=camera.clipNear || !Number.isFinite(opacity) || !unit(opacity) ||
        !Number.isFinite(weight) || weight<=0 || weight>16 || !unit(minFacing) || minFacing>=1 ||
        !Number.isFinite(depthBias) || depthBias<0 || depthBias>1 ||
        geometry!==undefined && !/^[0-9a-f]{64}$/.test(geometry) ||
        typeof row.paint!=='string' || !row.paint || mask!==undefined && (typeof mask!=='string'||!mask))
      throw new TypeError('Invalid camera, paint PNG or projection controls for view ' + id);
    const directory = file ? path.dirname(file) : process.cwd();
    const image = raster(path.resolve(directory,row.paint),width,height);
    const approval = mask===undefined ? null : raster(path.resolve(directory,mask),width,height);
    return {id,width,height,mesh,camera,opacity,weight,minFacing,depthBias,geometry,image,approval};
  });
}

function viewGrid(points, faces, camera, width, height) {
  const project = projector(camera,width,height);
  const transformed = points.map(project.toView);
  const tile = 16, cols = Math.ceil(width/tile), rows = Math.ceil(height/tile);
  const bins = Array.from({length:cols*rows},()=>[]), planes = [];
  let references = 0;
  for (const [face,indices] of faces.entries()) {
    const ring = project.ring(indices.map(i=>transformed[i])).map(p=>[...project.point(p),camera.ortho?p[2]:1/p[2]]);
    for(let i=1;i+1<ring.length;i++) {
      const [a,b,c] = [ring[0],ring[i],ring[i+1]], det=area2(a,b,c);
      if (Math.abs(det)<1e-9) continue;
      const ux=(c[1]-a[1])/det, uy=(a[0]-c[0])/det;
      const vx=(a[1]-b[1])/det, vy=(b[0]-a[0])/det;
      const dz1=b[2]-a[2], dz2=c[2]-a[2];
      const depthAt=(x,y)=>{
        const z=a[2]+(x-a[0])*(ux*dz1+vx*dz2)+(y-a[1])*(uy*dz1+vy*dz2);
        return camera.ortho?z:1/z;
      };
      planes[face] ??= depthAt;
      const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])/tile)),
        x1=Math.min(cols-1,Math.floor(Math.max(a[0],b[0],c[0])/tile));
      const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])/tile)),
        y1=Math.min(rows-1,Math.floor(Math.max(a[1],b[1],c[1])/tile));
      const hit={face,a,ux,uy,vx,vy,depthAt};
      if (x1<x0 || y1<y0) continue;
      references+=(x1-x0+1)*(y1-y0+1);
      if(references>4000000)throw new RangeError('Material view exceeds its triangle tile budget');
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)bins[y*cols+x].push(hit);
    }
  }
  function sight(x,y,record) {
    let depth=Infinity, face=-1;
    if(x>=0 && x<width && y>=0 && y<height)
      for(const hit of bins[Math.floor(y/tile)*cols+Math.floor(x/tile)]) {
        const dx=x-hit.a[0], dy=y-hit.a[1], u=dx*hit.ux+dy*hit.uy, v=dx*hit.vx+dy*hit.vy;
        if(u< -1e-8 || v< -1e-8 || u+v>1+1e-8)continue;
        const z=hit.depthAt(x,y);
        if(z<depth){depth=z;face=hit.face;}
      }
    return record ? face : depth;
  }
  return {project,planes,sight};
}

function cameraCapture(mesh, faces, rows, {V}) {
  if(!rows.length)return [];
  const geometry=geometryHash(mesh.points,faces), min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for(const p of mesh.points) for(let k=0;k<3;k++){
    min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);
  }
  const span=V.sub(max,min), at=V.mul(V.add(min,max),.5);
  const normals=faces.map(face=>{
    const [a,b,c]=face.map(i=>mesh.points[i]);
    return V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
  });
  return rows.map(({id,width,height,mesh:meshIndex,settings})=>{
    if(!settings || typeof settings!=='object'||Array.isArray(settings)||
      Object.keys(settings).some(key=>!['yaw','pitch','dist','target','ortho','fov'].includes(key))||
      settings.ortho!==undefined && typeof settings.ortho!=='boolean')
      throw new TypeError('A material capture needs an orbit camera');
    const dist=2*Math.max(span[0]*height/width,span[1],span[2],.001)+.6*span[2];
    const frame=Camera.frame({cam:{target:at,yaw:0,pitch:.16,dist,ortho:true},radius:Math.max(...span)},settings,width,height);
    const camera={view:frame.view,ortho:Boolean(frame.ortho),aspect:frame.aspect,
      tangent:frame.tangent*(frame.ortho?frame.dist:1),clipNear:frame.clipNear,clipFar:frame.clipFar};
    const grid=viewGrid(mesh.points,faces,camera,width,height), rgba=new Uint8Array(width*height*4);
    const light=V.norm(V.add(frame.pose.back,V.add(V.mul(frame.pose.right,-.38),V.mul(frame.pose.up,.65))));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const f=grid.sight(x+.5,y+.5,true);
      if(f<0)continue;
      const lightness=Math.round(100+110*Math.max(0,V.dot(normals[f],light)));
      rgba.set([lightness,lightness,Math.min(255,lightness+13),255],(y*width+x)*4);
    }
    return {id,width,height,mesh:meshIndex,camera,geometry,guide:PNG.encode(width,height,rgba,4),
      blank:PNG.encode(width,height,new Uint8Array(width*height*4),4)};
  });
}

function prepare(points, faces, views, {V}) {
  if (!views.length) return undefined;
  const hash=geometryHash(points,faces);
  const rows=views.map(row=>{
    const {id,width,height,camera,geometry,image,approval} = row;
    if(geometry && geometry!==hash) throw new Error('Paint camera '+id+' was captured from different geometry');
    const grid=viewGrid(points,faces,camera,width,height);
    const depths=new Float64Array(width*height).fill(NaN);
    const {eye,back}=Camera.fromView(camera.view);
    return {...row,...grid,eye,back,depths,texels:0,occluded:0,paintHash:image.hash,maskHash:approval?.hash};
  });
  const pigment=[0,0,0], value=[0,0,0];
  function sample(p,n,face,base,masks) {
    let total=0, opacity=0;
    pigment.fill(0);
    for(const row of rows) {
      if(!row.opacity || !row.planes[face])continue;
      const projected=row.project.toView(p), facing=V.dot(n,row.camera.ortho?row.back:V.norm(V.sub(row.eye,p)));
      if(!row.project.visible(projected)||facing<=row.minFacing)continue;
      const [x,y]=row.project.point(projected), {width,height,image,approval,depthBias}=row;
      if(x<0||x>=width||y<0||y>=height)continue;
      const x0=Math.floor(x-.5), y0=Math.floor(y-.5), dx=x-.5-x0, dy=y-.5-y0;
      let gain=0, proposed=false;
      value.fill(0);
      for(let j=0;j<2;j++)for(let i=0;i<2;i++) {
        const col=x0+i, line=y0+j;
        if(col<0||col>=width||line<0||line>=height)continue;
        const q=line*width+col, at=q*4, raw=image.data[at+3]/image.max;
        const approved=approval ? (.2126*approval.data[at]+.7152*approval.data[at+1]+.0722*approval.data[at+2])/
          approval.max * approval.data[at+3]/approval.max : 1;
        const k=raw*approved*(i?dx:1-dx)*(j?dy:1-dy);
        if(!k)continue;
        proposed=true;
        if(Number.isNaN(row.depths[q]))row.depths[q]=row.sight(col+.5,line+.5);
        if(!(Math.abs(row.depths[q]-row.planes[face](col+.5,line+.5))<=depthBias))continue;
        gain+=k;
        for(let c=0;c<3;c++)value[c]+=k*linear(image.data[at+c]/image.max);
      }
      if(!proposed)continue;
      if(row.sight(x,y)<projected[2]-depthBias){row.occluded++;continue;}
      if(!gain)continue;
      const amount=clip(gain*row.opacity*clip((facing-row.minFacing)/.18));
      const score=amount*row.weight*facing*facing;
      if(!score)continue;
      masks['paint-'+row.id]=amount;
      row.texels++;
      opacity=Math.max(opacity,amount);
      total+=score;
      for(let c=0;c<3;c++)pigment[c]+=value[c]*score/gain;
    }
    masks['projected-paint']=opacity;
    return total?base.map((v,c)=>v*(1-opacity)+pigment[c]/total*opacity):base;
  }
  return {views:rows.length,maskNames:['projected-paint',...rows.map(row=>'paint-'+row.id)],sample,
    report:()=>rows.map(({id,width,height,camera,paintHash,maskHash,texels,occluded})=>
      ({id,width,height,camera,paintHash,...(maskHash&&{maskHash}),texels,occluded}))};
}

module.exports = { read, prepare, cameraCapture, geometryHash, digest, idOK, paintFormat };
