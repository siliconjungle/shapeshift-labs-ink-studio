// Disk-backed pixel sessions for the material cells of an object-local bake.
const fs=require('node:fs');
const path=require('node:path');
const files=require('./asset-files.js');
const PNG=require('./png.js');
const Sessions=require('./pixel-edit-session.js');
const R=require('./render.js');

const sourceFormat='ink-studio/object-texel-source';
const format='ink-studio/object-texel-watch';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const name=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
const text=value=>typeof value==='string'&&Boolean(value.trim());
const record=(row,fields)=>row && Object.getPrototypeOf(row)===Object.prototype &&
  Object.keys(row).every(key=>fields.includes(key));
const tuple=(row,n)=>Array.isArray(row)&&row.length===n&&Array.from(row).every(Number.isFinite);

function buildSource(source,api) {
  if (!record(source,['format','version','id','mesh','origin','resolution','material','fallback','cells','lighting']) ||
      source.format!==sourceFormat || source.version!==1 || !name(source.id) ||
      !record(source.mesh,['points','triangles']) || source.cells!==undefined&&!Array.isArray(source.cells))
    throw new TypeError('Use a version 1 object texel source with a named triangle mesh');
  const {mesh,origin,resolution,material={pigment:0x697f8c},fallback=material,cells=[]}=source;
  const baked=api.bakeObjectTexels(mesh,{origin,resolution,material:()=>material,fallback:()=>fallback});
  return api.editObjectTexels(baked,cells);
}

function views(raw) {
  if (!record(raw,['format','version','w','h','views']) || raw.format!==format || raw.version!==1 ||
      ![raw.w,raw.h].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1024) ||
      !Array.isArray(raw.views)||!raw.views.length||raw.views.length>16||
      raw.w*raw.h*raw.views.length>2000000 || new Set(raw.views.map(row=>row?.id)).size!==raw.views.length)
    throw new RangeError('Use a version 1 native texel watch with 1–16 distinct views within the pixel budget');
  for(const row of raw.views) {
    const camera=row?.camera ?? {};
    if (!record(row,['id','camera','poseYaw','light']) || !name(row.id) ||
        !record(camera,['yaw','pitch','dist','target','ortho','fov']) ||
        ['yaw','pitch','dist','fov'].some(key=>camera[key]!==undefined&&!Number.isFinite(camera[key])) ||
        camera.dist!==undefined&&camera.dist<=0 || camera.ortho!==undefined&&typeof camera.ortho!=='boolean' ||
        camera.target!==undefined&&!tuple(camera.target,3) || row.poseYaw!==undefined&&!Number.isFinite(row.poseYaw) ||
        row.light!==undefined&&(!tuple(row.light,3)||Math.hypot(...row.light)<=1e-6))
      throw new TypeError('Each texel watch view needs a valid ID, camera, and optional rigid yaw and light direction');
  }
  return raw;
}

function overlay(frame, mask) {
  const rgb=frame.rgb.slice(), tints=[[0,0,0],[104,236,204],[255,177,88]];
  for(let p=0;p<mask.length;p++) if(mask[p])
    for(let k=0;k<3;k++) rgb[p*3+k]=Math.round(rgb[p*3+k]*.37+tints[mask[p]][k]*.63);
  return rgb;
}

