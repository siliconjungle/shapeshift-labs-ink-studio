/* Welded polygon templates and normalized per-corner charts for tile stamps. */
(function (K) {
  const A = K.authoring, {V} = K;
  const quad = [[0,1],[1,1],[1,0],[0,0]];
  const wedge = {
    positions:[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[1,0,1],[1,1,1]],
    sides:[['seat',[1,0,3,2]],['slope',[0,4,5,3]],['high',[1,2,5,4]],
      ['near',[0,1,4],[[0,1],[1,1],[1,0]]],['far',[2,3,5],[[1,1],[0,1],[1,0]]]]
  };

  function polyhedron(kind, n, vertex, face) {
    const {positions,sides} = kind === 'box' ? A.tilesetBlocks.boxTopology : wedge;
    const welded = new Map();
    const interpolate = (p,q,r,u,v)=>p.map((value,i)=>value+(q[i]-value)*u+(r[i]-value)*v);
    for (const [name,indices,chart=quad] of sides) {
      const last=indices.length-1;
      const [a,b]=indices.map(i=>positions[i]), c=positions[indices[last]];
      function facet(i,j,suffix,points) {
        const normalized=points.map(([x,y])=>[x/n,y/n]);
        const ids=points.map(([x,y])=>{
          const integers=a.map((value,i)=>n*value+(b[i]-value)*x+(c[i]-value)*y);
          const key=integers.map(numerator=>fraction(numerator,n)).join('/');
          if (!welded.has(key)) welded.set(key,vertex('lattice/'+key,integers.map(value=>value/n)));
          return welded.get(key);
        });
        const uvs=normalized.map(([u,v])=>interpolate(chart[0],chart[1],chart[last],u,v));
        face(name+'/'+fraction(i,n)+'/'+fraction(j,n)+suffix,ids,uvs);
      }
      for (let j=0;j<n;j++) for (let i=0;i<(last===3 ? n : n-j);i++) {
        const p=[i,j], q=[i+1,j], r=[i+1,j+1], s=[i,j+1];
        if (last===3) facet(i,j,'',[p,q,r,s]);
        else {
          facet(i,j,'/a',[p,q,s]);
          if (i+j+1<n) facet(i,j,'/b',[q,r,s]);
        }
      }
    }
  }

  function fraction(index, count) {
    let a=index, b=count;
    while (b) [a,b] = [b,a%b];
    return (index/a)+'-'+(count/a);
  }

  function roundSolid(kind, segments, vertex, face) {
    const {radial:n,axial:m} = segments;
    const sphere = kind === 'sphere', cone = kind === 'cone';
    const revolution = Array.from({length:n},(_,i)=>[Math.cos(i*2*Math.PI/n),Math.sin(i*2*Math.PI/n)]);
    const ring = j=>{
      const t = j/m;
      const s = sphere ? Math.sin(Math.PI*t) : cone ? 1-t : 1;
      const h = sphere ? (1-Math.cos(Math.PI*t))/2 : t;
      return revolution.map(([x,y],i)=>vertex('ring/'+fraction(j,m)+'/'+fraction(i,n),[(1+s*x)/2,(1+s*y)/2,h]));
    };
    const rings = Array.from({length:m+1},(_,j)=>
      sphere && (j===0 || j===m) || cone && j===m ? null : ring(j));
    const lower = sphere && vertex('pole/lower',[.5,.5,0]);
    const upper = (sphere || cone) && vertex('pole/upper',[.5,.5,1]);
    const cap = (name,j,reverse)=>{
      const order = Array.from({length:n},(_,i)=>reverse ? n-1-i : i);
      face(name,order.map(i=>rings[j][i]),order.map(i=>[(1+revolution[i][0])/2,(1-revolution[i][1])/2]));
    };
    if (!sphere) cap('seat',0,true);
    if (!sphere && !cone) cap('cap',m,false);

    for (let j=0;j<m;j++) for (let i=0;i<n;i++) {
      const next = (i+1)%n, a= i/n, b= (i+1)/n;
      const v0=1-j/m, v1=1-(j+1)/m;
      const name = 'wall/'+fraction(j,m)+'/'+fraction(i,n);
      if (!rings[j]) face(name,[lower,rings[j+1][next],rings[j+1][i]],[[ (a+b)/2,v0],[b,v1],[a,v1]]);
      else if (!rings[j+1]) face(name,[rings[j][i],rings[j][next],upper],[[a,v0],[b,v0],[(a+b)/2,v1]]);
      else face(name,[rings[j][i],rings[j][next],rings[j+1][next],rings[j+1][i]],[[a,v0],[b,v0],[b,v1],[a,v1]]);
    }
  }

  function build(id, kind, frame, size, segments) {
    const prefix = 'primitive/'+id, vertices = [], faces = [];
    const vertex = (key,uvw)=>{
      const id = prefix+'/vertex/'+key;
      const position = uvw.reduce((point,n,i)=>V.mad(point,frame.axes[i],n*size[i]),frame.origin);
      vertices.push({id,position});
      return id;
    };
    const face = (key,ids,chart)=>faces.push({id:prefix+'/face/'+key,ids,chart});
    if (kind === 'box' || kind === 'wedge') polyhedron(kind,segments.subdivisions,vertex,face);
    else roundSolid(kind,segments,vertex,face);
    return {vertices,faces};
  }

  A.tilesetPrimitiveGeometry = Object.freeze({build});
})(KIT);
