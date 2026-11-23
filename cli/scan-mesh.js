const path = require('node:path');
const { document } = require('./glb-file.js');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const SemanticMipmaps = require('../src/semantic-texture-mipmaps.js');
const { readDepthInput, colorImage } = require('./depth.js');

const EXT = 'KHR_gaussian_splatting', SH0 = .28209479177387814;
const clamp = (n, a, b) => Math.max(a,Math.min(b,n));
const vec = (array,i,width=3) => Array.from(array.subarray(i*width,(i+1)*width));
const display = coefficient => clamp(.5+coefficient*SH0,0,1)*255;
const depthLimit = 180000;

function material(capture, model, radius, image=capture.image) {
  const {width,height}=capture, pixels=new Uint8Array(width*height*4);
  const depth=Float32Array.from({length:width*height},(_,i)=>model.depthAt(i%width,Math.floor(i/width)));
  const channels=image?.channels ?? (image?.data.length===depth.length*4 ? 4 : 3);
  function color(i,k) {
    return image ? image.data[i*channels+k] : [150,171,186][k];
  }
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*width+x,d=depth[i];
    if (!d) continue;
    const zTolerance=Math.min(model.maxDepthJump,Math.max(...model.camera.scaleAt(d))*(radius+2));
    const sums=[0,0,0];
    let count=0;
    for(let v=Math.max(0,y-radius);v<=Math.min(height-1,y+radius);v++)
      for(let u=Math.max(0,x-radius);u<=Math.min(width-1,x+radius);u++) {
        const row=v*width+u;
        if (!depth[row] || row!==i && Math.abs(depth[row]-d)>zTolerance) continue;
        const weight=1/(1+Math.abs(u-x)+Math.abs(v-y));
        for(let k=0;k<3;k++) sums[k]+=weight*color(row,k);
        count+=weight;
      }
    pixels.set([...sums.map(n=>Math.round(n/count)),255],i*4);
  }
  return { width,height,pixels };
}

function scanMaterials(capture, model, options) {
  if (options===undefined) return null;
  const {width,height}=capture, n=width*height;
  if (width>1024||height>1024) throw new RangeError('Relightable scan maps support up to 1024 pixels per edge');
  if (!options || typeof options!=='object' || Array.isArray(options)) throw new TypeError('Supply registered scan material maps');
  const {normal,roughness=.65,captured=false,angles=[.72,.92], daylight={ambient:.48,specular:.46}}=options;
  const diffuse=options.diffuse && {
    ...options.diffuse, channels:options.diffuse.channels??(options.diffuse.data?.length===n*4?4:3)
  };
  const bytes=a=>a instanceof Uint8Array || a instanceof Uint8ClampedArray;
  if (diffuse && (diffuse.width!==width||diffuse.height!==height||!bytes(diffuse.data)||
      ![3,4].includes(diffuse.channels)||diffuse.data.length!==n*diffuse.channels) ||
      normal!==undefined && (!bytes(normal)||normal.length!==n*4) ||
      !(Number.isFinite(roughness)&&roughness>=0&&roughness<=1) && (!bytes(roughness)||roughness.length!==n))
    throw new RangeError('Scan diffuse, tangent normals and roughness need matching capture dimensions');
  if (typeof captured!=='boolean'||captured&&!capture.image||!Array.isArray(angles)||angles.length!==2||
      !angles.every(value=>Number.isFinite(value)&&value>=-1&&value<=1)||angles[0]>=angles[1])
    throw new RangeError('The captured layer needs a color capture and increasing angle cosines');
  if (!SemanticMipmaps.settings(daylight)) throw new TypeError('Supply scan daylight settings');
  const photograph=captured && material(capture,model,0).pixels;
  if (photograph && capture.image.data.length===n*4) {
    for (let i=3;i<photograph.length;i+=4) photograph[i]=Math.min(photograph[i],capture.image.data[i]);
  }
  return {diffuse,normal,roughness,photograph,angles,daylight,projection:model.camera.type};
}

