/* Signal Inlay moves the channels of a split panel into a cable and glass beads. */
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), PNG=require('../../cli/png.js'), R=require('../../cli/render.js');
const {KIT:K,makeBuilder}=ink.load(), P=K.procedural, A=P.attributes, T=K.meshTopology, C=K.curve.retained;
const directory=path.resolve(process.argv[2]??'inlay-review');
const file=name=>path.join(directory,name);
fs.mkdirSync(directory,{recursive:true});
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const vertices=[
  ['sw',-1.58,.00],['seam-low',0,.00],['se',1.58,.00],
  ['nw',-1.58,1.6],['seam-high',0,1.6],['ne',1.58,1.6]
].map(([id,x,y])=>({id,position:[x,y,0]}));
const face=(id,ids)=>({id,corners:ids.map(vertex=>({id:id+'/'+vertex,vertex}))});
const before=T.create({id:'signal-inlay',vertices,faces:[
  face('copper',['sw','seam-low','seam-high','nw']),face('teal',['seam-low','se','ne','seam-high'])
],edges:[{id:'signal-seam',vertices:['seam-low','seam-high']}]});
const edit=T.editWithCorrespondence(before,{vertices:[{id:'seam-lug',position:[0,.65,0]}],
  faces:[face('copper',['sw','seam-low','seam-lug','seam-high','nw']),
    face('teal',['seam-low','se','ne','seam-high','seam-lug'])]});
const after=edit.document, camera={target:[0,.80,0],dist:4.55,yaw:0,pitch:.06,ortho:true,fov:.61};
const spline=C.create({format:C.format,version:1,id:'signal-route',splines:[{
  id:'feed',points:[{id:'port',position:[-1.08,1.01,.15],outHandle:[.71,.44,0]},
    {id:'starboard',position:[1.12,1.01,.15],inHandle:[-.72,.44,0]}],
  segments:[{id:'ribbon',from:'port',to:'starboard'}]
}]});
const divided=C.plan(spline,{operations:[{op:'split',segment:'ribbon',t:.5,point:'junction',rightSegment:'stbd-span'}]});

const splatBuilder=makeBuilder(6,[0x14232c,0xe8bf92]);
const beads=[
  {id:'lamp',p:[-.67,.52,.14],radius:.20,opacity:.8},
  {id:'bead-a',p:[.62,.52,.14],radius:.132,opacity:.45},
  {id:'bead-b',p:[.79,.52,.14],radius:.129,opacity:.67}
];
for(const {p,radius,opacity} of beads) splatBuilder.disc(...p,[0,0,1],radius,.023,splatBuilder.P[1],opacity);
splatBuilder.describeSplats(0,3,{object:'glass-signals'});
const splatWorld=splatBuilder.finish({id:'glass-signals',cam:camera,radius:4,dither:0});
splatWorld.splatIds=beads.map(row=>row.id);
const redistribution=ink.planSplatRedistribution(splatWorld,{target:{object:'glass-signals'},operations:[
  {op:'split',splat:'lamp',children:[{id:'lamp-port',offset:[-.066,0,0]},{id:'lamp-starboard',offset:[.066,0,0]}]},
  {op:'merge',id:'teal-mix',from:['bead-a','bead-b']}
],review:{width:144,height:104,views:[{id:'front',yaw:0,pitch:0,ortho:true},{id:'raking',yaw:.4,pitch:.18,ortho:true}]}});
if(!redistribution.asset) throw new Error(JSON.stringify(redistribution.report.views));
const splatOutput=ink.bakeSplatFit(splatWorld,redistribution.asset);
const corners=A.entities('corner',before), edges=A.entities('edge',before);
const cornerChannels={
  warmth:{type:'number',values:corners.map(row=>(row.face==='copper'?.52:.08)+row.point[1]*.25+row.point[0]*.23)},
  pigment:{type:'label',values:corners.map(row=>row.face)},
  circuit:{type:'label',interpolation:'constant',values:corners.map(row=>row.face==='copper'?'signal':'return')}
};
const edgeChannels={
  solderWidth:{type:'number',values:edges.map(row=>row.id==='signal-seam'?.065:.035)},
  role:{type:'label',values:edges.map(row=>row.id==='signal-seam'?'divider':'frame')}
};
const sampledChannels={warmth:{type:'number'},pigment:{type:'label'},circuit:{type:'label',interpolation:'constant'}};
const node=(op,inputs)=>({op,inputs}), ref=(node,port)=>({node,...(port&&{port})});
const nodes={
  oldCorners:node('attributeTable',{domain:'corner',entities:corners,channels:cornerChannels}),
  oldEdges:node('attributeTable',{domain:'edge',entities:edges,channels:edgeChannels})
};
for(const [domain,key,source] of [['edge','Edges','oldEdges'],['corner','Corners','oldCorners']]) {
  nodes['new'+key]=node('attributeElements',{domain,geometry:after});
  nodes['map'+key]=node('attributeLineage',{domain,before,after,evidence:edit.correspondence});
  nodes['next'+key]=node('attributeRemap',{source:ref(source),domain,
    entities:ref('new'+key),lineage:ref('map'+key)});
}
nodes.surface=node('attributeMesh',{mesh:after,corner:ref('nextCorners'),edge:ref('nextEdges'),options:{edgeMaxDistance:.12}});
const sided=rows=>rows.map(row=>({...row,source:{face:row.point[0]<0?'copper':'teal'}}));
nodes.controlPaint=node('attributeTransfer',{source:ref('surface'),domain:'curve-control',
  entities:sided(A.entities('curve-control',spline)),options:{sourceDomain:'corner'}});
