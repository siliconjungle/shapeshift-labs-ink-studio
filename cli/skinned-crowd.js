const fs=require('node:fs'), path=require('node:path');
const {fields,record,range,localName,compile,sha}=require('./character-rig-assembly.js');
const {loadBinding,read}=require('./character-rig-bind.js');
const {compileCatalog}=require('./character-motion.js');
const {integer,terrain,templateMotion}=require('./skinned-crowd-motion.js');
const tissue=require('./tissue-solver.js');
const {graphOutputs}=require('./graph-outputs.js');
const PNG=require('./png.js'), files=require('./asset-files.js');

const format='ink-studio/skinned-crowd-plan', takeFormat='ink-studio/skinned-crowd-take';
const pigment=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const color=value=>parseInt(value.slice(1),16);
const at=(rows,i)=>rows.slice(i*3,i*3+3);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const tiers=['skin','proxy','culled'];

function open(planFile,kit) {
  const K=kit.KIT, {V}=K, owner=path.resolve(planFile);
  const {document:plan,sha256}=read(owner), sources=[owner], dependencies={plan:sha256};
  if(!fields(plan,['format','version','id','fps','frames','terrain','templates','actors','view','budget'])||
      plan.format!==format||plan.version!==1||!localName(plan.id)||
      !record(plan.templates)||!integer(Object.keys(plan.templates).length,1,12)||
      !Array.isArray(plan.actors)||!integer(plan.actors.length,1,120))
    throw new TypeError('Expected a version 1 skinned crowd plan');
  const {fps=24,frames=48,view={},budget={}}=plan;
  if(!integer(fps,12,120)||!integer(frames,1,240)||!fields(view,['w','h','camera','background','ground'])||
      !integer(view.w??480,32,1024)||!integer(view.h??280,32,1024)||(view.w??480)*(view.h??280)>524288||
      !pigment(view.background??'#142531')||!pigment(view.ground??'#42626a')||
      view.camera!==undefined&&!record(view.camera)||
      !fields(budget,['visible','skinned','tissue','triangles','texels','distance']))
    throw new RangeError('Crowd clock, view or budgets exceed permitted bounds');
  const limits={visible:budget.visible??24, skinned:budget.skinned??12, tissue:budget.tissue??4,
    triangles:budget.triangles??160000,texels:budget.texels??8000000,distance:budget.distance??100};
  if(!integer(limits.visible,0,31)||!integer(limits.skinned,0,31)||!integer(limits.tissue,0,31)||
      !integer(limits.triangles,0,440000)||!integer(limits.texels,0,15998000)||!range(limits.distance,.01,10000))
    throw new RangeError('Crowd budgets need bounded visibility, skin and tissue limits');
  const docs=new Map();
  function asset(ref,name,returnFile=false) {
    if(typeof ref!=='string'||!ref.trim()||path.isAbsolute(ref)||path.win32.isAbsolute(ref))
      throw new TypeError('Crowd asset paths must be relative to their plan');
    const file=path.resolve(path.dirname(owner),ref);
    if(!docs.has(file)){
      docs.set(file,read(file));
      sources.push(file);
    }
    const {document,sha256}=docs.get(file);
    dependencies[name]=sha256;
    return returnFile?{document,file}:document;
  }
  const ground=terrain(plan.terrain??{plane:0},asset,K), templates=new Map(), ids=new Set();
  for(const [id,row] of Object.entries(plan.templates)){
    if(!localName(id)||!fields(row,['rig','binding','motion','tissue','feet','rootAllowance','ragdoll','proxyRadius','proxyColor'])||
        !range(row.proxyRadius??.10,.01,2)||!pigment(row.proxyColor??'#719385'))
      throw new TypeError('A crowd template needs a rig, indexed binding and motion catalog');
    const rig=compile(asset(row.rig,id+'.rig'),K), {document:binding,file}=asset(row.binding,id+'.binding',true);
    if(!Array.isArray(binding.carriers))throw new TypeError('Crowd templates need native indexed skin carriers');
    const carriers=binding.carriers.filter(carrier=>carrier?.type==='mesh');
    const model=loadBinding(rig,{...binding,carriers},path.dirname(file),kit);
    for(const [i,file] of model.assets.entries()){
      sources.push(file);
      dependencies[id+'.carrier.'+carriers[i].id]=carriers[i].assetHash;
    }
    const catalog=compileCatalog(rig,asset(row.motion,id+'.motion'),K);
    const simulator=row.tissue===undefined?null:tissue.prepare(asset(row.tissue,id+'.tissue'),rig,K);
    const meshes=model.world.meshes.map(mesh=>{
      const geometry=K.sceneMeshes.geometry(mesh), layer=K.sceneMeshes.layer(mesh);
      return {mesh,tissue:simulator?.bind(geometry.positions),texels:layer.width*layer.height};
    });
    if(simulator&&!meshes.some(row=>row.tissue.count))throw new RangeError('No indexed skin vertices are inside '+id+' tissue cells');
    templates.set(id,{rig,model,meshes,simulator,motion:templateMotion(rig,catalog,row,K),radius:row.proxyRadius??.10,
      color:row.proxyColor??'#719385',triangles:meshes.reduce((n,{mesh})=>n+mesh.triangles,0),
      texels:meshes.reduce((n,row)=>n+row.texels,0),proxyTriangles:rig.joints.filter(j=>j.length>1e-8).length*12+8});
  }
  let values=0;
  const actors=plan.actors.map(row=>{
    if(!fields(row,['id','template','at','yaw','velocity','clip','phase','loop','priority','transitions','ragdoll'])||
        !localName(row.id)||ids.has(row.id)||!templates.has(row.template)||!range(row.priority??0,-1000,1000))
      throw new TypeError('Crowd actors need distinct IDs, a reusable template and initial placement');
    ids.add(row.id);
    const template=templates.get(row.template);
    template.motion.validate(row,frames);
    values+=template.rig.joints.length*15+(template.simulator?.nodes??0)*3;
    return row;
  });
  if(values*frames>1000000)throw new RangeError('Crowd plan exceeds its pose and tissue recording budget');
  const w=view.w??480,h=view.h??280,cam=K.procedural.sceneGraph.camera(view.camera??{
    target:[0,1.05,0],dist:11,yaw:-.22,pitch:.20,fov:.68,ortho:true});
  const radius=14, optics=kit.CameraLens.frame({cam,radius},{},w,h);
  const focal=h/(2*optics.tangent*(optics.ortho?optics.dist:1));
  const projector=kit.CameraLens.rasterProjector({view:optics.view,focal,ortho:optics.ortho,width:w,height:h});

  function visibility(points,template) {
    const entries=template.rig.joints.map((_,i)=>projector.viewPoint(at(points,i)));
    const clipped=entries.filter(p=>p[2]>=optics.clipNear-template.radius&&p[2]<=optics.clipFar+template.radius);
    const distance=V.dist(at(points,0),optics.framed);
    if(!clipped.length||distance>limits.distance)return null;
    const depth=Math.min(...clipped.map(p=>p[2])), coords=clipped.map(projector.project);
    const pad=2.8*template.radius*focal/(optics.ortho?1:Math.max(optics.clipNear,depth));
    const x=coords.map(p=>p[0]),y=coords.map(p=>p[1]);
    if(Math.max(...x)+pad<0||Math.min(...x)-pad>w||Math.max(...y)+pad<0||Math.min(...y)-pad>h)return null;
    return {depth,distance};
  }

  function bake() {
    const sessions=actors.map(actor=>{
      const template=templates.get(actor.template);
      return {actor,template,motion:template.motion.animator(actor,fps,ground),simulation:null};
    });
    const sequence=[], diagnostics={handoffs:[],contactSamples:0,missedContacts:0,maxContactError:0,
      maxTissueAgents:0,maxSkinnedAgents:0,maxVisibleAgents:0,maxRagdollBoneDrift:0,invertedCells:0,minVolumeRatio:1,maxVolumeRatio:1};
    for(let i=0;i<frames;i++){
      const rows=sessions.map(session=>{
        const pose=session.motion.step(i);
        if(![...pose.points,...pose.matrices].every(n=>range(n,-1e5,1e5)))throw new RangeError('Crowd pose exceeded world bounds');
        return {session,pose,visibility:visibility(pose.points,session.template),tier:'culled'};
      });
      const candidates=rows.filter(row=>row.visibility).sort((a,b)=>(b.session.actor.priority??0)-(a.session.actor.priority??0)||
        a.visibility.depth-b.visibility.depth||compare(a.session.actor.id,b.session.actor.id));
      let visible=0,skinned=0,details=0,triangles=0,texels=0,meshCount=0;
      for(const row of candidates){
        const {template}=row.session;
        if(visible>=limits.visible||meshCount>=31)break;
        const useSkin=skinned<limits.skinned&&meshCount+template.meshes.length<=31&&
          triangles+template.triangles<=limits.triangles&&texels+template.texels<=limits.texels;
        if(!useSkin){
          if(triangles+template.proxyTriangles>limits.triangles)continue;
          row.tier='proxy';
          visible++; meshCount++; triangles+=template.proxyTriangles;
          continue;
        }
        row.tier='skin';
        visible++; skinned++; meshCount+=template.meshes.length; triangles+=template.triangles; texels+=template.texels;
        if(details>=limits.tissue||!template.simulator)continue;
        const {session,pose}=row;
        if(session.simulation)row.tissue=session.simulation.step(pose,i/fps);
        else {
          session.simulation=template.simulator.open(pose,1/fps);
          row.tissue=session.simulation.capture();
        }
        details++;
      }
      for(const row of rows) {
        const {session,pose}=row;
        if(!row.tissue)session.simulation=null;
        if(pose.handoff)diagnostics.handoffs.push({actor:session.actor.id,...pose.handoff});
        diagnostics.maxRagdollBoneDrift=Math.max(diagnostics.maxRagdollBoneDrift,pose.boneDrift??0);
        for(const contact of pose.contacts) {
          diagnostics.contactSamples++;
          diagnostics.missedContacts+=Number(!contact.passed);
          diagnostics.maxContactError=Math.max(diagnostics.maxContactError,contact.error);
        }
        if(row.tissue){
          const {volume}=row.tissue;
          diagnostics.invertedCells+=volume.inverted;
          diagnostics.minVolumeRatio=Math.min(diagnostics.minVolumeRatio,volume.min);
          diagnostics.maxVolumeRatio=Math.max(diagnostics.maxVolumeRatio,volume.max);
        }
      }
      diagnostics.maxTissueAgents=Math.max(diagnostics.maxTissueAgents,details);
      diagnostics.maxSkinnedAgents=Math.max(diagnostics.maxSkinnedAgents,skinned);
      diagnostics.maxVisibleAgents=Math.max(diagnostics.maxVisibleAgents,visible);
      sequence.push({frame:i,time:i/fps,budget:{visible,skinned,tissue:details,triangles,texels,meshCount},
        actors:rows.map(({session,pose,tier,tissue,visibility})=>{
          const {angles,...saved}=pose;
          return {id:session.actor.id,template:session.actor.template,tier,inView:!!visibility,...saved,...(tissue&&{tissue})};
        })});
    }
    return {format:takeFormat,version:1,id:plan.id,dependencies,fps,count:frames,limits,diagnostics,frames:sequence};
  }
  function validate(take){
    if(take?.format!==takeFormat||take.version!==1||take.id!==plan.id||take.fps!==fps||take.count!==frames||
        !record(take.dependencies)||Object.entries(dependencies).some(([key,value])=>take.dependencies[key]!==value)||
        !Array.isArray(take.frames)||take.frames.length!==frames)
      throw new RangeError('Crowd take does not match the plan and asset revisions');
    return take;
  }
  function sample(take,index){
    if(!integer(index,0,frames-1))throw new RangeError('Choose a frame inside the crowd take');
    const selected=take.frames[index];
    if(selected?.frame!==index||!Array.isArray(selected.actors)||selected.actors.length!==actors.length)
      throw new TypeError('Invalid saved crowd frame');
    const meshes=[], surfaces=[];
    for(const [i,row] of selected.actors.entries()){
      const actor=actors[i], template=templates.get(actor.template), count=template.rig.joints.length;
      const valid=(rows,length)=>Array.isArray(rows)&&rows.length===length&&rows.every(Number.isFinite);
      if(row?.id!==actor.id||row.template!==actor.template||!tiers.includes(row.tier)||
          !valid(row.points,count*3)||!valid(row.matrices,count*12)||
          row.tissue!==undefined&&(!template.simulator||row.tier!=='skin'||!valid(row.tissue.offsets,template.simulator.nodes*3)))
        throw new TypeError('Invalid saved crowd actor state');
      if(row.tier==='culled')continue;
      if(row.tier==='proxy'){
        const mesh=proxy(row,template,K);
        meshes.push(mesh);
        surfaces.push({actor:row.id,id:mesh.id,type:'proxy',skinOffset:0});
        continue;
      }
      template.model.applyMatrices(row.matrices);
      for(const entry of template.meshes){
        const data=K.sceneMeshes.geometry(entry.mesh);
        const {positions,maxOffset}=entry.tissue ? entry.tissue.apply(data.positions,row.tissue?.offsets) :
          {positions:data.positions,maxOffset:0};
        const id=row.id+'/'+entry.mesh.id;
        meshes.push(K.sceneMeshes.withPose(entry.mesh,positions,{id,objectId:row.id}));
        surfaces.push({actor:row.id,id,type:'skin',skinOffset:maxOffset});
      }
    }
    return {selected,meshes,surfaces};
  }
  function preview(take,index,decorate){
    const {selected,meshes,surfaces}=sample(take,index);
    const {points,faces}=ground, landColor=view.ground??'#42626a', background=view.background??'#142531';
    const land=K.sceneMeshes.create({id:'crowd-terrain',positions:points.flat(),indices:faces.flat(),
      uvs:points.flatMap(()=>[.5,.5]),materials:[{id:'slate',color:color(landColor)}]});
    const B=kit.makeBuilder(1,[color(background),color(landColor),0xc5bf9d]);
    decorate?.(B,selected);
    const world=B.finish({id:plan.id,meshes:[land,...meshes],cam,radius,dither:0,fog:{c:0,start:1,max:0}});
    return {image:require('./render.js').render(world,{w,h,px:1,t:0,raw:true,shutter:false,renderGrid:false}),surfaces};
  }
  return {sources,bake,validate,sample,preview};
}

