/* Sample authored attributes in world space and carry them across geometry domains. */
(function (K) {
  const P = K.procedural, V = K.V;
  const domains = Object.freeze(['vertex', 'face', 'edge', 'corner', 'point', 'curve', 'curve-control', 'instance', 'splat']);
  const meshDomains = ['vertex', 'face', 'corner', 'edge'];
  const format = 'ink-studio/geometry-attributes';
  const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  const sizes={number:1,label:1,vec2:2,vec3:3,vec4:4};
  const sizeOf=type=>Object.hasOwn(sizes,type) ? sizes[type] : 0;
  const validId = value => typeof value==='string' && value.trim().length>0 || Number.isSafeInteger(value)&&value>=0;
  const point = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const position = value => Array.isArray(value) ? value : value?.point || value?.at || value?.position;

  function table(domain, entities, specifications = {}, {allowMissing=false}={}) {
    if (!domains.includes(domain) || !Array.isArray(entities) || entities.length > 250000 || !Array.from(entities).every(e => point(position(e))))
      throw new TypeError('Attribute tables need a recognized domain with finite positions');
    const channels = new Map();
    for (const [name, spec] of Object.entries(specifications)) {
      const { type = 'label', values, interpolation = type==='label' ? 'dominant' : 'linear', missing=[] } = spec;
      const size = sizeOf(type);
      if (!name || ['__proto__','constructor','prototype'].includes(name) || !size ||
          !['linear','dominant','constant'].includes(interpolation) || type==='label'&&interpolation==='linear' ||
          (!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== entities.length * size ||
          !Array.isArray(missing)||new Set(missing).size!==missing.length||
          !Array.from(missing).every(i=>Number.isSafeInteger(i)&&i>=0&&i<entities.length))
        throw new RangeError('Invalid attribute channel ' + name);
      const validate = type === 'label' ? v => v === null || typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v) : Number.isFinite;
      const rows=Array.from(values);
      for(let i=0;i<rows.length;i+=size) {
        const value=rows.slice(i,i+size);
        if (!value.every(validate) && !(allowMissing && value.every(v=>v===null)))
          throw new RangeError('Invalid values for attribute channel ' + name);
      }
      channels.set(name, { type, size, interpolation, values: rows, missing:new Set(missing) });
    }
    const points = entities.map(value => position(value).slice());
    function read(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= points.length) throw new RangeError('Unknown attribute sample');
      return Object.fromEntries([...channels].flatMap(([name, item]) => {
        const value=at(item,index);
        return value===undefined ? [] : [[name,value]];
      }));
    }
    return { domain, entities: entities.slice(), points, channels, read };
  }

  function at({type,size,values,missing},index) {
    if (missing.has(index)) return;
    const value=values[index*size];
    return value===null&&type!=='label' ? undefined : size===1 ? value : values.slice(index*size,(index+1)*size);
  }

  // Labels use the same tie order as the incoming barycentric or lineage list.
  function blend(channel,indices,weights) {
    const active=indices.flatMap((i,k)=>weights[k]>1e-10 ? [{weight:weights[k],value:at(channel,i)}] : []);
    if (!active.length || active.some(row=>row.value===undefined)) return;
    if (active.length===1) return active[0].value;
    if (channel.interpolation==='constant')
      return active.every(row=>JSON.stringify(row.value)===JSON.stringify(active[0].value)) ? active[0].value : undefined;
    if (channel.interpolation==='dominant')
      return active.reduce((best,row)=>row.weight>best.weight ? row : best).value;
    const total=active.reduce((sum,row)=>sum+row.weight,0);
    const value=k=>active.reduce((sum,row)=>sum+(k===undefined ? row.value : row.value[k])*row.weight/total,0);
    return channel.size===1 ? value() : Array.from({length:channel.size},(_,k)=>value(k));
  }

  function asset(domain,entities,channels = {}) {
    const definitions=Object.fromEntries(Object.entries(channels).map(([name,spec])=>{
      if(spec.values!==undefined)return [name,spec];
      const size=sizeOf(spec.type??'label'), missing=[];
      if(!size||!Array.isArray(entities)||entities.length>250000)throw new RangeError('Invalid channel '+name);
      const values=entities.flatMap((row,i)=>{
        const fields=row?.attributes;
        if(!Object.hasOwn(fields??{},name)) {
          missing.push(i);
          return Array(size).fill(null);
        }
        const value=fields[name];
        if(size===1&&!Array.isArray(value))return [value];
        if(size>1&&Array.isArray(value)&&value.length===size)return value;
        throw new RangeError('Attribute '+name+' needs the declared shape');
      });
      return [name,{...spec,values,missing}];
    }));
    const source=table(domain,entities,definitions,{allowMissing:true}), ids=new Set();
    const rows=source.entities.map((row,i)=>{
      const id=row.id??i;
      if(!validId(id)||ids.has(id))throw new RangeError('Attribute assets need stable, distinct element IDs');
      ids.add(id);
      return {id,point:source.points[i],...(row.source&&{source:P.data.clone(row.source)})};
    });
    const specifications=Object.fromEntries([...source.channels].map(([name,{type,interpolation,values,missing}])=>
      [name,{type,interpolation,values,...(missing.size&&{missing:[...missing].sort((a,b)=>a-b)})}]));
    return P.data.freeze({format,version:1,domain,entities:rows,channels:specifications});
  }

  function open(source) {
    if(source?.format!==format||source.version!==1||!source.channels)
      throw new TypeError('Use a version 1 geometry attribute asset');
    const result=table(source.domain,source.entities,source.channels,{allowMissing:true});
    if(!result.entities.every(row=>validId(row?.id))||new Set(result.entities.map(row=>row.id)).size!==result.entities.length)
      throw new RangeError('Attribute assets need stable, distinct element IDs');
    return result;
  }

  function nearestRows(source) {
    if (!source || !Array.isArray(source.points) || typeof source.read !== 'function')
      throw new TypeError('Expected a captured attribute table');
    const { points } = source;
    function build(ids, depth = 0) {
      if (!ids.length) return null;
      const axis = depth % 3;
      ids.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
      const middle = ids.length >> 1;
      return { axis, index: ids[middle], lower: build(ids.slice(0, middle), depth + 1),
        upper: build(ids.slice(middle + 1), depth + 1) };
    }
    const root = build(points.map((_, i) => i));
    return { sample(p, accept) {
      if (!point(p)) throw new TypeError('Attribute queries need a finite XYZ point');
      let distance = Infinity, index = -1;
      function visit(node) {
        if (!node) return;
        const at = points[node.index], candidate = V.dist(at, p), split = p[node.axis] - at[node.axis];
        if ((candidate < distance || (candidate === distance && node.index < index)) && (!accept || accept(node.index))) {
          index = node.index;
          distance = candidate;
        }
        if (split <= 0) {
          visit(node.lower);
          if (-split <= distance) visit(node.upper);
        } else {
          visit(node.upper);
          if (split <= distance) visit(node.lower);
        }
      }
      visit(root);
      return index < 0 ? null : { point: points[index].slice(), distance,
        sourceId: source.entities[index]?.id ?? index, values: source.read(index) };
    } };
  }

  function meshLayout(mesh,edgeData=false) {
    const binding=K.meshTopology.sourceDocument(mesh);
    const retained=binding??(mesh?.format==='ink-studio/mesh-topology' && K.meshTopology.create(mesh));
    const render=binding || Number.isSafeInteger(mesh?.vertices)&&Number.isSafeInteger(mesh?.triangles) ?
      K.sceneMeshes.geometry(mesh) : null;
    const posed=new Map();
    if(binding) for(let i=0;i<mesh.vertices;i++)
      posed.set(K.meshTopology.sourceVertex(mesh,i),Array.from(render.positions.subarray(i*3,i*3+3)));
    const native=retained ? null : P.geometry.topology(render??mesh);
    const positions=retained ? retained.vertices.map(row=>posed.get(row.id)??row.position) : native.points;
    const vertex=positions.map((point,i)=>({id:retained ? retained.vertices[i].id : i,point}));
    const vslots=new Map(vertex.map(({id},i)=>[id,i]));
    const rings=retained ? retained.faces.map(face=>face.corners.map(row=>vslots.get(row.vertex))) : native.faces;
    const face=rings.map((indices,i)=>({id:retained ? retained.faces[i].id : i,point:[0,1,2].map(k=>
      indices.reduce((sum,j)=>sum+positions[j][k],0)/indices.length)}));
    const fslots=new Map(face.map(({id},i)=>[id,i])), corner=[], cslots=new Map(), cRows=[];
    const edge=[], eRows=[], eSlots=new Map();
    const edgeKey=(a,b)=>a<b ? a+'/'+b : b+'/'+a;
    if(edgeData&&retained) for(const row of retained.edges) {
      const [a,b]=row.vertices.map(id=>vslots.get(id));
      eSlots.set(edgeKey(a,b),edge.length);
      edge.push({id:row.id,point:V.lerp(positions[a],positions[b],.5),vertices:row.vertices.slice()});
    }
    for(const [f,ring] of rings.entries()) {
      const corners=[], boundary=[];
      for(let i=0;i<ring.length;i++) {
        const a=ring[i], b=ring[(i+1)%ring.length];
        const id=retained ? retained.faces[f].corners[i].id : 'corner/'+f+'/'+i;
        cslots.set(id,corner.length);
        corners.push(corner.length);
        corner.push({id,point:positions[a],face:face[f].id,vertex:vertex[a].id});
        if(!edgeData)continue;
        const key=edgeKey(a,b);
        if(!eSlots.has(key)) {
          eSlots.set(key,edge.length);
          edge.push({id:'edge/'+key,point:V.lerp(positions[a],positions[b],.5),vertices:[Math.min(a,b),Math.max(a,b)]});
        }
        boundary.push({index:eSlots.get(key),a:positions[a],b:positions[b]});
      }
      cRows.push(corners);
      eRows.push(boundary);
    }
    function triangleRows() {
      if(retained) return K.meshTopology.triangulate(retained).triangleSources.map(row=>{
        const corners=row.corners.map(id=>cslots.get(id));
        return {f:fslots.get(row.face),corners,vertices:corners.map(i=>vslots.get(corner[i].vertex))};
      });
      return rings.flatMap((ids,f)=>Array.from({length:ids.length-2},(_,i)=>({
        f,vertices:[ids[0],ids[i+1],ids[i+2]],corners:[cRows[f][0],cRows[f][i+1],cRows[f][i+2]]
      })));
    }
    return {positions,entities:{vertex,face,corner,edge},boundaries:eRows,triangleRows};
  }

  function meshSampler(mesh, { vertex, face, edge, corner, maxDistance = Infinity, edgeMaxDistance = Infinity } = {}) {
    if (!(maxDistance>=0) || !(edgeMaxDistance>=0)) throw new RangeError('Invalid mesh sampling distance');
    const layout=meshLayout(mesh,edge!==undefined);
    const declarations={vertex,face,edge,corner}, tables={};
    for(const domain of meshDomains) {
      const source=declarations[domain];
      if(source===undefined) continue;
      const entities=layout.entities[domain];
      if(source.format===format) {
        const captured=open(source), byId=new Map(captured.entities.map(({id},i)=>[id,i]));
        if(captured.domain!==domain) throw new RangeError('Attribute asset belongs to a different mesh domain');
        const channels=Object.fromEntries([...captured.channels].map(([name,item])=>{
          const missing=[];
          const values=entities.flatMap(({id},i)=>{
            const value=byId.has(id) ? at(item,byId.get(id)) : undefined;
            if(value!==undefined)return [].concat(value);
            missing.push(i);
            return Array(item.size).fill(null);
          });
          return [name,{type:item.type,interpolation:item.interpolation,values,missing}];
        }));
        tables[domain]=table(domain,entities,channels,{allowMissing:true});
      } else tables[domain]=table(domain,entities,source);
    }
    const triangles=[];
    for(const row of layout.triangleRows()) {
      const [a,b,c]=row.vertices.map(i=>layout.positions[i]);
      const u=V.sub(b,a), v=V.sub(c,a), cross=V.cross(u,v), norm=V.len(cross);
      if(norm<1e-10)continue;
      const min=a.map((x,k)=>Math.min(x,b[k],c[k])), max=a.map((x,k)=>Math.max(x,b[k],c[k]));
      triangles.push({...row,a,b,c,u,v,min,max,normal:V.mul(cross,1/norm)});
    }
    function tree(items) {
      if (!items.length) return null;
      const first = items[0], min = first.min.slice(), max = first.max.slice();
      for (const p of items) for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p.min[a]);
        max[a] = Math.max(max[a], p.max[a]);
      }
      if (items.length <= 8) return { min, max, items };
      const extents = min.map((v, i) => max[i] - v), axis = extents.indexOf(Math.max(...extents));
      items.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
      const mid = items.length >> 1;
      return { min, max, left: tree(items.slice(0, mid)), right: tree(items.slice(mid)) };
    }
    const root = tree(triangles);
    const boxDistance = (p, node) => node ? p.reduce((sum, n, i) =>
      sum + Math.max(node.min[i] - n, n - node.max[i], 0) ** 2, 0) : Infinity;
    function sample(p, address = {}) {
      if (!point(p)) throw new TypeError('Attribute queries need a finite XYZ point');
      if (address?.domain!==undefined&&!meshDomains.includes(address.domain))
        throw new RangeError('Choose a source mesh attribute domain');
      let best=maxDistance**2, hit;
      function visit(node, lower) {
        if (!node || lower > best) return;
        if (node.items) for (const triangle of node.items) {
          const f=layout.entities.face[triangle.f].id;
          if(address.face!==undefined&&f!==address.face || address.edge!==undefined&&
            !layout.boundaries[triangle.f].some(row=>layout.entities.edge[row.index].id===address.edge))continue;
          const result=P.geometry.closestTrianglePoint(p,triangle), d=V.dist(p,result.at)**2;
          if (d < best || (d === best && (!hit || triangle.f < hit.triangle.f))) {
            best=d;
            hit={triangle,...result};
          }
        }
        else {
          const l=boxDistance(p,node.left), r=boxDistance(p,node.right);
          if(l<=r){visit(node.left,l);visit(node.right,r);}
          else {visit(node.right,r);visit(node.left,l);}
        }
      }
      visit(root,boxDistance(p,root));
      if(!hit)return null;
      const {triangle:t,weights,at}=hit;
      const channels=(domain,indices,w)=>Object.fromEntries([...(tables[domain]?.channels??[])].flatMap(([name,data])=>{
        const value=blend(data,indices,w);
        return value===undefined ? [] : [[name,value]];
      }));
      let boundary;
      if(tables.edge) for(const row of layout.boundaries[t.f]) {
        const {index,a,b}=row, id=layout.entities.edge[index].id;
        if(address.edge!==undefined&&address.edge!==id)continue;
        const axis=V.sub(b,a), length=V.dot(axis,axis);
        if(!length)continue;
        const parameter=Math.max(0,Math.min(1,V.dot(V.sub(at,a),axis)/length));
        const distance=V.dist(at,V.mad(a,axis,parameter));
        if(distance>edgeMaxDistance)continue;
        if(!boundary||distance<boundary.distance||distance===boundary.distance&&order(id,boundary.id)<0)
          boundary={id,index,distance,parameter};
      }
      const domains={
        vertex:channels('vertex',t.vertices,weights),
        face:channels('face',[t.f],[1]),
        corner:channels('corner',t.corners,weights),
        edge:boundary ? channels('edge',[boundary.index],[1]) : {}
      };
      const sourceId=layout.entities.face[t.f].id;
      return {point:at,normal:t.normal.slice(),sourceId,distance:Math.sqrt(best),weights,
        values:address.domain ? domains[address.domain] : Object.assign({},...Object.values(domains)),
        ...((corner!==undefined||edge!==undefined)&&{source:{face:sourceId,corners:t.corners.map(i=>layout.entities.corner[i].id),
          ...(boundary&&{edge:boundary.id,edgeDistance:boundary.distance})}})
      };
    }
    return {sample,sampleAddress:sample};
  }

  function sdfSampler(field, channels, { interval = .012, steps = 6, reach = 2 } = {}) {
    const sdf = typeof field === 'function' ? field : field?.sdf?.bind(field) || field?.sd?.bind(field);
    if (typeof sdf !== 'function' || !Number.isFinite(interval) || interval <= 0 || !Number.isFinite(reach) || reach < 0 ||
        !Number.isSafeInteger(steps) || steps < 1 || steps > 32 || (channels !== undefined && typeof channels !== 'function'))
      throw new TypeError('Invalid SDF attribute sampler');
    return {
      sample(query) {
        if (!point(query)) throw new TypeError('Attribute queries need a finite XYZ point');
        let at = query.slice(), normal = [0, 0, 0];
        for (let i = 0; i < steps; i++) {
          const distance = sdf(...at);
          if (!Number.isFinite(distance) || V.dist(at, query) > reach) return null;
          const derivative = at.map((_, axis) => {
            const a = at.slice(), b = at.slice();
            a[axis] += interval;
            b[axis] -= interval;
            return (sdf(...a) - sdf(...b)) / (2 * interval);
          });
          const length = V.len(derivative);
          if (!length || !Number.isFinite(length)) return null;
          normal = V.mul(derivative, 1 / length);
          if (Math.abs(distance) < interval * .1) break;
          at = V.mad(at, normal, -distance / length);
        }
        const distance = V.dist(at, query);
        if (distance > reach || Math.abs(sdf(...at)) > interval) return null;
        return { point: at, normal, distance, values: channels?.(at, normal, field) || {} };
      }
    };
  }

  function carrierSampler(carrier, channels) {
    if (typeof carrier?.closest !== 'function' || (channels !== undefined && typeof channels !== 'function'))
      throw new TypeError('Expected a sampled carrier and optional attribute function');
    return { sample(p) {
      if (!point(p)) throw new TypeError('Attribute queries need a finite XYZ point');
      const hit = carrier.closest(p), at = position(hit) || hit?.p;
      if (!point(at)) return null;
      return { point: at, normal: hit.normal || hit.n, distance: V.dist(p, at), sourceId: hit.id || carrier.id,
        values: channels?.(hit, carrier) || {} };
    } };
  }

  function transfer(source, domain, entities, { maxDistance = Infinity, fallback = {}, sourceDomain } = {}) {
    if (typeof source?.sample !== 'function' || !domains.includes(domain) || !Array.isArray(entities) ||
        entities.length > 250000 || !(maxDistance >= 0))
      throw new TypeError('Attribute transfer needs a source sampler and a bounded target domain');
    return entities.map((entity, index) => {
      const at = position(entity);
      if (!point(at)) throw new TypeError('Target position must be finite');
      const candidate=entity.source;
      const address=source.sampleAddress&&candidate&&typeof candidate==='object'&&!Array.isArray(candidate) ? candidate : undefined;
      if (sourceDomain!==undefined&&!source.sampleAddress)
        throw new RangeError('This attribute sampler cannot resolve an explicit source domain');
      const hit=address!==undefined||sourceDomain!==undefined ?
        source.sampleAddress(at,{...address,...(sourceDomain!==undefined&&{domain:sourceDomain})}) : source.sample(at);
      const match = hit && hit.distance <= maxDistance;
      return { domain, id: entity.id ?? index, point: at.slice(), sourceId: match ? hit.sourceId ?? null : null,
        attributes: match ? { ...fallback, ...hit.values } : { ...fallback }, ...(match&&hit.source&&{source:hit.source}) };
    });
  }

  function paths(source, curves, options) {
    if (!Array.isArray(curves) || curves.length > 10000) throw new RangeError('Expected a bounded list of paths');
    let nodes = 0;
    return curves.map((curve, index) => {
      const id = curve.id ?? index, points = Array.isArray(curve) ? curve : curve.points;
      if (!Array.isArray(points) || (nodes += points.length) > 250000) throw new RangeError('Path attribute budget exceeded');
      const samples = transfer(source, 'curve', points.map((p, i) => ({ point: position(p), id: String(id) + '/' + i })), options);
      return { id, points: samples.map(sample => sample.point), samples };
    });
  }

  function entities(domain,source) {
    if(meshDomains.includes(domain)) return meshLayout(source,domain==='edge').entities[domain];
    if(domain==='curve-control') return K.curve.retained.create(source).splines.flatMap(row=>
      row.points.map(({id,position})=>({id,point:position.slice()})));
    if(domain==='splat') {
      const stable=SplatProvenance.identities(source);
      return Array.from({length:source.count},(_,i)=>{
        const id=stable.idAt(i);
        if(id===undefined) throw new RangeError('Stable splat attributes need an unambiguous ID on row '+i);
        return {id,point:Array.from(source.data.subarray(i*16,i*16+3))};
      });
    }
    throw new RangeError('No native elements for attribute domain '+domain);
  }

  function splats(world, source, {identity='slot',...options}={}) {
    if(identity!=='stable'&&identity!=='slot')throw new RangeError('Splat identity must be stable or slot');
    const rows=identity==='stable' ? entities('splat',world) : Array.from({ length: world.count }, (_, i) => ({
      id: i + 1, at: Array.from(world.data.subarray(i * 16, i * 16 + 3))
    }));
    return transfer(source, 'splat', rows, options);
  }

  P.attributes = Object.freeze({ format,domains,table,asset,open,blend,entities,nearest: nearestRows,
    mesh:meshSampler,sdf:sdfSampler,carrier:carrierSampler,transfer,paths,splats });
})(KIT);
