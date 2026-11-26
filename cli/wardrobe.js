const fs=require('node:fs'), path=require('node:path');
const { fields, record, localName, sha, compile }=require('./character-rig-assembly.js');
const { read }=require('./character-rig-bind.js');
const { compileCatalog, getClip, sample:sampleMotion }=require('./character-motion.js');
const { openGraphArtifactCache }=require('./graph-artifact-cache.js');
const { graphOutputs }=require('./graph-outputs.js');
const { cloth, integer, pigment }=require('./wardrobe-cloth.js');
const { attachments }=require('./wardrobe-details.js');
const files=require('./asset-files.js');
const PNG=require('./png.js');

const format='ink-studio/wardrobe-plan', takeFormat='ink-studio/wardrobe-take';
const bakeFormat='ink-studio/wardrobe-bake', frameFormat='ink-studio/wardrobe-frame';
const zero=[0,0,0];

function open(planFile, kit) {
  const K=kit.KIT, {V,M}=K, owner=path.resolve(planFile);
  const {document:plan,sha256}=read(owner), sources=[owner], dependencies={plan:sha256};
  if (!fields(plan,['format','version','id','seed','rig','simulation','panels','seams','colliders','grooms','feathers'])||
      plan.format!==format||plan.version!==1||!localName(plan.id)||
      plan.seed!==undefined&&!Number.isSafeInteger(plan.seed))
    throw new TypeError('Expected a version 1 wardrobe plan');
  function asset(ref,name) {
    if (typeof ref!=='string'||!ref.trim()||path.isAbsolute(ref)||path.win32.isAbsolute(ref))
      throw new TypeError('Wardrobe asset paths must be relative to their plan');
    const file=path.resolve(path.dirname(owner),ref), {document,sha256}=read(file);
    sources.push(file);
    dependencies[name]=sha256;
    return document;
  }
  let rig, catalog, clip;
  if (plan.rig!==undefined) {
    const row=plan.rig;
    if (!fields(row,['file','motion','clip','contacts'])||((row.motion===undefined)!==(row.clip===undefined))||
        row.contacts!==undefined&&typeof row.contacts!=='boolean')
      throw new TypeError('Wardrobe rig needs a file and an optional motion catalog and clip');
    rig=compile(asset(row.file,'rig'),K);
    if (row.motion!==undefined) {
      catalog=compileCatalog(rig,asset(row.motion,'motion'),K);
      clip=getClip(catalog,row.clip);
    }
  }
  const joints=rig?.indices??new Map(), fabric=cloth(plan,joints,K), details=attachments(plan,fabric,joints,K);
  if (!fabric.panels.length&&!details.summary.grooms.length&&!details.summary.feathers)
    throw new RangeError('Include at least one panel, groom, or feather row');
  let lastTime, pose;
  function matrix(joint,time) {
    if (joint===undefined||catalog===undefined) return undefined;
    const at=Math.max(0,Math.min(time,clip.duration));
    if (lastTime!==at) {
      pose=sampleMotion(catalog,clip.name,at,K,!plan.rig.contacts);
      if (!pose.solve.passed) throw new RangeError('Wardrobe rig contact solve failed at '+at);
      lastTime=at;
    }
    return pose.joints[joint].matrix;
  }
  const transform={
    point(joint,point,time) {
      const map=matrix(joint,time);
      return map?V.add(M.app(map,point),map.slice(9)):point;
    },
    direction(joint,point,time) {
      const map=matrix(joint,time);
      return map?M.app(map,point):point;
    }
  };
  const {id}=plan,{fps,frames:count}=fabric;
  function bake() {
    const {frames,report}=fabric.bake(transform.point);
    const take={format:takeFormat,version:1,id,dependencies,fps,count,frames,report:{...report,...details.summary}};
    const bytes=Buffer.from(JSON.stringify(take)+'\n'), hash=sha(bytes);
    return {artifacts:[{file:'take.json',bytes,sha256:hash}],
      report:{format:bakeFormat,version:1,id,dependencies,fps,count,takeSha256:hash,...take.report}};
  }
  function validate(take) {
    if (take?.format!==takeFormat||take.version!==1||take.id!==id||take.fps!==fps||take.count!==count||
        !record(take.dependencies)||Object.keys(take.dependencies).length!==Object.keys(dependencies).length||
        Object.entries(dependencies).some(([key,value])=>take.dependencies[key]!==value)||
        !Array.isArray(take.frames)||take.frames.length!==count||
        take.frames.some(row=>!Array.isArray(row)||row.length!==fabric.points*3||!row.every(value=>Number.isFinite(value)&&Math.abs(value)<=1e5)))
      throw new RangeError('Wardrobe take does not match the plan, assets or frame topology');
    return take;
  }
  function frame(take,index) {
    if (!integer(index,0,count-1)) throw new RangeError('Choose a frame inside the wardrobe take');
    const time=index/fps, positions=take.frames[index];
    const panels=fabric.panels.map(panel=>{
      const {id,start,nu,nv,side,color,trim,layer,pins}=panel, indices=[],faceMaterials=[];
      for (const [i,face] of panel.faces.entries()) {
        const [a,b,c]=face;
        indices.push(a,...(side===1?[b,c]:[c,b]));
        const cell=Math.floor(i/2),x=cell%(nu-1),y=Math.floor(cell/(nu-1));
        faceMaterials.push(Number(trim!==color&&(x===0||x===nu-2||y===nv-2)));
      }
      return {id,layer,positions:positions.slice(start*3,(start+nu*nv)*3),indices,faceMaterials,
        uvs:panel.layout.flatMap(([u,v])=>[u,v]),colors:[color,trim],pinned:[...pins.keys()]};
    });
    return {format:frameFormat,version:1,id,frame:index,time,panels,...details.sample(positions,transform,time),
      seams:take.report?.seams?.map(row=>({id:row.id,stitches:row.stitches,error:row.frames?.[index]})),
      contact:take.report?.collision?.frames?.[index]};
  }
  return {sources,dependencies,bake,validate,frame};
}

