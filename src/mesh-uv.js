/* Inspect corner UVs in texture space and collect physical seam edges. */
const MeshUV = (() => {
  const edgeKey = (a,b) => a < b ? a+'/'+b : b+'/'+a;
  const area2 = (a,b,c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const uvEpsilon = 1e-12;
  const sameUV = (a,b) => Math.abs(a[0]-b[0]) <= 1e-7 && Math.abs(a[1]-b[1]) <= 1e-7;
  const coordinate = (p,n) => Array.isArray(p) && p.length === n && Array.from(p).every(x=>Number.isFinite(x) && Math.abs(x)<=1e6);
  const index = (i,n) => Number.isSafeInteger(i) && i >= 0 && i < n;

  function validate(points, triangles, uvs, missing = false) {
    if (!Array.isArray(points) || !Array.from(points).every(p=>coordinate(p,3)) || points.length>260000 ||
        !Array.isArray(triangles) || triangles.length>500000 ||
        !Array.from(triangles).every(tri=>Array.isArray(tri) && tri.length===3 &&
          new Set(tri).size===3 && Array.from(tri).every(i=>index(i,points.length))))
      throw new TypeError('UV inspection needs bounded indexed triangles');
    if (uvs !== undefined && (!Array.isArray(uvs) || uvs.length !== triangles.length ||
        !Array.from(uvs).every(row=>missing && row == null ||
          Array.isArray(row) && row.length===3 && Array.from(row).every(p=>coordinate(p,2)))))
      throw new TypeError('Use one UV pair per triangle corner');
  }

  function edgeSet(edges, points, label) {
    if (!Array.isArray(edges) || edges.length>1500000 ||
        !Array.from(edges).every(edge=>Array.isArray(edge) && edge.length===2 &&
          edge[0]!==edge[1] && Array.from(edge).every(i=>index(i,points.length))))
      throw new TypeError(label+' need pairs of distinct vertex indices');
    return new Set(edges.map(([a,b])=>edgeKey(a,b)));
  }

  function topology(points, triangles, uvs, protectedSeams = [], cutSeams = []) {
    const authored=edgeSet(protectedSeams,points,'Protected seams'), cuts=edgeSet(cutSeams,points,'UV cuts');
    const positions=new Map();
    const aliases=points.map((p,i)=>{
      const key=p.join('/');
      if (!positions.has(key)) positions.set(key,i);
      return positions.get(key);
    });
    const edges=new Map();
    const chart=new Int32Array(triangles.length), parent=new Int32Array(triangles.length);
    for (let i=0;i<parent.length;i++) parent[i]=i;
    function root(i) {
      while (parent[i]!==i) {
        parent[i]=parent[parent[i]];
        i=parent[i];
      }
      return i;
    }
    for (const [face,ids] of triangles.entries()) for (let i=0;i<3;i++) {
      const j=(i+1)%3, forward=aliases[ids[i]]<=aliases[ids[j]];
      const from=forward?i:j, to=forward?j:i;
      const a=ids[from], b=ids[to], key=edgeKey(aliases[a],aliases[b]);
      if (!edges.has(key)) edges.set(key,{uses:[], protected:false});
      const edge=edges.get(key);
      if (authored.delete(edgeKey(a,b))) edge.protected=true;
      if (cuts.delete(edgeKey(a,b))) edge.cut=true;
      edge.uses.push({face,vertices:[a,b],uv:uvs?.[face] ? [uvs[face][from],uvs[face][to]] : null});
    }
    if (authored.size || cuts.size) throw new RangeError('A protected seam or UV cut is not a triangle edge');
    const seams=[], locked=new Set();
    for (const edge of edges.values()) {
      const {uses}=edge, a=uses[0], b=uses[1];
      const compatible=!edge.cut && uses.length===2 && a.uv && b.uv && sameUV(a.uv[0],b.uv[0]) && sameUV(a.uv[1],b.uv[1]);
      const kind=uses.length===1?'boundary':uses.length>2?'non-manifold':compatible?'continuous':
        a.uv && b.uv ? 'seam':'unmapped';
      if (compatible) {
        const one=root(a.face), two=root(b.face);
        if (one!==two) parent[Math.max(one,two)]=Math.min(one,two);
      }
      if (kind!=='continuous' || edge.protected)
        seams.push({kind,protected:edge.protected,position:a.vertices.map(i=>points[i]),uses,...(edge.cut && {authored:true})});
      if (kind==='seam' || kind==='non-manifold' || edge.protected) for (const side of uses)
        for (const i of side.vertices) locked.add(i);
    }
    const charts=[], lookup=new Map();
    for (let i=0;i<chart.length;i++) {
      if (!uvs?.[i]) {chart[i]=-1; continue;}
      const id=root(i);
      if (!lookup.has(id)) {
        lookup.set(id,charts.length);
        charts.push([]);
      }
      chart[i]=lookup.get(id);
      charts[chart[i]].push(i);
    }
    return { chart, charts, seams, locked };
  }

  function bounds(points) {
    const [u,v]=[points.map(p=>p[0]),points.map(p=>p[1])];
    return [Math.min(...u),Math.min(...v),Math.max(...u),Math.max(...v)];
  }

  function sweep(items, expansion, spend, visit) {
    const sorted=items.slice().sort((a,b)=>a.box[0]-b.box[0] || a.id-b.id);
    for (let i=0;i<sorted.length;i++) {
      const a=sorted[i];
      for (let j=i+1;j<sorted.length;j++) {
        const b=sorted[j];
        if (b.box[0]>a.box[2]+expansion) break;
        if (!spend()) return false;
        if (b.box[1]<=a.box[3]+expansion && b.box[3]>=a.box[1]-expansion) visit(a,b);
      }
    }
    return true;
  }

  function overlaps(a,b,epsilon=uvEpsilon) {
    return [a,b].every((source,i)=> {
      const target=i?a:b, sign=Math.sign(area2(...source));
      return source.every((p,j)=>target.some(q=>sign*area2(p,source[(j+1)%3],q)>epsilon));
    });
  }

  function segmentDistance([a,b],[c,d]) {
    const a0=area2(a,b,c), a1=area2(a,b,d), b0=area2(c,d,a), b1=area2(c,d,b);
    if (a0*a1<0 && b0*b1<0) return 0;
    const pointDistance=(p,x,y)=>{
      const u=y[0]-x[0], v=y[1]-x[1], dx=p[0]-x[0], dy=p[1]-x[1], len=u*u+v*v;
      const t=len ? Math.min(1,Math.max(0,(dx*u+dy*v)/len)) : 0;
      return Math.hypot(dx-u*t,dy-v*t);
    };
    return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
  }

  function metrics([a,b,c], uv) {
    const u=b.map((n,i)=>n-a[i]), v=c.map((n,i)=>n-a[i]);
    const norm=Math.hypot(...u), twiceArea=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
    if (!uv) return {worldArea:twiceArea/2,state:'missing',uvArea:0,stretch:null,density:null};
    const determinant=area2(...uv);
    const basic={worldArea:twiceArea/2,uvArea:Math.abs(determinant)/2,mirrored:determinant<0};
    if (twiceArea<=uvEpsilon || Math.abs(determinant)<=uvEpsilon)
      return {...basic,state:twiceArea<=uvEpsilon?'degenerate-geometry':'degenerate-uv',stretch:null,density:null};
    const along=u.reduce((sum,x,i)=>sum+x*v[i],0)/norm, across=twiceArea/norm;
    const jacobian=uv[0].flatMap((x,i)=>{
      const first=(uv[1][i]-x)/norm;
      return [first,(uv[2][i]-x-first*along)/across];
    });
    const trace=jacobian.reduce((sum,x)=>sum+x*x,0), det=Math.abs(determinant/twiceArea);
    return {...basic,state:'ok',density:Math.sqrt(det),stretch:Math.max(1,(trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/(2*det))};
  }

  function inspect(source,{size=1024,padding=4,maxChecks=3000000,protectedSeams=source?.protectedSeams ?? [],cutSeams=source?.cutSeams ?? []}={}) {
    const {points,triangles,uvs}=source??{};
    validate(points,triangles,uvs,true);
    if (!uvs?.some(Boolean)) throw new TypeError('This mesh has no authored UVs in the selected set');
    const [width,height]=Array.isArray(size)?size:[size,size];
    if (Array.isArray(size) && size.length!==2 || ![width,height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=16384) ||
        !Number.isFinite(padding) || padding<0 || padding>256 ||
        !Number.isSafeInteger(maxChecks) || maxChecks<1 || maxChecks>16000000)
      throw new RangeError('UV inspection needs valid texture dimensions, padding and a bounded comparison count');
    const toTexels=uv=>uv.map(([u,v])=>[u*width,v*height]);
    const {chart,charts,seams}=topology(points,triangles,uvs,protectedSeams,cutSeams);
    const faces=triangles.map((ids,id)=>{
      const uv=uvs[id] && toTexels(uvs[id]), box=uv&&bounds(uv);
      return {id,chart:chart[id],uv,box,...metrics(ids.map(i=>points[i]),uv),
        outside:Boolean(box && (box[0]<0 || box[1]<0 || box[2]>width || box[3]>height))};
    });
    const rows=charts.map((ids,id)=>{
      let worldArea=0, uvArea=0, border=Infinity, maxStretch=null;
      for (const f of ids) {
        const face=faces[f], [l,t,r,b]=face.box;
        border=Math.min(border,l,t,width-r,height-b);
        if (face.state!=='ok') continue;
        worldArea+=face.worldArea;
        uvArea+=face.uvArea;
        maxStretch=Math.max(maxStretch??1,face.stretch);
      }
      return {id,faces:ids,density:worldArea>0?Math.sqrt(uvArea/worldArea):null,maxStretch,borderPadding:border,neighborPadding:null};
    });
    const overlapPairs=[], crowded=new Map();
    let checks=0, overlapCount=0;
    const spend=()=>checks<maxChecks && ++checks>0;
    function gap(a,b,distance) {
      if (a===b || distance>=padding) return;
      const key=edgeKey(a,b), old=crowded.get(key);
      if (old || crowded.size<4096) crowded.set(key,{charts:[Math.min(a,b),Math.max(a,b)],distance:Math.min(old?.distance??Infinity,distance)});
      for (const row of [rows[a],rows[b]]) row.neighborPadding=Math.min(row.neighborPadding??Infinity,distance);
    }
    const overlapComplete=sweep(faces.filter(f=>f.uvArea>uvEpsilon),0,spend,(a,b)=>{
      if (!overlaps(a.uv,b.uv)) return;
      overlapCount++;
      a.overlap=b.overlap=true;
      if (overlapPairs.length<4096) overlapPairs.push([a.id,b.id]);
      gap(a.chart,b.chart,0);
    });
    const borders=[];
    if (padding>0) for (const {kind,uses} of seams) if(kind!=='continuous') for (const side of uses) {
      if (!side.uv) continue;
      const uv=toTexels(side.uv);
      borders.push({id:borders.length,chart:chart[side.face],uv,box:bounds(uv)});
    }
    // Give the padding check its own comparison budget.
    const overlapChecks=checks;
    checks=0;
    const paddingComplete=sweep(borders,padding,spend,(a,b)=>{
      if (a.chart!==b.chart) gap(a.chart,b.chart,segmentDistance(a.uv,b.uv));
    });
    return {format:'ink-studio/mesh-uv-inspection',version:1,width,height,
      summary:{triangles:faces.length,charts:rows.length,uvSeams:seams.filter(e=>e.kind==='seam').length,
        protectedSeams:seams.filter(e=>e.protected).length,missing:faces.filter(f=>f.state==='missing').length,
        degenerate:faces.filter(f=>f.state.startsWith('degenerate')).length,outside:faces.filter(f=>f.outside).length,
        overlapPairs:overlapCount,paddingCharts:rows.filter(r=>r.borderPadding<padding || r.neighborPadding!==null).length},
      faces,charts:rows,seams,overlap:{pairs:overlapPairs,count:overlapCount,checks:overlapChecks,complete:overlapComplete},
      padding:{required:padding,pairs:[...crowded.values()],checks,complete:paddingComplete}};
  }

  return Object.freeze({ area2, sameUV, validate, topology, overlaps, inspect });
})();
if (typeof module !== 'undefined') module.exports = MeshUV;
