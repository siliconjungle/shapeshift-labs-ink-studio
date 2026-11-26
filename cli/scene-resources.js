const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { fromGltf,toGltf } = require('./scene-resource-gltf.js');
const Assets = require('./asset-files.js');
const INFO = 'ink-studio/scene-resources';

const USD=new Set(['.usd','.usda','.usdc','.usdz']);
const GLTF=new Set(['.glb','.gltf']);
const EXTERNAL=new Set(['.obj','.fbx','.ply','.stl']);
const kind = filename => path.extname(filename).toLowerCase();
const digest = value => createHash('sha256').update(value).digest('hex');
const id = n => Number.isSafeInteger(n)&&n>=0;
const vector = (value,length) => Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);
const stat = file => fs.statSync(file);
const optics = name => ['base','emissive','normal'].includes(name)?'rgb':'rgba';
const scripts = name => path.join(__dirname,name);

function run(executable,args,name,maxBuffer=96*1024**2) {
  const p=spawnSync(executable,args,{stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer,timeout:180000,windowsHide:true});
  if(p.error)throw new Error(name+' could not run ('+p.error.message+')');
  if(p.status!==0)throw new Error(name+' failed\n'+(p.stderr||p.stdout||'').trim().slice(-6000));
  return p.stdout;
}
function bridge(python,operation,source,destination) {
  const label='OpenUSD/MaterialX '+operation+' (use --python for an interpreter with usd-core and MaterialX)';
  return JSON.parse(run(python,['-B',scripts('scene_resource_bridge.py'),operation,source,destination],label));
}
function external(blender,input,output) {
  if(typeof blender!=='string'||!blender.trim())throw new TypeError('This format requires --blender /path/to/blender');
  run(blender,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1',
    '--python',scripts('scene_resource_blender.py'),'--',input,output],'Blender scene conversion',8*1024**2);
  if(!fs.existsSync(output))throw new Error('Blender produced no scene file');
}
function workspace(fn) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-scene-'));
  try { return fn(folder); }
  finally { fs.rmSync(folder,{recursive:true,force:true}); }
}