function compactSurface(model, image) {
  const {pos,tri}=model.front, sourceUV=model.frontUVs(), mapping=new Uint32Array(pos.length/3);
  const positions=[], uvs=[], indices=new Uint32Array(tri.length);
  for(let i=0;i<tri.length;i++) {
    const source=tri[i];
    if(!mapping[source]) {
      mapping[source]=positions.length/3+1;
      positions.push(...vec(pos,source));
      uvs.push(...vec(sourceUV,source,2));
    }
    indices[i]=mapping[source]-1;
  }
  return {positions:Float32Array.from(positions),uvs:Float32Array.from(uvs),indices,image};
}

function measuredSplats(model, stride, diffuse) {
  const count=model.count;
  const positions=new Float32Array(count*3), scales=new Float32Array(count*3);
  const rotations=new Float32Array(count*4), opacity=new Float32Array(count).fill(.93);
  const dc=new Float32Array(count*3), normals=new Float32Array(count*3);
  let i=0;
  for (const {position,normal,color,d,u,v} of model.observations()) {
    const at=diffuse && (v*diffuse.width+u)*diffuse.channels;
    const pigment=diffuse ? [0,1,2].map(k=>diffuse.data[at+k]/255) : color;
    const [sx,sy]=model.camera.scaleAt(d).map(n=>n*stride);
    const [x,y,z]=normal, w=1+z, l=Math.hypot(x,y,w);
    rotations.set(l>1e-8 ? [-y/l,x/l,0,w/l] : [0,1,0,0],i*4);
    positions.set(position,i*3);
    scales.set([sx*.53,sy*.53,Math.min(sx,sy)*.1],i*3);
    normals.set(normal,i*3);
    dc.set(pigment.map(v=>(v-.5)/SH0),i*3);
    i++;
  }
  return { count,degree:0,positions,scales,rotations,opacity,dc,normals,sh:new Float32Array() };
}

function checkCloud(cloud) {
  const {count,degree,positions,scales,rotations,opacity,dc,sh,normals}=cloud;
  if (!Number.isSafeInteger(count) || count<1 || count>4_000_000 || !Number.isInteger(degree) || degree<0 || degree>4 ||
      ![[positions,3],[scales,3],[rotations,4],[opacity,1],[dc,3],[sh,3*((degree+1)**2-1)],...(normals?[[normals,3]]:[])]
        .every(([array,width])=>array instanceof Float32Array && array.length===count*width && array.every(Number.isFinite)))
    throw new TypeError('Supply decoded Gaussian positions, rotations, scales, opacity and harmonics in capture space');
  if (scales.some(n=>n<0) || opacity.some(n=>n<0||n>1))
    throw new RangeError('Gaussian scales and opacity must be valid linear values');
}

function closestParts(cloud, surface, model, capture, { rgbThreshold, tolerance, residualLimit }, kit) {
  const { camera, stride }=model;
  const trace=kit.sceneMeshes.rayQuery(surface,kit), V=kit.V;
  const kept=[], reasons={hidden:0,matched:0,outside:0,faint:0,relief:0,uncovered:0,appearance:0,budget:0};
  const bands=3*((cloud.degree+1)**2-1);
  for(let i=0;i<cloud.count;i++) {
    const alpha=cloud.opacity[i];
    if(alpha<.08) { reasons.faint++; continue; }
    const position=vec(cloud.positions,i), d=-position[2];
    if (!(d>0)) { reasons.outside++; continue; }
    const [sx,sy]=camera.scaleAt(d), x=Math.round(camera.cx+position[0]/sx), y=Math.round(camera.cy-position[1]/sy);
    if(x<0 || y<0 || x>=capture.width || y>=capture.height || !model.depthAt(x,y)) {
      reasons.outside++;
      continue;
    }
    const origin=camera.type==='orthographic' ? [position[0],position[1],0] : [0,0,0];
    const ray=V.sub(position,origin), range=V.len(ray), direction=V.mul(ray,1/range);
    const gapLimit=tolerance ?? Math.max(sx,sy)*stride*1.2;
    // Test the closest opaque surface on the whole scan ray, including behind the source sample.
    const hit=trace({origin,direction,maxDistance:Infinity});
    const gap=hit ? hit.distance-range : Infinity;
    if(gap < -gapLimit) { reasons.hidden++; continue; }
    const color=vec(cloud.dc,i).map(display);
    let error=0;
    if(hit) {
      const pigment=hit.pigment;
      const base=[pigment>>16,pigment>>8&255,pigment&255];
      let directional=0;
      for(let k=0;k<bands;k++) directional=Math.max(directional,Math.abs(cloud.sh[i*bands+k]));
      error=alpha*Math.max(...color.map((n,k)=>Math.abs(n-base[k])),directional*127.5);
    }
    const reason=!hit ? 'uncovered' : gap>gapLimit ? 'relief' : error>=rgbThreshold ? 'appearance' : 'matched';
    if(reason==='matched') { reasons.matched++; continue; }
    const bias=Math.min(Math.max(sx,sy)*.2,gapLimit*.22);
    const normal=hit?.normal ?? cloudNormal(cloud,i,kit);
    kept.push({ i,reason,normal,position:reason==='appearance' ? V.add(hit.point,V.mul(normal,bias)) : position,
      score:reason==='appearance' ? error : 255+alpha*Math.min(255,Math.abs(gap)/gapLimit) });
  }
  kept.sort((a,b)=>b.score-a.score || a.i-b.i);
  const chosen=kept.slice(0,residualLimit).sort((a,b)=>a.i-b.i);
  reasons.budget=kept.length-chosen.length;
  for(const row of chosen) reasons[row.reason]++;
  return { chosen,reasons };
}