nodes.controlTable=node('attributeTable',{domain:'curve-control',entities:ref('controlPaint'),channels:sampledChannels});
nodes.cableLineage=node('attributeLineage',{domain:'curve-control',evidence:divided.report});
nodes.cable=node('attributeRemap',{source:ref('controlTable'),domain:'curve-control',
  entities:A.entities('curve-control',divided.document),lineage:ref('cableLineage')});
nodes.splatPaint=node('attributeTransfer',{source:ref('surface'),domain:'splat',entities:sided(A.entities('splat',splatWorld)),
  options:{sourceDomain:'corner'}});
nodes.splatTable=node('attributeTable',{domain:'splat',entities:ref('splatPaint'),channels:sampledChannels});
nodes.splatLineage=node('attributeLineage',{domain:'splat',evidence:{operations:redistribution.report.operations}});
nodes.glass=node('attributeRemap',{source:ref('splatTable'),domain:'splat',entities:A.entities('splat',splatOutput),
  lineage:ref('splatLineage')});
const outputs={};
for(const k of ['nextEdges','nextCorners','cable','glass']) {
  outputs[k]=ref(k);
  outputs[k+'Report']=ref(k,'report');
}
const graph={format:'ink-studio/graph-project',version:1,nodes,outputs};
save('attributes.json',graph);
save('topology-map.json',edit.correspondence);
save('spline-edit.json',divided.report);
save('splat-edit.json',redistribution.report);
const run=ink.createGraphProject(graph).run(), result=run.outputs;
save('attribute-evidence.json',result);
execFileSync(process.execPath,[path.join(__dirname,'../../cli/ink-studio.js'),'graph','run',file('attributes.json'),
  '--out',file('graph-output')],{stdio:'pipe'});
const table=asset=>{
  const parsed=A.open(asset);
  return new Map(parsed.entities.map((row,i)=>[row.id,parsed.read(i)]));
};
const mapped={
  corner:table(result.nextCorners),edge:table(result.nextEdges),control:table(result.cable),splat:table(result.glass)
};
const seam=after.edges.filter(row=>mapped.edge.get(row.id).role==='divider');
if(seam.length!==2||mapped.corner.get('copper/seam-lug').pigment!=='copper'||
  mapped.corner.get('teal/seam-lug').pigment!=='teal'||!result.cableReport.issues.some(row=>row.id==='junction'&&row.channel==='circuit'))
  throw new Error('Demo lost a retained attribute or expected conflict');