function proxy(row,template,K) {
  const {V}=K, positions=[],indices=[],r=template.radius;
  function append(points,faces){
    const offset=positions.length/3;
    positions.push(...points.flat());
    indices.push(...faces.flat().map(i=>i+offset));
  }
  const root=at(row.points,0);
  append([[0,r,0],[0,-r,0],[r,0,0],[0,0,r],[-r,0,0],[0,0,-r]].map(p=>V.add(p,root)),
    [[0,2,3],[0,3,4],[0,4,5],[0,5,2],[1,3,2],[1,4,3],[1,5,4],[1,2,5]]);
  for(const [i,j] of template.rig.joints.entries()){
    if(j.parent<0||j.length<=1e-8)continue;
    const a=at(row.points,j.parent),b=at(row.points,i),T=V.norm(V.sub(b,a)),N=V.perp(T),S=V.cross(T,N);
    const ring=[V.mul(N,r),V.mul(S,r),V.mul(N,-r),V.mul(S,-r)];
    append([...ring.map(p=>V.add(a,p)),...ring.map(p=>V.add(b,V.mul(p,.75)))],
      [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]]);
  }
  return K.sceneMeshes.create({id:row.id+'/proxy',objectId:row.id,positions,indices,
    uvs:Array(positions.length/3*2).fill(.5),materials:[{id:'coarse',color:color(template.color)}]});
}

