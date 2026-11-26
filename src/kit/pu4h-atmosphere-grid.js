/* A sparse active-cell workspace for XYZ transport and pressure. */
const atmosphereGrid3d = (function(K){
  const P=K.procedural,{V}=K;
  const zero=[0,0,0,0,0,0,0], channels={density:0,temperature:1,fuel:2,vapor:3,velocity:4};
  const num=(a,b)=>a-b;
  function lattice({origin,size,spacing}){
    const [nx,ny,nz]=size, slab=nx*ny, count=slab*nz,strides=[1,nx,slab];
    const valid=p=>p.every((n,i)=>n>=0&&n<size[i]);
    const address=id=>[id%nx,Math.floor(id/nx)%ny,Math.floor(id/slab)];
    const index=(x,y,z)=>x+nx*(y+ny*z);
    const world=p=>p.map((n,i)=>origin[i]+(n+.5)*spacing[i]);
    const width=spacing[0];
    return {origin,size,spacing,count,strides,valid,address,index,world,width};
  }

  function unpack(doc,l){
    const map=new Map(), {brickSize:b,fields}=doc, side=b*b, ambient=fields.temperature?.background??0;
    for(const {at,fields} of doc.bricks)for(const [name,runs] of Object.entries(fields)){
      if(channels[name]===undefined)continue;
      const k=channels[name], width=name==='velocity'?3:1;
      for(const {start,values} of runs)for(let j=0;j<values.length;j+=width){
        const slot=start+j/width, p=[slot%b,Math.floor(slot/b)%b,Math.floor(slot/side)].map((n,i)=>n+b*at[i]),
          id=l.index(...p), row=map.get(id)??zero.slice();
        for(let i=0;i<width;i++)row[k+i]=values[j+i]-(name==='temperature'?ambient:0);
        map.set(id,row);
      }
    }
    return map;
  }

  const descriptors=ambient=>({
    density:{background:0,units:'concentration'},temperature:{background:ambient,units:'K'},
    fuel:{background:0,units:'concentration'},vapor:{background:0,units:'concentration'},
    velocity:{background:[0,0,0],units:'world/s'}
  });
  function pack(l,b,ambient,map,maxCells){
    const grid={origin:l.origin,size:l.size,spacing:l.spacing};
    return P.sparseVolume.bakeSparse({grid,brickSize:b,fields:descriptors(ambient),maxCells},[...map.keys()].sort(num),(name,_,id)=>{
      const row=map.get(id), k=channels[name];
      return name==='velocity'?row.slice(4):name==='temperature'?row[k]+ambient:row[k];
    }).document;
  }

  function sums(map){
    const total=[0,0,0,0];
    for(const row of map.values())for(let k=0;k<4;k++)total[k]+=row[k];
    return total;
  }

  function pressure(material,l,settings,work){
    const region=new Map(), {closed,pressureIterations}=settings, max=l.size.map(n=>n-1), strides=l.strides;
    function vertex(id,p){
      if(region.has(id))return;
      work.active(region.size+1);
      region.set(id,{id,p,row:material.get(id)??zero,faces:[],head:0,rhs:0});
    }
    for(const id of material.keys()){
      const p=l.address(id);
      vertex(id,p);
      for(const [axis,stride] of strides.entries())for(const side of [-1,1]){
        const at=p[axis]+side;
        if(at<0||at>max[axis])continue;
        const q=p.slice();q[axis]=at;
        vertex(id+side*stride,q);
      }
    }
    const active=[...region.values()].sort((a,b)=>a.id-b.id);
    work.consume(active.length*(19+pressureIterations*6),'pressure');
    for(const row of active){
      for(const [axis,stride] of strides.entries())for(const side of [-1,1]){
        const k=axis+4, next=row.p[axis]+side, outside=next<0||next>max[axis],
          neighbor=outside?undefined:region.get(row.id+side*stride),
          open=!outside||!closed,
          v=open?(neighbor?(row.row[k]+neighbor.row[k])*.5:row.row[k]):0;
        row.faces.push({neighbor,side,open,v});
        row.rhs+=side*v;
      }
      row.count=row.faces.reduce((n,f)=>n+Number(f.open),0);
    }
    for(let pass=0;pass<pressureIterations;pass++)for(const row of active){
      if(row.count){
        let sum=0;
        for(const f of row.faces)if(f.open)sum+=f.neighbor?.head??0;
        row.head=(sum-row.rhs)/row.count;
      }
    }
    let before=0,after=0;
    for(const row of active){
      const velocity=[0,0,0];
      let residual=0;
      for(const [i,f] of row.faces.entries()){
        const v=f.open?f.v-f.side*((f.neighbor?.head??0)-row.head):0;
        residual+=v*f.side;
        velocity[i>>1]+=v*.5;
      }
      row.velocity=velocity;
      before+=Math.abs(row.rhs);
      after+=Math.abs(residual);
    }
    const scale=1/(Math.max(1,active.length)*l.width);
    return {before:before*scale,after:after*scale,cells:region.size,get:id=>region.get(id)?.velocity??[0,0,0]};
  }

  function transport(map,l,projected,dt,settings,work,losses){
    const out=new Map(), {closed,prune,maxSpeed}=settings, travel=l.width*.75/dt;
    let clipped=0,peakSpeed=0;
    work.consume(map.size*35,'transport');
    for(const [id,row] of map){
      if(!row.slice(0,4).some(Boolean))continue;
      let v=projected.get(id);
      const speed=V.len(v), limit=Math.min(maxSpeed,travel);
      if(speed>limit){clipped++;v=V.mul(v,limit/speed);}
      peakSpeed=Math.max(peakSpeed,V.len(v));
      const target=l.address(id).map((n,i)=>{
        const at=n+v[i]*dt/l.width;
        return closed?Math.max(0,Math.min(l.size[i]-1,at)):at;
      });
      const floor=target.map(Math.floor), remainder=target.map((n,i)=>n-floor[i]),
        mass=Math.max(1e-12,row[0]+row[2]+row[3]+Math.abs(row[1])*.002);
      for(let z=0;z<=1;z++)for(let y=0;y<=1;y++)for(let x=0;x<=1;x++){
        const p=[floor[0]+x,floor[1]+y,floor[2]+z],
          weight=(x?remainder[0]:1-remainder[0])*(y?remainder[1]:1-remainder[1])*(z?remainder[2]:1-remainder[2]);
        if(!weight)continue;
        if(!l.valid(p)){
          for(let k=0;k<4;k++)losses.outflow[k]+=row[k]*weight;
          continue;
        }
        const key=l.index(...p);
        if(!out.has(key)){
          work.active(out.size+1);
          out.set(key,[0,0,0,0,0,0,0,0]);
        }
        const next=out.get(key);
        for(let k=0;k<4;k++)next[k]+=row[k]*weight;
        for(let k=0;k<3;k++)next[k+4]+=v[k]*weight*mass;
        next[7]+=weight*mass;
      }
    }
    for(const [id,row] of out){
      for(let k=0;k<4;k++){
        const threshold=prune*(k===1?30:1);
        if(Math.abs(row[k])>=threshold)continue;
        losses.pruned[k]+=row[k];
        row[k]=0;
      }
      if(!row.slice(0,4).some(Boolean)){out.delete(id);continue;}
      const weight=row.pop();
      for(let k=4;k<7;k++)row[k]/=weight;
    }
    return {cells:out,clipped,peakSpeed};
  }

  return Object.freeze({lattice,unpack,pack,sums,pressure,transport,descriptors});
})(KIT);
