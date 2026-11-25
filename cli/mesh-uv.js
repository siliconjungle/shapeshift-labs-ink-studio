const fs = require('node:fs');
const path = require('node:path');
const studio = require('..');
const {inspect} = require('../src/mesh-uv.js');
const files = require('./asset-files.js');
const UV = require('../src/material-uv.js');

const meshFormat='ink-studio/uv-mesh';
const dark='#172331', grid='#253747', pale='#e3edf3', muted='#9bb2c1';
const charts=['#66b5a4','#93a9d7','#c48eaa','#d6ab69','#7b9ec1','#c88574','#a3b17d','#9f96ca'];
const seamColors={protected:'#f88fc1',seam:'#67e1d4','non-manifold':'#f3c779',unmapped:'#f3c779',boundary:'#647b8b'};
const text=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const number=value=>Number(value.toFixed(3));
const line=(a,b,color,width)=>'<line x1="'+number(a[0])+'" y1="'+number(a[1])+'" x2="'+number(b[0])+'" y2="'+number(b[1])+
  '" stroke="'+color+'" stroke-width="'+width+'"/>';
const polygon=(points,color,title,stroke='none')=>'<polygon points="'+points.map(p=>p.map(number).join(',')).join(' ')+
  '" fill="'+color+'" stroke="'+stroke+'" stroke-width=".6">'+(title?'<title>'+text(title)+'</title>':'')+'</polygon>';
const label=(x,y,value,size=15,fill=pale)=>'<text x="'+x+'" y="'+y+'" fill="'+fill+'" font-size="'+size+'">'+text(value)+'</text>';
const svg=(width,height,parts)=>'<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+
  width+' '+height+'" font-family="system-ui,sans-serif"><rect width="100%" height="100%" fill="'+dark+'"/>'+parts.join('')+'</svg>\n';

function source(file,selector,preserve = false) {
  if (/\.json$/i.test(file)) {
    const mesh=JSON.parse(fs.readFileSync(file,'utf8'));
    if (mesh.format==='ink-studio/mesh-topology') {
      const api=studio.load().KIT.meshTopology, doc=api.create(mesh), uvSet=UV.resolve(doc.uvBindings,selector);
      const indices=new Map(doc.vertices.map((row,i)=>[row.id,i])), corner=new Map(), byFace=new Map();
      for (const row of doc.faces) {
        byFace.set(row.id,row.material);
        row.corners.forEach(value=>corner.set(value.id,value));
      }
      const triangles=api.triangulate(doc).triangleSources;
      const cutAt=set=>doc.edges.filter(row=>UV.seam(row,set)).map(row=>row.vertices.map(id=>indices.get(id)));
      const layoutAt=set=>triangles.map(row=>{
        const uv=row.corners.map(id=>UV.uv(corner.get(id),set));
        return uv.every(Boolean) ? uv : null;
      });
      const sets=new Set();
      if(preserve) for(const row of corner.values()) for(const set of UV.setsOf(row)) sets.add(set);
      return {points:doc.vertices.map(row=>row.position),triangles:triangles.map(row=>row.corners.map(id=>indices.get(corner.get(id).vertex))),
        uvs:layoutAt(uvSet),cutSeams:cutAt(uvSet),uvSet,uvBindings:doc.uvBindings,
        ...(sets.size && {uvSets:Object.fromEntries([...sets].map(set=>[set,layoutAt(set)])),
          uvCuts:Object.fromEntries([...sets].map(set=>[set,cutAt(set)]))}),
        groupsByFace:triangles.map(row=>({material:byFace.get(row.face)}))};
    }
    if (mesh.format && (mesh.format!==meshFormat || mesh.version!==1)) throw new TypeError('Unsupported UV mesh document');
    const uvSet=UV.resolve(mesh.uvBindings,selector);
    return {...mesh,uvs:uvSet ? mesh.uvSets?.[uvSet] : mesh.uvs,uvSet};
  }
  const uvSet=typeof selector==='number'?selector:0;
  if (uvSet && /\.obj$/i.test(file)) throw new RangeError('OBJ has a single UV set');
  const mesh=studio.readMesh(file,{attributes:true,uvSet,allUVSets:preserve||typeof selector==='string'});
  const set=UV.resolve(mesh.uvBindings,selector);
  if (mesh.uvBindingConflicts?.some(row=>preserve||row.channel===selector))
    throw new RangeError('UV assignments differ across exported parts. Import the part as its own retained mesh.');
  const layout=mesh.uvSets?.[set] ?? (set===uvSet ? mesh.uvs??mesh.uvFaces : undefined);
  const triples=data=>Array.from({length:data.length/3},(_,i)=>Array.from(data.subarray(i*3,i*3+3)));
  return {points:triples(mesh.pos),triangles:triples(mesh.tri),uvs:layout,uvSet:set,uvBindings:mesh.uvBindings, ...(preserve && mesh.uvSets && {uvSets:mesh.uvSets}),
    groupsByFace:Array.from(mesh.tmat,i=>({material:mesh.mats[i].name}))};
}

