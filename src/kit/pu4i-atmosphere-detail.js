/* Flow-anchored, conservative up-resolution of a native atmosphere frame. */
(function(K){
  const W=K.world,P=K.procedural,{check,record}=W.data,G=atmosphereGrid3d;
  const finite=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const tau=Math.PI*2,audit=[0,2,3],channels=['density','heat','fuel','vapor'];
  const minmod=(a,b)=>a*b>0?Math.sign(a)*Math.min(Math.abs(a),Math.abs(b)):0;
  const scale=(n,a,b)=>Math.max(a,Math.min(b,n));

  function options(raw={}){
    check(record(raw)&&Object.keys(raw).every(k=>['factor','strength','frequency','flow','maxCells'].includes(k)),
      'Unknown atmosphere up-resolution option');
    const value={factor:2,strength:.56,frequency:1.85,flow:.65,maxCells:210000,...raw};
    const {factor,strength,frequency,flow,maxCells}=value;
    check(integer(factor,2,4)&&finite(strength,0,1)&&finite(frequency,.1,10)&&finite(flow,0,2)&&
      integer(maxCells,1,260000),'Invalid atmosphere up-resolution factor or budget');
    return value;
  }

  function upRes(source,raw,{seed=1,time=0}={}){
    const volume=P.sparseVolume.create(source), settings=options(raw), l=G.lattice(volume.grid),
      {factor,strength,frequency,flow,maxCells}=settings, ambient=volume.fields.temperature?.background;
    check(Number.isSafeInteger(seed)&&finite(time,0,1e6)&&volume.grid.spacing.every(n=>n===l.width)&&
      Number.isFinite(ambient)&&W.data.equal(G.descriptors(ambient),volume.fields),'Up-resolution needs a native atmosphere frame');
    const base=G.unpack(volume,l), count=base.size*factor**3;
    check(count<=maxCells,'Atmosphere up-resolution exceeds its child-cell budget');
    const f=G.lattice({origin:l.origin,size:l.size.map(n=>n*factor),spacing:l.spacing.map(n=>n/factor)}),
      children=[], out=new Map(), phase=[0,1,2].map(i=>P.data.hash('detail/'+i,seed)/4294967296*tau);
    for(let z=0;z<factor;z++)for(let y=0;y<factor;y++)for(let x=0;x<factor;x++){
      const address=[x,y,z];
      children.push({address,offset:address.map(n=>(n+.5)/factor-.5)});
    }
    let details=0,nDensity=0,peak=0;
    for(const [key,row] of base){
      const p=l.address(key), slopes=l.strides.map((stride,k)=>{
        const before=p[k]>0?base.get(key-stride):null, after=p[k]<l.size[k]-1?base.get(key+stride):null;
        return row.map((v,j)=>minmod(v-(before?.[j]??0),(after?.[j]??0)-v));
      });
      const values=children.map(({offset,address})=>{
        const xyz=p.map((n,i)=>(n+offset[i]-row[i+4]*time*flow/l.width)*frequency+phase[i]),
          x=Math.sin(xyz[0]), y=Math.sin(xyz[1]), z=Math.sin(xyz[2]),
          n=(x*Math.cos(xyz[1])+y*Math.cos(xyz[2])+z*Math.cos(xyz[0]))/1.85;
        const reconstructed=row.map((v,k)=>v+offset.reduce((a,s,i)=>a+s*slopes[i][k],0)),
          density=Math.max(0,reconstructed[0]),
          amount=strength*n*(.58+.42*(1-scale(row[0],0,1)));
        const fine=reconstructed.slice();
        fine[0]*=1+amount;
        fine[1]+=row[1]*amount*.30;
        fine[2]*=1+amount*.55;
        fine[3]*=1+amount*.37;
        for(const [i,n] of [z-y,x-z,y-x].entries())fine[4+i]+=strength*n*.18*Math.min(1,row[0]+row[2]+row[3]);
        return {fine,density,id:f.index(...address.map((n,i)=>p[i]*factor+n))};
      });
      const means=values.reduce((sum,{fine})=>sum.map((n,k)=>n+fine[k]/children.length),Array(7).fill(0));
      for(const {fine,density,id} of values){
        for(let k=0;k<7;k++){
          const keep=audit.includes(k);
          fine[k]=keep?means[k]>0?Math.max(0,fine[k]*row[k]/means[k]):0:fine[k]+row[k]-means[k];
        }
        if(row[0]){
          nDensity++;
          details+=(fine[0]-density)**2;
          peak=Math.max(peak,fine[0]);
        }
        if(!fine.every(n=>n===0))out.set(id,fine);
      }
    }
    const document=G.pack(f,volume.brickSize,ambient,out,maxCells), from=G.sums(base), to=G.sums(G.unpack(document,f)),
      before=l.width**3, after=f.width**3;
    const mass=Object.fromEntries(audit.map(i=>{
      const coarse=from[i]*before, refined=to[i]*after;
      return [channels[i],{coarse,refined,absoluteError:refined-coarse,relativeError:coarse?(refined-coarse)/coarse:0}];
    }));
    const report={factor,strength,frequency,flow,seed,time,baseCells:base.size,childCells:out.size,maxCells,
      bricks:document.bricks.length,densityDetailRms:Math.sqrt(details/Math.max(1,nDensity)),densityPeak:peak,mass};
    return {document,report};
  }
  W.atmosphere=Object.freeze({options,upRes});
})(KIT);