const actions={bake:{count:1,flags:['out','require-contacts']},sample:{count:2,flags:['out','frame']},
  preview:{count:2,flags:['out','frame']}};
function command([action,...args],options,kit) {
  const mode=Object.hasOwn(actions,action)&&actions[action];
  if(!mode||args.length!==mode.count||action!=='sample'&&!options.out||
      Object.entries(options).some(([key,value])=>!mode.flags.includes(key)||
        (key==='require-contacts'?value!==true:typeof value!=='string'||!value.trim())))
    throw new TypeError('Use skinned-crowd bake|sample|preview. See ink-studio help.');
  const project=open(args[0],kit), out=options.out&&path.resolve(options.out);
  let bytes, report;
  if(action==='bake'){
    const take=project.bake();
    bytes=Buffer.from(JSON.stringify(take)+'\n');
    report={format:'ink-studio/skinned-crowd-bake',version:1,id:take.id,frames:take.count,takeSha256:sha(bytes),
      ...take.diagnostics};
    if(options['require-contacts']&&report.missedContacts)process.exitCode=2;
  }else{
    const file=path.resolve(args[1]), take=project.validate(read(file).document), index=Number(options.frame??0);
    project.sources.push(file);
    if(action==='sample'){
      const {selected,meshes,surfaces}=project.sample(take,index);
      report={format:'ink-studio/skinned-crowd-frame',version:1,id:take.id,...selected,
        surfaces:surfaces.map((surface,i)=>{
          const {positions,indices}=kit.KIT.sceneMeshes.geometry(meshes[i]);
          return {...surface,positions:[...positions],indices:[...indices]};
        })};
    }else{
      const {image,surfaces}=project.preview(take,index);
      bytes=PNG.encode(image.w,image.h,image.rgb,3,{srgb:true});
      report={format:'ink-studio/skinned-crowd-preview',version:1,id:take.id,frame:index,sha256:sha(bytes),surfaces};
    }
  }
  if(out){
    graphOutputs(project.sources).protect(fs.statSync(out,{throwIfNoEntry:false}));
    if(bytes)files.write(out,bytes);
    else files.json(out,report);
  }
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports={command,open};