function validateMaterials(materials) {
  if(!Array.isArray(materials)||materials.length>2048)throw new RangeError('Invalid scene material budget');
  for(const material of materials) {
    const {name,color,roughness,metallic,emission,alphaMode,cutoff,doubleSided,maps}=material;
    if(typeof name!=='string'||!name.trim()||!vector(color,4)||!vector(emission,3)||
       ![...color,...emission,roughness,metallic,cutoff].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||
       !['OPAQUE','MASK','BLEND'].includes(alphaMode)||typeof doubleSided!=='boolean'||!maps)
      throw new TypeError('Invalid normalized PBR material values on '+name);
    for(const [key,map] of Object.entries(maps)) {
      const channel=optics(key);
      if(!['base','normal','emissive','roughness','metallic','opacity','ao'].includes(key)||
         (channel==='rgb'?map.channel!=='rgb':!['r','g','b','a'].includes(map.channel))||
         !id(map.uv)||map.uv>31||![map.wrapS,map.wrapT].every(n=>['mirror','repeat','clamp'].includes(n))||
         typeof map.file!=='string'||!stat(map.file).isFile()||stat(map.file).size>32*1024**2)
        throw new TypeError('Invalid texture resource or UV binding on '+name+' '+key);
    }
  }
}
function validateScene(scene) {
  validateMaterials(scene.materials);
  let corners=0;
  if(!Array.isArray(scene.nodes)||scene.nodes.length>4096||!scene.meshes.length||scene.meshes.length>2048)
    throw new RangeError('Scene resource needs bounded mesh and hierarchy tables');
  for(const [i,row] of scene.nodes.entries()) {
    if(typeof row.name!=='string'||!vector(row.matrix,16)||
       row.parent!==null&&(!id(row.parent)||row.parent>=i)||
       row.mesh!==null&&(!id(row.mesh)||!scene.meshes[row.mesh])||
       row.matrix[3]!==0||row.matrix[7]!==0||row.matrix[11]!==0||row.matrix[15]!==1)
      throw new TypeError('Invalid affine scene transform or mesh reference');
  }
  for(const mesh of scene.meshes) {
    if(!Array.isArray(mesh.parts)||!mesh.parts.length||mesh.parts.length>256)
      throw new RangeError('Invalid scene material groups');
    for(const p of mesh.parts) {
      const {position,indices,normal,uv,material}=p;
      corners+=indices.length;
      if(!position.length||position.length%3||!position.every(Number.isFinite)||
         !indices.length||indices.length%3||corners>1_500_000||!indices.every(i=>id(i)&&i<position.length/3)||
         normal&&(!vector(normal,position.length)||normal.some((v,i)=>i%3===0&&Math.abs(Math.hypot(v,normal[i+1],normal[i+2])-1)>.005))||
         Object.entries(uv).some(([key,data])=>!/^\d+$/.test(key)||+key>31||!vector(data,position.length/3*2))||
         material!==null&&(!id(material)||!scene.materials[material]))
        throw new TypeError('Invalid topology, normals, UVs or material slot on '+mesh.name);
      if(material!==null)for(const [channel,{uv:set}] of Object.entries(scene.materials[material].maps))
        if(!Object.hasOwn(uv,set))throw new RangeError(mesh.name+' material '+scene.materials[material].name+' uses missing TEXCOORD_'+set+' for '+channel);
    }
  }
  if(!scene.nodes.some(n=>n.mesh!==null))throw new RangeError('The active scene has no mesh groups');
  return scene;
}
function pathsFor(scene) {
  const paths=[], siblings=new Map();
  for(const row of scene.nodes) {
    const parent=row.parent===null?'':paths[row.parent], key=parent+'/'+encodeURIComponent(row.name);
    const order=siblings.get(key)??0;
    siblings.set(key,order+1);
    paths.push(key+'['+order+']');
  }
  return paths;
}
function describe(scene,dependencies) {
  const paths=scene.nodes&&pathsFor(scene), hashes=new Map();
  const materials=scene.materials.map(m=>({...m,maps:Object.fromEntries(Object.entries(m.maps).map(([key,{file,...map}])=>{
    if(!hashes.has(file))hashes.set(file,digest(fs.readFileSync(file)));
    return [key,{...map,sha256:hashes.get(file)}];
  }))}));
  const groups=scene.nodes?.map((row,i)=>({name:row.name,path:paths[i],parent:row.parent===null?null:paths[row.parent],matrix:row.matrix,
    ...(row.mesh!==null&&{mesh:scene.meshes[row.mesh].name,parts:scene.meshes[row.mesh].parts.map(p=>({
      triangles:p.indices.length/3,vertices:p.position.length/3,normal:Boolean(p.normal),
      material:p.material===null?null:scene.materials[p.material].name,uvSets:Object.keys(p.uv).map(Number)
    }))})}));
  return {format:INFO,version:1,name:scene.name,sourceSpace:scene.sourceSpace??{upAxis:'Y',metersPerUnit:1},
    ...(groups&&{groups}),materials,uniqueTextures:hashes.size,dependencies:[...dependencies].sort()};
}
function near(a,b) {
  return a.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<=2e-6*Math.max(1,Math.abs(n),Math.abs(b[i])));
}
function compare(source,target) {
  const a=pathsFor(source), b=new Map(pathsFor(target).map((key,i)=>[key,target.nodes[i]]));
  const results={hierarchy:a.length===b.size&&a.every(key=>b.has(key)),transforms:true,meshGroups:true,
    triangleData:true,materialSlots:true,uvSets:true,textureBindings:true};
  const hashes=new Map();
  function textureHash(file) {
    if(!hashes.has(file))hashes.set(file,digest(fs.readFileSync(file)));
    return hashes.get(file);
  }
  function checkTexture(ma,mb) {
    const keys=Object.keys(ma.maps);
    return keys.length===Object.keys(mb.maps).length&&keys.every(key=>{
      const x=ma.maps[key],y=mb.maps[key];
      return y&&x.uv===y.uv&&x.channel===y.channel&&x.wrapS===y.wrapS&&x.wrapT===y.wrapT&&
        textureHash(x.file)===textureHash(y.file);
    });
  }
  for(const [i,row] of source.nodes.entries()) {
    const next=b.get(a[i]);
    if(!next) { for(const key of Object.keys(results))results[key]=false;continue; }
    results.transforms&&=near(row.matrix,next.matrix);
    const mp=row.mesh===null?null:source.meshes[row.mesh], np=next.mesh===null?null:target.meshes[next.mesh];
    if(!mp&&!np)continue;
    if(!mp||!np||mp.name!==np.name||mp.parts.length!==np.parts.length) {
      Object.assign(results,{meshGroups:false,triangleData:false,materialSlots:false,uvSets:false,textureBindings:false});
      continue;
    }
    for(const [j,p] of mp.parts.entries()) {
      const q=np.parts[j], left=source.materials[p.material], right=target.materials[q.material];
      results.triangleData&&=p.indices.length===q.indices.length&&Boolean(p.normal)===Boolean(q.normal)&&
        p.indices.every((vertex,i)=>{
          const v=q.indices[i], x=vertex*3, y=v*3;
          return near(p.position.slice(x,x+3),q.position.slice(y,y+3))&&(!p.normal||near(p.normal.slice(x,x+3),q.normal.slice(y,y+3)));
        });
      results.materialSlots&&=(left?.name??null)===(right?.name??null)&&(!left||right&&
        near([...left.color,...left.emission,left.roughness,left.metallic,left.cutoff],
          [...right.color,...right.emission,right.roughness,right.metallic,right.cutoff])&&left.alphaMode===right.alphaMode&&
          left.doubleSided===right.doubleSided);
      if(left&&right&&results.textureBindings)results.textureBindings=checkTexture(left,right);
      const uvs=Object.keys(p.uv);
      results.uvSets&&=uvs.length===Object.keys(q.uv).length&&uvs.every(key=>q.uv[key]&&p.indices.length===q.indices.length&&
        p.indices.every((vertex,i)=>near(p.uv[key].slice(vertex*2,vertex*2+2),q.uv[key].slice(q.indices[i]*2,q.indices[i]*2+2))));
    }
  }
  return results;
}

