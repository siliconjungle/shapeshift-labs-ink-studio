// A local, oriented surface chart for signed relief capture and projection.
const SdfDetailChart = (function(K) {
  const { V,procedural:P }=K;
  const maxSamples=8192, format='ink-studio/sculpt-detail';
  const finite=(n,a,b)=>Number.isFinite(n) && n>=a && n<=b;
  const xyz=p=>Array.isArray(p) && p.length===3 && Array.from(p).every(n=>finite(n,-1e7,1e7));
  const record=(p,keys)=>p && Object.getPrototypeOf(p)===Object.prototype && Object.keys(p).every(key=>keys.includes(key));
  const objectId=id=>id===undefined || typeof id==='string' && id.trim().length>0 && id.length<=256;

  function chart(raw,cell) {
    if (!record(raw,['origin','normal','tangent','size','spacing']) || !xyz(raw.origin) || !xyz(raw.normal) || !xyz(raw.tangent) ||
        !Array.isArray(raw.size) || raw.size.length!==2 ||
        !Array.from(raw.size).every(n=>Number.isSafeInteger(n) && n>=3 && n<=128) || raw.size[0]*raw.size[1]>maxSamples ||
        !finite(raw.spacing ?? cell,cell*.5,cell*8))
      throw new RangeError('A detail chart needs XYZ origin, normal and tangent, a 3–128 grid of up to 8192 points, and a valid spacing');
    const normal=V.norm(raw.normal), along=V.mad(raw.tangent,normal,-V.dot(normal,raw.tangent));
    if (V.len(normal)<.99 || V.len(along)<=V.len(raw.tangent)*1e-6)
      throw new RangeError('A detail chart needs independent normal and tangent axes');
    const tangent=V.norm(along);
    return {origin:raw.origin.slice(),normal,tangent,size:raw.size.slice(),spacing:raw.spacing ?? cell};
  }

  function basis(c) {
    const {origin,tangent,normal,spacing,size:[w,h]}=c, bitangent=V.cross(normal,tangent);
    const center=(x,y)=>V.mad(V.mad(origin,tangent,(x-(w-1)/2)*spacing),bitangent,(y-(h-1)/2)*spacing);
    const coordinates=point=>{
      const d=V.sub(point,origin);
      return [V.dot(d,tangent)/spacing+(w-1)/2,V.dot(d,bitangent)/spacing+(h-1)/2,V.dot(d,normal)];
    };
    return {center,coordinates,axes:[tangent,bitangent,normal]};
  }

  function roots(distance,point,axis,lo,hi,step,epsilon) {
    const n=Math.max(1,Math.ceil((hi-lo)/step)), results=[];
    let previous=0, previousAt=lo;
    for (let i=0;i<=n;i++) {
      const at=lo+(hi-lo)*i/n, d=distance(...V.mad(point,axis,at));
      const sign=d>epsilon ? 1 : d < -epsilon ? -1 : 0;
      if (!sign) continue;
      if (previous && sign!==previous) {
        let a=previousAt,b=at;
        for (let j=0;j<12;j++) {
          const mid=(a+b)/2;
          if (distance(...V.mad(point,axis,mid))*previous>0) a=mid;
          else b=mid;
        }
        results.push({height:(a+b)/2,outward:sign===1});
      }
      previous=sign;
      previousAt=at;
    }
    return results;
  }

  function front(distance,point,axis,lo,hi,step,epsilon) {
    const hits=roots(distance,point,axis,lo,hi,step,epsilon);
    const crossings=hits.filter(hit=>hit.outward);
    if (crossings.length===0) return {status:'lost-correspondence'};
    if (crossings.length>1 || !hits.at(-1).outward)
      return {status:'fold',crossings:crossings.length,reason:'multiple-sheets'};
    return crossings[0];
  }

  function normalAt(distance,p,e) {
    return V.norm(p.map((_,i)=>{
      const a=p.slice(), b=p.slice();
      a[i]+=e; b[i]-=e;
      return distance(...a)-distance(...b);
    }));
  }

  function prepare(layer) {
    const {cell,chart:raw,object,rows}=layer ?? {};
    if (!record(layer,['format','version','object','cell','chart','rows']) || layer.format!==format || layer.version!==1 ||
        !finite(cell,1e-6,1e5) || !objectId(object)) throw new TypeError('Use a version 1 sculpt detail layer');
    const grid=chart(raw,cell);
    if (!Array.isArray(rows) || rows.length!==grid.size[0]*grid.size[1])
      throw new RangeError('A sculpt detail layer needs one record per chart point');
    const samples=Array.from(rows,row=>{
      if (record(row,['status']) && ['fold','lost-correspondence'].includes(row.status)) return {status:row.status};
      if (!record(row,['height','normal','offset']) || !finite(row.height,-cell*32,cell*32) ||
          !xyz(row.normal) || !finite(V.len(row.normal),.99,1.01) || !finite(row.offset,-cell*12,cell*12))
        throw new TypeError('A detail sample needs its captured height, normal and bounded signed relief');
      return {height:row.height,normal:row.normal.slice(),offset:row.offset};
    });
    return P.data.freeze({format,version:1,...(object!==undefined && {object}),cell,chart:grid,rows:samples});
  }

  return {basis,chart,finite,format,front,normalAt,objectId,prepare,record,roots};
})(KIT);