function combineFeathers(feathers) {
  const batches=[];
  let row, pigments;
  for (const feather of feathers) {
    if (!row || pigments.size+feather.colors.filter(color=>!pigments.has(color)).length>64) {
      row={id:'wardrobe/plumage-'+(batches.length+1),positions:[],indices:[],uvs:[],colors:[],faceMaterials:[]};
      pigments=new Map();
      batches.push(row);
    }
    const names=feather.colors.map(color=>{
      if (!pigments.has(color)) {
        pigments.set(color,row.colors.length);
        row.colors.push(color);
      }
      return pigments.get(color);
    });
    const offset=row.positions.length/3;
    row.positions.push(...feather.positions);
    row.uvs.push(...feather.uvs);
    row.indices.push(...feather.indices.map(i=>offset+i));
    row.faceMaterials.push(...feather.faceMaterials.map(i=>names[i]));
  }
  return batches;
}

function renderFrame(kit, frame, settings={}, decorate) {
  if (!fields(settings,['w','h','background','camera','raw'])||!integer(settings.w??288,32,1024)||
      !integer(settings.h??240,32,1024)||(settings.w??288)*(settings.h??240)>524288||
      !pigment(settings.background??'#13242e')||settings.camera!==undefined&&!record(settings.camera)||
      settings.raw!==undefined&&typeof settings.raw!=='boolean')
    throw new TypeError('Wardrobe preview needs bounded dimensions and a camera record');
  const {KIT:K,makeBuilder}=kit, {w=288,h=240,background='#13242e',camera,raw=true}=settings;
  const colors=[background,'#aebbc4',...frame.panels.flatMap(row=>row.colors),
    ...frame.feathers.flatMap(row=>row.colors),...frame.grooms.flatMap(row=>row.colors)];
  const B=makeBuilder(1,[...new Set(colors)].slice(0,256).map(value=>parseInt(value.slice(1),16)));
  const meshes=[...frame.panels,...combineFeathers(frame.feathers)].map(({id,positions,indices,uvs,colors,faceMaterials})=>
    K.sceneMeshes.create({id,positions,indices,uvs,faceMaterials,
      materials:colors.map((color,i)=>({id:id+'-pigment-'+i,color:parseInt(color.slice(1),16)}))}));
  for (const groom of frame.grooms) K.curveSplats.draw(B,groom.plan,{
    object:groom.id,opacity:.94,edge:'hard',material:'groom',
    taper:[[0,1],[.7,.82],[1,.13]],color:({clump,index})=>groom.colors[(clump??index??0)%groom.colors.length]
  });
  for (const feather of frame.feathers) {
    const {points,width,color}=feather.shaft;
    K.curveSplats.draw(B,{kind:'path',points},{object:feather.id,material:'quill',width,color,
      opacity:.9,taper:[[0,.42],[.3,1],[1,.08]]});
  }
  decorate?.(B,meshes,frame);
  const world=B.finish({id:frame.id,meshes,cam:{target:[0,1,0],dist:5.4,yaw:-.18,pitch:.12,ortho:true},
    radius:5,fog:{c:0,start:1,max:0},dither:0,look:{pixelSize:1}});
  return require('./render.js').render(world,{w,h,px:1,t:0,raw,shutter:false,renderGrid:false,
    ...(camera&&{camera:K.procedural.sceneGraph.camera(camera)})});
}

const actions={bake:{count:1,flags:['out','cache']},sample:{count:2,flags:['out','frame']},
  preview:{count:2,flags:['out','frame','view']}};
function command([action,...args],options,kit) {
  const mode=Object.hasOwn(actions,action)&&actions[action];
  if (!mode||args.length!==mode.count||['bake','preview'].includes(action)&&!options.out||
      Object.entries(options).some(([key,value])=>!mode.flags.includes(key)||typeof value!=='string'||!value.trim()))
    throw new TypeError('Use wardrobe bake|sample|preview. See ink-studio help.');
  const project=open(args[0],kit), out=options.out&&path.resolve(options.out);
  let result, output;
  if (action==='bake') {
    if (out) graphOutputs(project.sources).protect(fs.statSync(out,{throwIfNoEntry:false}));
    const run=options.cache?
      openGraphArtifactCache(options.cache,{kit})('wardrobe',{fingerprint:bakeFormat},project.dependencies,project.bake):
      project.bake();
    output=run.artifacts[0].bytes;
    result=run.report;
  } else {
    const take=project.validate(read(path.resolve(args[1])).document);
    project.sources.push(path.resolve(args[1]));
    const frame=project.frame(take,Number(options.frame??0));
    if (action==='sample') result=frame;
    else {
      if (options.view) project.sources.push(path.resolve(options.view));
      const image=renderFrame(kit,frame,options.view?read(path.resolve(options.view)).document:{});
      output=PNG.encode(image.w,image.h,image.rgb,3,{srgb:true});
      result={format:'ink-studio/wardrobe-preview',version:1,id:frame.id,frame:frame.frame,w:image.w,h:image.h,sha256:sha(output)};
    }
  }
  if (out) {
    graphOutputs(project.sources).protect(fs.statSync(out,{throwIfNoEntry:false}));
    if (output) files.write(out,output);
    else files.json(out,result);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports={command,open,renderFrame};