function ramp(low,high,weight) {
  const amount=Math.max(0,Math.min(1,weight));
  return 'rgb('+low.map((n,i)=>Math.round(n+(high[i]-n)*amount)).join(',')+')';
}

function views(mesh, report, name) {
  const {width,height,charts:rows,faces,seams,summary}=report;
  const valid=faces.filter(face=>face.uv);
  const stride=Math.max(1,Math.ceil(valid.length/18000)), edgeStep=Math.max(1,Math.ceil(seams.length/12000));
  const sample=valid.filter((_f,i)=>i%stride===0).slice(0,18000);
  const seamSample=seams.filter(e=>e.protected).slice(0,6000).concat(
    seams.filter((e,i)=>!e.protected && i%edgeStep===0).slice(0,12000));
  let maxDensity=1;
  for (const f of valid) maxDensity=Math.max(maxDensity,f.density??0);
  const issues=new Set(rows.filter(row=>row.borderPadding<report.padding.required || row.neighborPadding!==null).map(row=>row.id));
  const colorChart=f=>charts[f.chart%charts.length];
  const steel=[64,94,118], mint=[107,216,194], warm=[246,117,105];
  const panels=[
    ['Charts',summary.charts+' UV islands',colorChart],
    ['Stretch','1× isotropic to 8× or more',f=>ramp(mint,warm,Math.log2(f.stretch)/3)],
    ['Texel density','0 to '+number(maxDensity)+' texels per unit',f=>ramp(steel,mint,f.density/maxDensity)],
    ['Overlaps',summary.overlapPairs+' triangle pairs intersect',f=>f.overlap?'#ef746d':'#415d71'],
    ['Padding',report.padding.required+' texels required  ·  coral marks short gutters',f=>issues.has(f.chart)?'#e78071':'#548d88'],
    ['UV edges','Cyan UV cut  ·  Pink protected  ·  Gray open',()=>grid]
  ];
  const parts=[label(26,42,name,28),label(27,68,width+' × '+height+' texture  ·  '+summary.triangles+' triangles',14,muted)];
  if (stride>1 || edgeStep>1) parts.push(label(760,68,'Sampled preview  ·  full details in report.json',14,muted));
  const dims=Math.min(320/width,254/height), aw=width*dims, ah=height*dims;
  for (const [i,[title,description,tint]] of panels.entries()) {
    const x=26+i%3*379, y=106+345*Math.floor(i/3);
    const left=x+(340-aw)/2, top=y+47+(254-ah)/2;
    const toPoint=([u,v])=>[left+u*dims,top+v*dims];
    parts.push(label(x,y,title,20),label(x,y+21,description,13,muted),
      '<rect x="'+number(left)+'" y="'+number(top)+'" width="'+number(aw)+'" height="'+number(ah)+
      '" fill="#101823" stroke="'+grid+'" stroke-width="1"/>',
      '<svg x="'+number(left)+'" y="'+number(top)+'" width="'+number(aw)+'" height="'+number(ah)+'" viewBox="'+
      number(left)+' '+number(top)+' '+number(aw)+' '+number(ah)+'" overflow="hidden">');
    for (const f of sample) if(f.state==='ok') parts.push(polygon(f.uv.map(toPoint),tint(f),
      'Face '+f.id+' · chart '+f.chart+' · stretch '+number(f.stretch)+'× · density '+number(f.density)));
    if (i===5) for (const row of seamSample) for (const {uv} of row.uses) if(uv)
      parts.push(line(...uv.map(([u,v])=>toPoint([u*width,v*height])),seamColors[row.protected?'protected':row.kind],row.protected?2.1:1.05));
    parts.push('</svg>');
  }
  const atlas=svg(1150,792,parts);

  const project=([x,y,z])=>[x*.86-z*.50,-y*.90+(x*.50+z*.86)*.42];
  const depth=([x,y,z])=>x*.45+y*.43+z*.78;
  const projected=mesh.points.map(project);
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  for (const [x,y] of projected) {
    box[0]=Math.min(box[0],x); box[1]=Math.min(box[1],y);
    box[2]=Math.max(box[2],x); box[3]=Math.max(box[3],y);
  }
  const scale=Math.min(660/Math.max(1e-9,box[2]-box[0]),480/Math.max(1e-9,box[3]-box[1]));
  const at=([x,y])=>[360+(x-(box[0]+box[2])/2)*scale,330+(y-(box[1]+box[3])/2)*scale];
  const wire=[label(26,42,'Seams on the mesh',27),label(28,67,'Isometric view  ·  seam edges on all sides',14,muted)];
  const triangles=sample.map(({id})=> {
    const indices=mesh.triangles[id];
    return {indices,depth:indices.reduce((sum,i)=>sum+depth(mesh.points[i]),0)};
  }).sort((a,b)=>a.depth-b.depth);
  for (const {indices} of triangles) wire.push(polygon(indices.map(i=>at(projected[i])),'#314858',null,'#416175'));
  for (const protectedOnly of [false,true]) for (const row of seamSample)
    if (row.protected===protectedOnly) wire.push(line(...row.position.map(p=>at(project(p))),seamColors[row.protected?'protected':row.kind],row.protected?3:1.5));
  wire.push(label(28,605,'UV cut',14,seamColors.seam),label(124,605,'Protected edge',14,seamColors.protected),
    label(260,605,'Open boundary',14,seamColors.boundary),label(397,605,'Non-manifold or unmapped',14,seamColors.unmapped));
  return {atlas,seams:svg(720,628,wire)};
}