function cloudNormal(cloud,i,kit) {
  if (cloud.normals) return vec(cloud.normals,i);
  const scale=vec(cloud.scales,i), axis=scale.indexOf(Math.min(...scale))*4;
  const rotation=vec(cloud.rotations,i,4), length=Math.hypot(...rotation);
  if (length<1e-8) throw new RangeError('Scan Gaussian quaternion must be nonzero');
  const m=kit.mesh.gltfTransforms.trs({rotation:rotation.map(n=>n/length)});
  const n=m.slice(axis,axis+3);
  return kit.V.dot(n,vec(cloud.positions,i))>0 ? n.map(v=>-v) : n;
}

function addGaussians(doc, cloud, selection, kit) {
  const count=selection?.length ?? cloud.count;
  if(!count) return null;
  const degree=Math.min(3,cloud.degree), bands=((cloud.degree+1)**2-1)*3;
  const {gltf,accessor}=doc;
  gltf.extensionsUsed=[EXT];
  const p=new Float32Array(count*3), s=new Float32Array(count*3), q=new Float32Array(count*4);
  const a=new Float32Array(count), n=new Float32Array(count*3);
  const sh=Array.from({length:(degree+1)**2},()=>new Float32Array(count*3));
  for(let j=0;j<count;j++) {
    const row=selection?.[j], i=row?.i ?? j;
    p.set(row?.position ?? vec(cloud.positions,i),j*3);
    s.set(vec(cloud.scales,i),j*3);
    const rotation=vec(cloud.rotations,i,4), length=Math.hypot(...rotation);
    if (length<1e-8) throw new RangeError('Scan Gaussian quaternion must be nonzero');
    q.set(rotation.map(v=>v/length),j*4);
    a[j]=cloud.opacity[i];
    n.set(row?.normal ?? cloudNormal(cloud,i,kit),j*3);
    sh[0].set(vec(cloud.dc,i),j*3);
    for(let k=1;k<sh.length;k++) sh[k].set(cloud.sh.subarray(i*bands+3*(k-1),i*bands+3*k),j*3);
  }
  const attr=(array,type,bounds=false)=>accessor(array,type,{target:34962,bounds});
  const key=name=>EXT+':'+name;
  const attributes={POSITION:attr(p,'VEC3',true),NORMAL:attr(n,'VEC3'),[key('SCALE')]:attr(s,'VEC3'),
    [key('ROTATION')]:attr(q,'VEC4'),[key('OPACITY')]:attr(a,'SCALAR')};
  for(let l=0;l<=degree;l++) for(let k=0;k<=2*l;k++)
    attributes[key('SH_DEGREE_'+l+'_COEF_'+k)]=attr(sh[l*l+k],'VEC3');
  return {mode:0,attributes,extensions:{[EXT]:{kernel:'ellipse',colorSpace:'srgb_rec709_display'}}};
}