const tones={copper:[0xba7d57,0xfcc884],teal:[0x347779,0x97d2b6]};
const hex=num=>'#'+num.toString(16).padStart(6,'0');
function tint(name,amount) {
  const [a,b]=tones[name], f=Math.min(1,Math.max(0,amount));
  return [16,8,0].reduce((rgb,k)=>rgb|(Math.round((a>>k&255)*(1-f)+(b>>k&255)*f)<<k),0);
}
function stage(id) {
  const props=[],materials=[],slots=new Map();
  function quad(x0,y0,x1,y1,z,color) {
    if(!slots.has(color))slots.set(color,materials.push({id:'coat-'+materials.length,color})-1);
    props.push({i:slots.get(color),xyz:[x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z]});
  }
  quad(-1.85,-.12,1.85,1.75,-.11,0x3c4956);
  quad(-1.72,-.01,1.72,1.6,-.08,0x26404d);
  quad(-1.85,1.55,1.85,1.75,.15,0xc09367);
  quad(-1.85,-.12,1.85,.09,.15,0x94694e);
  quad(-1.85,-.12,-1.72,1.75,.12,0x8a6755);
  quad(1.72,-.12,1.85,1.75,.12,0x6c534b);
  for(const x of [-1.80,1.80])for(const y of [.0,1.64])
    quad(x-.035,y-.035,x+.035,y+.035,.25,0xffdca1);
  if(id!=='mesh') {
    for(const x of [-1.39,-.89,-.39,.39,.89,1.39]) {
      quad(x-.18,.20,x+.18,1.43,-.025,0x233a45);
      quad(x-.18,.20,x-.14,1.43,.005,0x506472);
    }
  }
  return {quad,finish() {
    const positions=[],uvs=[],indices=[],faceMaterials=[];
    for(const {i,xyz} of props) {
      const n=positions.length/3;positions.push(...xyz);uvs.push(0,0,1,0,0,1,1,1);
      indices.push(n,n+1,n+2,n+2,n+1,n+3);faceMaterials.push(i,i);
    }
    return K.sceneMeshes.create({id:'signal-housing',positions,uvs,indices,faceMaterials,materials});
  }};
}
function render(kind) {
  const B=makeBuilder(7,[0x16232d,0xf4bf82,0xa6d7be,0xffe6b8]), surface=stage(kind);
  function latch(x,y,cell) {
    surface.quad(x-.094,y-.081,x+.094,y+.081,.23,0x424452);
    surface.quad(x-.063,y-.052,x+.063,y+.052,.25,tint(cell.pigment,cell.warmth));
    surface.quad(x-.021,y-.018,x+.021,y+.018,.27,0xffe5a6);
  }
  if(kind==='mesh') {
    const sampler=A.mesh(after,{corner:result.nextCorners});
    for(const [side,x0,x1] of [['copper',-1.6,-.035],['teal',.035,1.6]]) {
      for(let i=0;i<9;i++) {
        const y=.1+i*.159, sampled=sampler.sample([(x0+x1)*.5,y,.04],{face:side}).values;
        surface.quad(x0,y,x1,y+.158,.013,tint(sampled.pigment,sampled.warmth));
        const bars=side==='teal'?[.29,.74,1.22]:[-1.26,-.81,-.35];
        for(const x of bars) surface.quad(x,y+.025,x+.08,y+.13,.024,tint(sampled.pigment,Math.max(0,sampled.warmth-.19)));
      }
    }
    const verts=new Map(after.vertices.map(row=>[row.id,row.position]));
    for(const row of seam) {
      const w=mapped.edge.get(row.id).solderWidth*.5;
      const ys=row.vertices.map(id=>verts.get(id)[1]).sort((a,b)=>a-b);
      surface.quad(-w,ys[0],w,ys[1],.18,0xffd59b);
    }
    latch(0,.65,mapped.corner.get('copper/seam-lug'));
  } else if(kind==='cable') {
    const points=new Map(divided.document.splines[0].points.map(row=>[row.id,row]));
    const rail=C.compile(divided.document,'feed');
    for(const row of divided.document.splines[0].segments) {
      const attribute=mapped.control.get(row.from);
      const path=Array.from({length:25},(_,i)=>rail.anchor(row.id,i/24).p);
      const other=mapped.control.get(row.to);
      K.curveSplats.draw(B,{kind:'path',id:row.id,points:path},{
        color:({u})=>hex(tint(u<.5?attribute.pigment:other.pigment,
          attribute.warmth+(other.warmth-attribute.warmth)*u)),
        width:.074+.035*attribute.warmth,edge:'hard',caps:'blunt'});
    }
    for(const [id,row] of points) latch(...row.position.slice(0,2),mapped.control.get(id));
  } else {
    for(const [i,id] of splatOutput.splatIds.entries()) {
      const [x,y]=splatOutput.data.slice(i*16,i*16+2), attr=mapped.splat.get(id);
      const radius=Math.sqrt(splatOutput.data[i*16+4])*.72;
      const pigment=tint(attr.pigment,attr.warmth);
      B.disc(x,y,.14,[0,0,1],radius,.037,[16,8,0].map(k=>pigment>>k&255),2.6);
      B.disc(x-.022,y+.023,.17,[0,0,1],.026,.019,B.P[3],1.6);
      const luminance=.20+.16*attr.warmth;
      surface.quad(x-.036,luminance,x+.036,luminance+.089,.18,tint(attr.pigment,.95));
    }
  }
  const world=B.finish({meshes:[surface.finish()],cam:camera,radius:5,dither:0,fog:{c:0,start:1,max:0}});
  return ink.render(world,{w:192,h:123,px:1,raw:true,edges:false,lockCamera:true});
}
const pictures=['mesh','cable','glass'].map(kind=>{
  const image=render(kind);
  PNG.write(file(kind+'.png'),image.w,image.h,image.rgb);
  return image;
});
const sheet=R.grid(pictures,3);
PNG.write(file('comparison.png'),sheet.w,sheet.h,sheet.rgb);