function command(pos,opt,{num,list}) {
  const [mode,input,...rest]=pos;
  if (!['inspect','simplify','import'].includes(mode) || !input || rest.length || typeof opt.out!=='string')
    throw new Error('Use ink-studio mesh-uv inspect|simplify|import <mesh.obj|.gltf|.glb|.json> --out <directory|mesh.json>');
  const file=path.resolve(input), output=path.resolve(opt.out), uvSet=num('uv-set',0);
  if(!Number.isSafeInteger(uvSet)||uvSet<0||uvSet>31) throw new RangeError('UV set must be an integer from 0 to 31');
  if (opt['protected-seams']!==undefined && typeof opt['protected-seams']!=='string')
    throw new TypeError('--protected-seams needs a JSON file containing edge pairs');
  const sourceSeams=opt['protected-seams'] && path.resolve(opt['protected-seams']);
  if (opt.channel!==undefined && (!UV.channel(opt.channel)||opt['uv-set']!==undefined))
    throw new RangeError('Choose --channel or --uv-set');
  const explicitLayout=opt['uv-set']!==undefined || opt.channel!==undefined;
  const mesh=source(file,opt.channel ?? uvSet,mode!=='inspect'&&!explicitLayout);
  if (mode==='import' && explicitLayout) {
    delete mesh.uvBindings;
    delete mesh.uvSets;
    delete mesh.uvCuts;
  }
  if (mode==='simplify' && !explicitLayout &&
      (Object.keys(mesh.uvSets ?? {}).some(set=>Number(set)!==0) || Object.values(mesh.uvBindings ?? {}).some(Boolean)))
    throw new RangeError('UV simplification outputs one layout. Choose --channel or --uv-set to reduce it explicitly');
  if (sourceSeams) mesh.protectedSeams=JSON.parse(fs.readFileSync(sourceSeams,'utf8'));
  const guard=target=>{
    if ([file,sourceSeams].includes(target)) throw new Error('Choose an output different from the input mesh and seam file');
  };
  if (mode==='import') {
    if (!/\.json$/i.test(output) || opt['join-coincident']!==undefined && !['on','off'].includes(opt['join-coincident']) ||
        opt.id!==undefined && typeof opt.id!=='string')
      throw new TypeError('Choose a topology JSON output and optional --id and --join-coincident on|off');
    guard(output);
    const topology=studio.load().KIT.meshTopology.uv.fromTriangles(mesh,{
      id:opt.id ?? path.basename(file,path.extname(file)),joinCoincident:opt['join-coincident']==='on'
    });
    files.json(output,topology);
    console.log(JSON.stringify({file:output,mesh:topology.id,faces:topology.faces.length},null,2));
    return;
  }
  if (mode==='inspect') {
    const dimensions=list('atlas');
    const report=inspect(mesh,{size:dimensions?.length===1?dimensions[0]:dimensions??1024,
      padding:num('padding',4),maxChecks:num('max-checks',3000000)});
    const name=path.basename(file);
    const paths=['report.json','atlas.svg','seams.svg'].map(name=>path.join(output,name));
    paths.forEach(guard);
    const images=views(mesh,report,name);
    files.json(paths[0],{source:name,uvSet:mesh.uvSet, ...(mesh.uvBindings && {uvBindings:mesh.uvBindings}),...report});
    files.write(paths[1],images.atlas);
    files.write(paths[2],images.seams);
    console.log(JSON.stringify({...report.summary,overlapComplete:report.overlap.complete,paddingComplete:report.padding.complete,directory:output},null,2));
    return;
  }
  if (!/\.json$/i.test(output)) throw new Error('Choose a .json output for the reduced UV mesh');
  guard(output);
  if (mesh.cutSeams?.length) mesh.protectedSeams=[...(mesh.protectedSeams??[]),...mesh.cutSeams];
  if (!mesh.uvs?.length || mesh.uvs.some(uv=>!uv)) throw new TypeError('Simplification needs authored UVs on every triangle');
  const result=studio.load().KIT.procedural.geometry.simplifyQEM(mesh,{
    target:num('triangles',undefined),ratio:num('ratio',.5),preserveBoundary:opt.boundaries!=='off'
  });
  const {status,points,triangles,uvs,groupsByFace,sourceFaces,pointMap,protectedSeams,work}=result;
  files.json(output,{format:meshFormat,version:1,points,triangles,uvs,groupsByFace,protectedSeams,
    source:path.basename(file),sourceFaces,pointMap,status,work});
  console.log(JSON.stringify({status,sourceTriangles:mesh.triangles.length,triangles:triangles.length,work,file:output},null,2));
}

module.exports = { command, views };