function writeMaterial(image, maps, texture) {
  const {width,height,pixels}=image;
  const add=(data,name)=>({index:texture(PNG.encode(width,height,data,4),name)});
  const result={name:'Recovered scan surface',alphaMode:'MASK',pbrMetallicRoughness:{
    baseColorTexture:add(pixels,'Registered diffuse color'),metallicFactor:0,roughnessFactor:1}};
  if (!maps) return result;
  const {roughness,normal,photograph,projection,angles,daylight}=maps;
  const pbr=result.pbrMetallicRoughness;
  if (typeof roughness==='number') pbr.roughnessFactor=roughness;
  else {
    const packed=new Uint8Array(width*height*4);
    for(let i=0;i<roughness.length;i++) packed.set([255,roughness[i],0,255],i*4);
    pbr.metallicRoughnessTexture=add(packed,'Registered roughness');
  }
  if (normal) result.normalTexture=add(normal,'Registered tangent normals');
  result.extras={inkStudioScanMaterial:{version:1,daylight,
    ...(photograph && {captured:add(photograph,'Captured directional color'),projection,angles})}};
  return result;
}

function encodeScan(geometry, cloud, selection, kind, kit, name) {
  const doc=document(), {gltf,add,accessor,texture,finish}=doc, parts=[];
  gltf.asset.extras={inkStudioScanSurface:1};
  if(kind!=='source') {
    const {positions,uvs,indices,image,maps}=geometry;
    const material=add('materials',writeMaterial(image,maps,texture));
    parts.push({attributes:{POSITION:accessor(positions,'VEC3',{bounds:true,target:34962}),
      TEXCOORD_0:accessor(uvs,'VEC2',{target:34962})},indices:accessor(indices,'SCALAR',{target:34963}),material});
  }
  if(kind!=='mesh') {
    const residual=addGaussians(doc,cloud,kind==='source'?null:selection,kit);
    if(residual) parts.push(residual);
  }
  const mesh=add('meshes',{name,primitives:parts});
  gltf.scenes[0].nodes.push(add('nodes',{ name,mesh }));
  return finish();
}

async function scanToMesh(capture, { toolkit=require('../index.js').load(), cloud, meshStride=capture?.stride,
    sampleStride, materials, paintRadius=2, rgbThreshold=16, tolerance, residualLimit=30000, name='Captured surface' }={}) {
  const kit=toolkit.KIT ?? toolkit, {width,height}=capture ?? {};
  if (![width,height].every(n=>Number.isSafeInteger(n)&&n>=2&&n<=2048))
    throw new RangeError('Scan images must have 2 to 2048 pixels per dimension');
  if (!Number.isInteger(paintRadius)||paintRadius<0||paintRadius>8||
      !(Number.isFinite(rgbThreshold)&&rgbThreshold>0&&rgbThreshold<=255)||
      tolerance!==undefined&&!(Number.isFinite(tolerance)&&tolerance>0)||
      !Number.isSafeInteger(residualLimit)||residualLimit<0||residualLimit>250000||
      typeof name!=='string'||!name.trim())
    throw new RangeError('Invalid scan pigment, threshold, tolerance, name or residual budget');
  const minStride=Math.max(1,Math.ceil(Math.sqrt(width*height/depthLimit)));
  const expandedStride=sampleStride ?? minStride;
  const model=kit.depth.fromMap({...capture,stride:meshStride,isolatedPatches:false});
  if (!model.front.tri.length) throw new RangeError('The scan has no connected opaque surface at this stride and depth jump');
  if (model.front.tri.length>750000) throw new RangeError('The scan exceeds the native triangle budget. Increase mesh stride.');
  const maps=scanMaterials(capture,model,materials);
  const image=material(capture,model,maps?.diffuse?0:paintRadius,maps?.diffuse);
  const geometry={...compactSurface(model,image),maps};
  const opaque=kit.sceneMeshes.create({id:'scan-surface',...geometry,materials:[{id:'scan-pigment',texture:image}]});
  const supplied=!!cloud;
  if (cloud) checkCloud(cloud);
  else {
    const observed=kit.depth.fromMap({...capture,stride:expandedStride,isolatedPatches:false});
    cloud=measuredSplats(observed,observed.stride,maps?.diffuse);
  }
  const {chosen,reasons}=closestParts(cloud,opaque,model,capture,{rgbThreshold,tolerance,residualLimit},kit);
  const glb=encodeScan(geometry,cloud,chosen,'hybrid',kit,name);
  const { gaussianGltfWorld }=await import('../src/gaussian-gltf.mjs');
  const decodeImage=require('./gltf-image.js');
  const world=(kind='hybrid')=>{
    if (!['source','mesh','hybrid'].includes(kind)) throw new RangeError('Scan view needs source, mesh or hybrid');
    const bytes=kind==='hybrid' ? glb : encodeScan(geometry,cloud,chosen,kind,kit,name);
    return gaussianGltfWorld(bytes,{toolkit,decodeImage});
  };
  const { scaleAt, ...camera }=model.camera;
  return { glb, world, report:{
    format:'ink-studio.scan-mesh',version:1,name,source:supplied?'registered-gaussians':'rgbd',
    width,height,camera,meshStride:model.stride,...(!supplied && {sampleStride:expandedStride}),paintRadius,rgbThreshold,residualLimit,
    maxDepthJump:Number.isFinite(model.maxDepthJump)?model.maxDepthJump:null,tolerance:tolerance??null,
    triangles:opaque.triangles,vertices:opaque.vertices,sourceSplats:cloud.count,residualSplats:chosen.length,reasons,
    ...(maps && {material:{diffuse:maps.diffuse?'supplied':'capture',normal:maps.normal?'tangent-map':'geometry',
      roughness:typeof maps.roughness==='number'?maps.roughness:'texture',captured:!!maps.photograph}}),
    ...(cloud.degree>3 && {sourceHarmonics:cloud.degree,exportedHarmonics:3})
  }};
}