function read(input,folder,{python,blender},dependencies) {
  const ext=kind(input), textureDir=path.join(folder,'tex');
  fs.mkdirSync(textureDir,{recursive:true});
  dependencies.add(input);
  let value;
  if(USD.has(ext))value=bridge(python,'read-usd',input,textureDir);
  else if(ext==='.mtlx')value=bridge(python,'read-materialx',input,textureDir);
  else if(GLTF.has(ext))value=fromGltf(input,textureDir,file=>dependencies.add(file));
  else if(EXTERNAL.has(ext)) {
    const intermediate=path.join(folder,'external.glb');
    external(blender,input,intermediate);
    value=fromGltf(intermediate,textureDir);
  } else throw new TypeError('Choose a glTF, USD, MaterialX, or supported external scene resource');
  for(const file of value.dependencies??[])dependencies.add(path.resolve(file));
  if(ext==='.mtlx')validateMaterials(value.materials);
  else validateScene(value);
  return value;
}

function optionsOf({python=process.env.INK_SCENE_PYTHON??'python3',blender}={}) {
  if(typeof python!=='string'||!python.trim())throw new TypeError('--python needs an interpreter');
  return {python,blender};
}
function inspectSceneResource(filename,controls) {
  const input=path.resolve(filename), options=optionsOf(controls);
  return workspace(folder=>{
    const deps=new Set(), scene=read(input,folder,options,deps);
    return describe(scene,deps);
  });
}
function overrideMaterials(scene,replacement) {
  for(const material of replacement.materials) {
    const ids=scene.materials.flatMap((m,i)=>m.name===material.name?[i]:[]);
    if(ids.length!==1)throw new RangeError('MaterialX material name must match exactly one scene slot: '+material.name);
    scene.materials[ids[0]]=material;
  }
  validateScene(scene);
}
function publish(folder,root,dependencies,primary) {
  const entries=fs.readdirSync(folder,{recursive:true,withFileTypes:true}).filter(row=>row.isFile());
  const files=entries.map(row=>{
    const from=path.join(row.parentPath??row.path,row.name);
    return [from,path.join(root,path.relative(folder,from))];
  }).filter(([from,to])=>{
    if(!dependencies.has(to))return true;
    if(!fs.readFileSync(from).equals(fs.readFileSync(to)))
      throw new RangeError('Output would overwrite a scene resource dependency');
    return false;
  });
  files.sort((a,b)=>Number(a[1]===primary)-Number(b[1]===primary));
  for(const [from,to] of files)Assets.write(to,fs.readFileSync(from));
}
function convertSceneResource(filename,{out,materialx,...controls}={}) {
  if(typeof out!=='string'||!out.trim())throw new TypeError('Scene resource conversion needs --out');
  const input=path.resolve(filename), destination=path.resolve(out), ext=kind(out), options=optionsOf(controls);
  if(input===destination)throw new RangeError('Choose a different scene output file');
  return workspace(folder=>{
    const deps=new Set(), scene=read(input,path.join(folder,'source'),options,deps);
    if(materialx!==undefined) {
      if(kind(materialx)!=='.mtlx'||!scene.nodes)throw new TypeError('A MaterialX replacement needs a mesh scene and an .mtlx file');
      overrideMaterials(scene,read(path.resolve(materialx),path.join(folder,'look'),options,deps));
    }
    if(!scene.nodes&&ext!=='.mtlx')throw new TypeError('Apply a MaterialX document to a mesh scene with --materialx');
    if(deps.has(destination))throw new RangeError('Output would overwrite a scene resource input');
    const stage=path.join(folder,'deliver'), staging=path.join(stage,path.basename(out));
    fs.mkdirSync(stage);
    const descriptor=path.join(folder,'scene.json');
    fs.writeFileSync(descriptor,JSON.stringify(scene));
    if(USD.has(ext))bridge(options.python,'write-usd',descriptor,staging);
    else if(ext==='.mtlx')bridge(options.python,'write-materialx',descriptor,staging);
    else if(GLTF.has(ext))toGltf(scene,staging,path.join(folder,'packed'));
    else if(EXTERNAL.has(ext)) {
      const intermediate=path.join(folder,'native.glb');
      toGltf(scene,intermediate,path.join(folder,'packed'));
      external(options.blender,intermediate,staging);
    } else throw new TypeError('Choose a scene resource output extension');
    const output=read(staging,path.join(folder,'verify'),options,new Set());
    if(ext==='.usdz') {
      const flat=staging.replace(/\.usdz$/i,'.usdc');
      fs.rmSync(flat,{force:true});
      fs.rmSync(path.join(stage,'textures'),{recursive:true,force:true});
    }
    const result={file:destination,source:describe(scene,deps),output:describe(output,new Set()),
      ...(scene.nodes&&output.nodes&&{roundTrip:compare(scene,output)}),
      ...(EXTERNAL.has(ext)||EXTERNAL.has(kind(input))?{external:'Blender'}:{})};
    publish(stage,path.dirname(destination),deps,destination);
    return result;
  });
}
module.exports={inspectSceneResource,convertSceneResource,USD,EXTERNAL};
