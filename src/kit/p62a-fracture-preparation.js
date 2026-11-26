/* Authored seams and closed, mass-bearing pieces for progressive failure. */
(function (K) {
  const P = K.procedural, {V,M} = K;
  const format = 'ink-studio/fracture-plan', preparedFormat = 'ink-studio/fracture-preparation';
  const finite = (n,lo,hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const vec = (v,n=3) => Array.isArray(v) && v.length === n && Array.from(v).every(x=>finite(x,-100,100));
  const ordered = rows => Object.entries(rows).sort(([a],[b])=>a<b?-1:a>b?1:0);
  const pair = (a,b) => a<b?a+'/'+b:b+'/'+a;

  function profiles(table,{check,record,id},keys) {
    check(record(table) && Object.keys(table).length>=1 && Object.keys(table).length<=16,
      'Fracture needs one to sixteen material profiles');
    return Object.fromEntries(ordered(table).map(([name,row])=>{
      check(id(name) && keys(row,['law','density','tensile','shear','flexural','yield','damageRate','elastic',
        'plasticRate','maxBend','maxStretch','look']), 'Invalid fracture material '+name);
      const {law, density=1, tensile=1, shear=tensile, flexural=tensile, yield:threshold=.45,
        damageRate=4, elastic=law==='brittle'?0:.18, plasticRate=law==='brittle'?0:.7,
        maxBend=.65, maxStretch=.35, look=[1,2,3,4,5,6]}=row;
      check(['brittle','ductile','fibrous'].includes(law) && finite(density,.001,1e5) &&
        [tensile,shear,flexural].every(n=>finite(n,.001,1e4)) && finite(threshold,0,.99) &&
        finite(damageRate,.001,100) && finite(elastic,0,2) && finite(plasticRate,0,10) &&
        finite(maxBend,0,1.2) && finite(maxStretch,0,.8) && Array.isArray(look) && look.length>=1 &&
        look.length<=16 && Array.from(look).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=255),
        'Invalid fracture law settings for '+name);
      return [name,{law,density,tensile,shear,flexural,yield:threshold,damageRate,elastic,plasticRate,maxBend,maxStretch,look:look.slice()}];
    }));
  }

  function indexed(shell) {
    const vertices=[];
    const faces=shell.map(({points})=>{
      // Keep shared vertices welded, including intersections reached through different faces.
      const indices=points.map(p=>{
        const at=vertices.findIndex(q=>V.dist(p,q)<=1e-8);
        return at<0?vertices.push(p)-1:at;
      });
      // Start the face at a non-collinear corner while retaining the shared edge subdivisions.
      const first=indices.findIndex((a,i)=>{
        const b=indices[(i+1)%indices.length], c=indices[(i+2)%indices.length];
        return V.len(V.cross(V.sub(vertices[b],vertices[a]),V.sub(vertices[c],vertices[a])))>1e-10;
      });
      return indices.slice(first).concat(indices.slice(0,first));
    });
    return {vertices,faces};
  }

  function massSource({vertices,faces},density) {
    const points=vertices.slice(), triangles=[];
    for(const face of faces){
      // Triangulating through the face center retains all welded boundary edges.
      const center=face.reduce((sum,i)=>V.mad(sum,vertices[i],1/face.length),[0,0,0]);
      const at=points.push(center)-1;
      face.forEach((index,i)=>triangles.push([at,index,face[(i+1)%face.length]]));
    }
    return {source:{kind:'mesh',mesh:{points,faces:triangles}},density};
  }

  function faceMeasure(points) {
    const a=points[0];
    let area=0, weighted=[0,0,0];
    for(let i=1;i+1<points.length;i++){
      const b=points[i], c=points[i+1], weight=V.len(V.cross(V.sub(b,a),V.sub(c,a)))*.5;
      area+=weight;
      weighted=V.mad(weighted,V.add(V.add(a,b),c),weight/3);
    }
    return {area,point:V.mul(weighted,1/area)};
  }

  function prepare(raw) {
    const W=K.world, {check,record,id,own}=W.data, {freeze}=P.data;
    const keys=(row,allowed)=>record(row)&&Object.keys(row).every(k=>allowed.includes(k));
    check(keys(raw,['format','version','id','host','materials','sites','guides','groups','stretch','rotation','seams']) &&
      raw.format===format && raw.version===1 && id(raw.id),'Expected a version 1 fracture plan');
    const {host, sites=[], guides=[], groups={}, seams={}, stretch=[1,1,1], rotation=[0,0,0]}=raw;
    check((host?.kind==='box'||host?.kind==='convex') && vec(stretch) && stretch.every(n=>finite(n,.05,20)) &&
      vec(rotation) && Array.isArray(sites) && Array.isArray(guides) && sites.length+guides.length*2>=2 &&
      sites.length+guides.length*2<=12 && record(groups) && Object.keys(groups).length<=24 && record(seams) &&
      Object.keys(seams).length<=66,'Fracture needs one convex host and two to twelve sites');
    const materials=profiles(raw.materials,W.data,keys);
    const [poly]=W.colliders.local(host).parts;
    const bounds=P.spatial.boxOf(poly.vertices);
    check(poly.vertices.every(p=>vec(p)) && bounds.min.every((n,i)=>bounds.max[i]-n>=.02),
      'Fracture host must fit its bounded local domain');
    const outer=poly.faces.map((face,i)=>({points:face.map(j=>poly.vertices[j]),normal:poly.directions[i]}));
    const sd=(x,y,z)=>Math.max(...outer.map(({points,normal})=>V.dot(normal,V.sub([x,y,z],points[0]))));
    const hierarchy=Object.fromEntries(ordered(groups).map(([name,row])=>{
      check(id(name) && keys(row,['parent']) && (row.parent===undefined||id(row.parent)&&own(groups,row.parent)),
        'Invalid fracture group '+name);
      return [name,{parent:row.parent??null,groups:[],pieces:[],mass:0}];
    }));
    function ancestry(group) {
      const chain=[];
      for(let next=group;next!==null;next=hierarchy[next].parent){
        check(!chain.includes(next),'Fracture groups contain a cycle');
        chain.push(next);
      }
      return chain;
    }
    const roots=[];
    for(const [name,row] of Object.entries(hierarchy)){
      ancestry(name);
      if(row.parent===null)roots.push(name);
      else hierarchy[row.parent].groups.push(name);
    }
    const sitesById=new Map(), features=new Map(), guideIds=new Set();
    function addSite(row){
      check(keys(row,['id','point','weight','material','group','anchored']) && id(row.id) && !sitesById.has(row.id) &&
        vec(row.point) && sd(...row.point)<-1e-8 && finite(row.weight??0,-1000,1000) && id(row.material) && own(materials,row.material) &&
        (row.group===undefined||id(row.group)&&own(hierarchy,row.group)) && typeof (row.anchored??false)==='boolean',
        'Invalid, duplicate or exterior fracture site '+row?.id);
      sitesById.set(row.id,{...row,point:row.point.slice(),weight:row.weight??0});
    }
    for(const row of sites)addSite(row);
    const turn=P.transforms.local({rotation}).R;
    // Inverse metric maps the authored plane normal to the site displacement.
    const invMetric=M.mul(turn,M.mul([stretch[0]**2,0,0,0,stretch[1]**2,0,0,0,stretch[2]**2],M.tr(turn)));
    for(const guide of guides){
      check(keys(guide,['id','at','normal','span','sides','material','strength','bendAxis']) && id(guide.id) &&
        !guideIds.has(guide.id) && vec(guide.at) && vec(guide.normal) && V.len(guide.normal)>1e-8 &&
        finite(guide.span,.005,100) && Array.isArray(guide.sides) && guide.sides.length===2 &&
        guide.sides.every(side=>keys(side,['id','material','group','anchored'])), 'Invalid fracture feature guide');
      guideIds.add(guide.id);
      const normal=V.norm(guide.normal), step=V.norm(M.app(invMetric,normal));
      guide.sides.forEach((side,i)=>addSite({...side,point:V.mad(guide.at,step,(i?1:-1)*guide.span)}));
      const {id:name,material,strength,bendAxis}=guide;
      features.set(pair(...guide.sides.map(s=>s.id)),{id:name,at:guide.at.slice(),normal,material,strength,bendAxis});
    }
    const authored=[...sitesById.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const span=Math.max(...bounds.max.map((n,i)=>n-bounds.min[i]));
    const partition=P.fracture.power({host:{sd,bounds},seeds:authored,stretch,rotation,cell:span/16});
    check(partition.cells.length===authored.length,'A weighted fracture site has no power cell');
    const cells={}, bonds=[];
    const exactCells=partition.cells.map(cell=>{
      const shell=P.geometry.clipConvexFaces(outer,cell.planes), geometry=indexed(shell), site=sitesById.get(cell.id);
      check(geometry.vertices.length>=4,'A weighted fracture site has no host volume: '+cell.id);
      return {cell,shell,geometry,site,measurement:massSource(geometry,materials[site.material].density)};
    });
    const measure=parts=>W.massProperties.measure({format:W.massProperties.format,version:1,id:raw.id,revision:1,parts});
    const mass=measure(Object.fromEntries(exactCells.map(({cell,measurement})=>[cell.id,measurement])));
    const hostMass=measure({host:massSource(poly,1)});
    check(mass.volume!==null && Math.abs(mass.volume-hostMass.volume)<=hostMass.volume*1e-7,
      'Fracture cells must conserve the closed host volume');
    const rootPieces=[];
    for(const {cell,shell,geometry,site} of exactCells){
      const {mass:weight,volume,centerOfMass:center,inertia}=mass.parts[cell.id];
      check(weight>=1e-8 && volume>=hostMass.volume*1e-9,'Fracture cell is too small: '+cell.id);
      const hull={kind:'convex',vertices:geometry.vertices.map(p=>V.sub(p,center)),faces:geometry.faces};
      W.colliders.local(hull);
      const group=site.group??null;
      cells[cell.id]={id:cell.id,site:site.point,weight:site.weight,group,anchored:site.anchored??false,
        material:site.material,mass:weight,volume,center,inertia,hull};
      if(group===null)rootPieces.push(cell.id);
      else hierarchy[group].pieces.push(cell.id);
      for(const parent of ancestry(group))hierarchy[parent].mass+=weight;
      for(const face of shell){
        if(face.tag===undefined||face.tag<=cell.index)continue;
        const b=authored[face.tag].id, key=pair(cell.id,b), guide=features.get(key), override=seams[key]??{};
        check(keys(override,['material','strength','bendAxis']), 'Invalid fracture seam override '+key);
        const {area,point}=faceMeasure(face.points);
        if(area<=1e-8)continue;
        const a=cell.id, normal=cell.planes.find(p=>p.tag===face.tag).normal;
        const first=site.material, second=sitesById.get(b).material;
        const material=override.material??guide?.material??(materials[first].tensile<=materials[second].tensile?first:second);
        const strength=override.strength??guide?.strength??1;
        const bendAxis=override.bendAxis??guide?.bendAxis??V.perp(normal);
        check(id(material) && own(materials,material) && finite(strength,.01,100) && vec(bendAxis) && V.len(bendAxis)>1e-8 &&
          Math.abs(V.dot(normal,V.norm(bendAxis)))<.999,'Invalid fracture constraint response at '+key);
        check(!guide||cell.planes.every(plane=>V.dot(plane.normal,guide.at)-plane.offset<=1e-7),
          'A neighboring cell obscures fracture guide '+guide?.id);
        const axis=V.norm(V.mad(bendAxis,normal,-V.dot(bendAxis,normal)));
        bonds.push({id:key,a,b,material,strength,area,point,normal,axis,law:materials[material].law,
          ...(guide&&{guide:{id:guide.id,at:guide.at,normal:guide.normal}})});
      }
    }
    bonds.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const linked=new Set(bonds.map(row=>row.id));
    check(bonds.length>0 && [...features.keys(),...Object.keys(seams)].every(key=>linked.has(key)),
      'Each fracture feature and seam must reach a shared face');
    return freeze({format:preparedFormat,version:1,id:raw.id,bounds,materials,cells,bonds,volume:mass.volume,mass:mass.mass,
      hierarchy:{roots,rootPieces,groups:hierarchy}});
  }

  P.fracture.prepare=prepare;
})(KIT);