function materialOptions(opt, capture) {
  if (['diffuse','normal','roughness','capture-layer'].every(key=>opt[key]===undefined)) return undefined;
  function image(flag) {
    if(typeof opt[flag]!=='string') throw new TypeError('--'+flag+' needs an aligned PNG');
    const decoded=colorImage(path.resolve(opt[flag]));
    if(decoded.width!==capture.width||decoded.height!==capture.height)
      throw new RangeError('--'+flag+' must match the capture dimensions');
    return decoded;
  }
  const value=opt.roughness;
  if (value===true) throw new TypeError('--roughness needs a scalar or aligned PNG');
  const roughness=value===undefined ? undefined : Number.isFinite(Number(value)) ? Number(value) :
    image('roughness').data.filter((_,i)=>i%4===0);
  if (opt['capture-layer']!==undefined && ![true,'on','off'].includes(opt['capture-layer']))
    throw new TypeError('--capture-layer expects on or off');
  return {diffuse:opt.diffuse!==undefined?image('diffuse'):undefined,normal:opt.normal!==undefined?image('normal').data:undefined,
    roughness,captured:opt['capture-layer']!==undefined&&opt['capture-layer']!=='off'};
}

async function command(file,opt,kit) {
  if (!file || typeof opt.out!=='string' || path.extname(opt.out).toLowerCase()!=='.glb')
    throw new TypeError('Use scan-mesh <depth.json|depth.png> --image aligned.png --out prop.glb');
  const capture=readDepthInput(file,opt);
  if(opt.cloud===true) throw new TypeError('--cloud needs a registered PLY, SPZ or GSZ filename');
  const cloud=opt.cloud && await require('./gaussian-splats.js').readGaussianSplat(path.resolve(opt.cloud));
  const numeric=flag=>opt[flag]===undefined ? undefined : opt[flag]===true ? NaN : Number(opt[flag]);
  const result=await scanToMesh(capture,{ toolkit:kit,cloud,meshStride:numeric('mesh-stride'),sampleStride:numeric('sample-stride'),
    materials:materialOptions(opt,capture),paintRadius:numeric('paint-radius'),rgbThreshold:numeric('rgb-threshold'),tolerance:numeric('surface-tolerance'),
    residualLimit:numeric('residual-limit'),name:path.basename(opt.out,path.extname(opt.out)) });
  const out=path.resolve(opt.out);
  files.write(out,result.glb);
  files.json(out.replace(/\.glb$/i,'.scan.json'),result.report);
  console.log('wrote',out,result.report.triangles,'triangles and',result.report.residualSplats,'of',result.report.sourceSplats,'splats');
}

module.exports={scanToMesh,command};