function watch(source,editor,raw,kit,out,input) {
  const {KIT:K}=kit, {w,h,views:samples}=views(raw);
  const filenames=['watch.json',...samples.flatMap(({id})=>[id+'.png',id+'-watch.png'])];
  if(out&&filenames.some(name=>path.join(out,name)===path.resolve(input)))
    throw new RangeError('Write the texel watch separately from its request');
  const mesh=K.sceneMeshes.fromObjectTexels(editor.bake(),{id:source.id,lighting:source.lighting});
  const points=Array.from({length:source.mesh.points.length/3},(_,i)=>source.mesh.points.slice(i*3,i*3+3));
  const {min,max}=K.procedural.spatial.boxOf(points);
  const target=K.V.lerp(min,max,.5), dist=Math.max(.01,K.V.dist(min,max)*1.48);
  const world=kit.makeBuilder(27,[0x172735,0x284151]).finish({meshes:[mesh],radius:Math.max(5,dist),dither:0,
    cam:{target,dist,yaw:.2,pitch:.19,ortho:true},
    skyEnvironment:{defaults:{zenith:'#20364a',horizon:'#47616b',ground:'#162b39',sunStrength:0}}});
  const rig=K.sceneMeshes.skin(mesh,Array(mesh.vertices).fill(0));
  const {binding,revision,selection,protected:protectedIds}=editor.status();
  const report={format,version:1,binding,revision,mesh:mesh.id,selection,protected:protectedIds,native:[w,h],views:[]};
  for(const {id,camera,poseYaw=0,light=[-.53,.64,.58]} of samples) {
    const c=Math.cos(poseYaw),s=Math.sin(poseYaw),[x,,z]=target;
    rig.pose([c,0,s,0,1,0,-s,0,c,x-c*x-s*z,0,z+s*x-c*z]);
    const frame=R.render(world,{w,h,px:1,raw:true,camera,passes:['sourceSurface'],
      liveSun:{direction:light,ambient:.38,intensity:.86,shadows:false},renderGrid:false,cameraGuides:false,shutter:false});
    if (frame.w!==w||frame.h!==h) throw new RangeError('Texel watch needs the requested native art grid');
    const hit=editor.watch(mesh,frame), selectedPixels=hit.mask.reduce((n,value)=>n+Number(value!==0),0);
    const painted=out && {image:id+'.png',watch:id+'-watch.png'};
    if (painted) {
      files.write(path.join(out,painted.image),PNG.encode(w,h,frame.rgb));
      files.write(path.join(out,painted.watch),PNG.encode(w,h,overlay(frame,hit.mask)));
    }
    report.views.push({id,poseYaw,camera:camera??{},light,selectedPixels,visible:hit.visible,hidden:hit.hidden,
      cellAt:Array.from(hit.cellAt),...painted});
  }
  if(out) files.json(path.join(out,'watch.json'),report);
  return report;
}

async function command([action,directory,input,...rest],options,kit) {
  const {out}=options;
  const paired=['init','run','watch'].includes(action);
  if(!['init','status','run','watch'].includes(action)||!text(directory)||rest.length||
      (paired?!text(input):input!==undefined)||Object.keys(options).some(key=>key!=='out')||
      out!==undefined&&(!text(out)||action==='init'))
    throw new TypeError('Use pixel-art texels init|run|watch <directory> <source-or-request.json>, or status <directory>');
  const sessionPath=path.resolve(directory), target=out && path.resolve(out);
  if(target&&(target===sessionPath||target.startsWith(sessionPath+path.sep)||input&&path.resolve(input)===target))
    throw new RangeError('Save texel outputs outside the edit session and separate from the input');
  const api=await import('../src/object-texels.mjs');
  const loaded=action==='init'?undefined:Sessions.read(directory);
  if(loaded&&loaded.contents.kind!=='object-texels') throw new TypeError('Open an object texel edit session');
  const source=loaded?.contents.scene ?? read(input), bake=buildSource(source,api);
  const editor=api.createObjectTexelEditor(bake,{KIT:kit.KIT,session:loaded?.contents.journal});
  const persist=()=>Sessions.attach(directory,()=>({kind:'object-texels',scene:source}),editor,loaded);
  let result;
  if(action==='init') {
    const session=persist();
    session.detach();
    result=editor.status();
  } else if(action==='run') {
    const session=persist();
    try {
      const receipt=editor.execute(read(input));
      if(!session.status().saved) throw new Error(session.status().error);
      result={receipt,status:editor.status()};
    } finally {session.detach();}
  } else if(action==='watch') {
    result=watch(source,editor,read(input),kit,target,input);
    if(target) result={watch:path.join(target,'watch.json'),views:result.views.map(row=>({id:row.id,selectedPixels:row.selectedPixels}))};
  } else result=editor.status();
  if(target&&action!=='watch') files.json(target,result);
  else console.log(JSON.stringify(result,null,2));
}

module.exports={command,buildSource};
