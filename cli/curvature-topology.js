function forest(count) {
  const nodes=Int32Array.from({length:count},(_,i)=>i);
  function root(i) {
    while(nodes[i]!==i) {
      nodes[i]=nodes[nodes[i]];
      i=nodes[i];
    }
    return i;
  }
  return {root,join:(a,b)=>{nodes[root(b)]=root(a);}};
}

// Match oriented edges, and join only the actual corner fans across those edges.
function topology(selection,edgePolicy,{V}) {
  const metadata=selection.metadata, identify=new Map(), edges=new Map(), {uvSet}=selection;
  const corners=forest(metadata.length*3), charts=forest(metadata.length);
  let boundary=0,nonManifold=0,winding=0;
  for(const [face,row] of metadata.entries()) {
    const vertices=row.points.map((point,i)=>{
      const uv=edgePolicy==='chart'?(row.charts[uvSet]?.[i]?.join(',')??'unmapped-'+face):'';
      const key=point.join(',')+'/'+uv;
      if(!identify.has(key))identify.set(key,identify.size);
      return identify.get(key);
    });
    for(let i=0;i<3;i++) {
      const j=(i+1)%3, left=vertices[i], right=vertices[j], forward=left<right;
      const key=forward?left+':'+right:right+':'+left;
      const half={face,i,j,low:face*3+(forward?i:j),high:face*3+(forward?j:i),forward};
      if(!edges.has(key))edges.set(key,[]);
      edges.get(key).push(half);
    }
  }
  const manifold=[];
  for(const rows of edges.values()) {
    if(rows.length===1){boundary++;continue;}
    if(rows.length!==2){nonManifold++;continue;}
    const [a,b]=rows;
    if(a.forward===b.forward){winding++;continue;}
    corners.join(a.low,b.low);
    corners.join(a.high,b.high);
    charts.join(a.face,b.face);
    manifold.push([a,b]);
  }
  const faceCharts=metadata.map((_,i)=>charts.root(i));
  const stats={boundaryEdges:boundary,nonManifoldEdges:nonManifold,windingEdges:winding};
  function mesh(scale) {
    const nodes=new Map(), owners=metadata.map((_,face)=>[0,1,2].map(i=>corners.root(face*3+i)));
    for(const [face,row] of metadata.entries()) {
      const area=V.len(row.cross)/6;
      for(const [i,id] of owners[face].entries()) {
        if(!nodes.has(id))nodes.set(id,{area:0,convex:0,concave:0,point:row.points[i],neighbors:scale?new Set():null});
        nodes.get(id).area+=area;
        if(scale)for(const sibling of owners[face])if(sibling!==id)nodes.get(id).neighbors.add(sibling);
      }
    }
    for(const [a,b] of manifold) {
      const left=metadata[a.face], right=metadata[b.face];
      const delta=V.sub(left.points[a.j],left.points[a.i]), length=V.len(delta);
      const axis=V.mul(delta,1/length);
      const dihedral=Math.atan2(V.dot(axis,V.cross(left.normal,right.normal)),V.dot(left.normal,right.normal));
      const density=length*Math.abs(dihedral)*.25, lane=dihedral>=0?'convex':'concave';
      for(const corner of [a.low,a.high])nodes.get(corners.root(corner))[lane]+=density;
    }
    const values=new Map();
    for(const [id,row] of nodes) {
      let weight=row.area, convex=row.convex, concave=row.concave;
      for(const next of row.neighbors??[]) {
        const neighbor=nodes.get(next), distance=V.dist(row.point,neighbor.point);
        const w=Math.exp(-.5*(distance/scale)**2);
        weight+=w*neighbor.area;
        convex+=w*neighbor.convex;
        concave+=w*neighbor.concave;
      }
      values.set(id,[convex/weight,concave/weight]);
    }
    return {
      sample(face,point) {
        const weights=metadata[face].weights(point);
        return [0,1].map(lane=>owners[face].reduce((sum,id,i)=>sum+weights[i]*values.get(id)[lane],0));
      },stats
    };
  }
  return {faceCharts,mesh,stats};
}
module.exports={topology};
