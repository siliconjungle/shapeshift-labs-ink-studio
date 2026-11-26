/* Finite spectral waves and native surfaces from the marker density. */
const liquidAssets3d = (function(K){
  const P=K.procedural,{V}=K,{check,record,vector}=K.world.data;
  const tau=Math.PI*2, zero=[0,0,0];
  const finite=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const keys=(o,allowed)=>record(o)&&Object.keys(o).every(k=>allowed.includes(k));
  const smooth=n=>{const u=Math.max(0,Math.min(1,n));return u*u*(3-2*u);};

  function spectrum(raw,domain,seed){
    if(raw===undefined)return null;
    check(keys(raw,['bounds','level','depth','gravity','bands','focus','near','far','sponge','edge','samples']),
      'Invalid ocean settings');
    const {bounds,level,depth=10,gravity=9.81,bands,near=1,far=2,edge=.6,sponge=.35,samples=[49,37]}=raw;
    check(keys(bounds,['min','max'])&&vector(bounds.min,2)&&vector(bounds.max,2)&&
      bounds.min.every((n,i)=>finite(n,-1000,1000)&&finite(bounds.max[i],-1000,1000)&&
        bounds.max[i]-n>=.1&&n<=domain.min[i*2]&&bounds.max[i]>=domain.max[i*2])&&
      finite(level,domain.min[1]+domain.cell,domain.max[1]-domain.cell)&&finite(depth,.03,1000)&&finite(gravity,.1,40)&&
      finite(near,0,100)&&finite(far,near+.01,200)&&finite(edge,domain.cell*.5,100)&&
      finite(sponge,0,1)&&vector(samples,2)&&samples.every(n=>integer(n,3,160))&&samples[0]*samples[1]<=16384&&
      Array.isArray(bands)&&bands.length>=1&&bands.length<=8,'Invalid ocean chart, near blend or bands');
    const focus=raw.focus??bounds.min.map((n,i)=>(n+bounds.max[i])*.5);
    check(vector(focus,2)&&focus.every((n,i)=>finite(n,bounds.min[i],bounds.max[i])),'Ocean focus must be inside the chart');
    const span=bounds.max.map((n,i)=>n-bounds.min[i]), modes=[];
    for(const [b,row] of bands.entries()){
      check(keys(row,['wavelength','amplitude','direction','spread','modes'])&&vector(row.wavelength,2)&&
        finite(row.wavelength[0],.05,500)&&finite(row.wavelength[1],row.wavelength[0],1000)&&finite(row.amplitude,0,2)&&
        finite(row.direction??0,-tau,tau)&&finite(row.spread??.2,0,Math.PI)&&integer(row.modes??1,1,8),
        'A spectral band needs bounded wavelengths, amplitude and direction');
      const count=row.modes??1, [short,long]=row.wavelength;
      for(let i=0;i<count;i++){
        const random=channel=>P.data.hash('ocean/'+b+'/'+i+'/'+channel,seed)/4294967296;
        const wave=K.mix(short,long,(i+random('wave'))/count), k=tau/wave,
          angle=(row.direction??0)+(2*random('angle')-1)*(row.spread??.2), direction=[Math.cos(angle),Math.sin(angle)],
          omega=Math.sqrt(gravity*k*Math.tanh(k*depth)), phase=random('phase')*tau, amplitude=row.amplitude/Math.sqrt(count),
          cycles=direction.map((n,j)=>n*span[j]/wave);
        modes.push({id:'band-'+b+'-'+i,k,omega,direction,phase,amplitude,cycles,wavelength:wave,frequency:-omega/tau});
      }
    }
    check(modes.length<=24&&modes.every(row=>row.cycles.every(n=>Math.abs(n)<=128))&&
      modes.reduce((n,row)=>n+row.amplitude,0)<=(domain.max[1]-domain.min[1])*.45,
      'Spectral modes exceed the chart or vertical wave budget');
    const analytic=P.fields.spectral.fourier({bounds,terms:modes.map(({id,cycles,amplitude,phase,frequency})=>
      ({id,cycles,amplitude,phase,frequency}))});
    const frame=time=>analytic.frame(time);
    const height=(at,x,z)=>level+(at.sample('signed',x,z)??0);
    function orbital(time,p){
      const v=[0,0,0], x=p[0]-bounds.min[0],z=p[2]-bounds.min[1], y=Math.min(0,p[1]-level);
      for(const {k,omega,direction,phase,amplitude,frequency} of modes){
        const angle=k*(direction[0]*x+direction[1]*z)+phase+tau*((time*frequency)%1),
          a=omega*amplitude*Math.exp(k*y), horizontal=a*Math.cos(angle);
        v[0]+=direction[0]*horizontal;v[1]+=a*Math.sin(angle);v[2]+=direction[1]*horizontal;
      }
      return v;
    }
    return {bounds,level,focus,near,far,edge,sponge,samples,modes,frame,height,orbital};
  }

  function boxSigned(p,half){
    const q=p.map((v,i)=>Math.abs(v)-half[i]);
    return Math.hypot(...q.map(n=>Math.max(0,n)))+Math.min(0,Math.max(...q));
  }

  function collider(name,row,cell,id){
    check(id(name)&&keys(row,['kind','position','turn','radius','half','friction'])&&vector(row.position)&&
      row.position.every(n=>finite(n,-1000,1000))&&finite(row.turn??0,-tau,tau)&&finite(row.friction??.04,0,1),
      'Invalid liquid collider '+name);
    const {kind,position,turn=0,friction=.04,radius,half}=row;
    check(kind==='sphere'?half===undefined&&finite(radius,cell*.16,100):
      kind==='box'&&radius===undefined&&vector(half)&&half.every(n=>finite(n,cell*.13,100)),
      'Liquid collider needs a sphere or box with positive extent');
    const extent=kind==='sphere'?[radius,radius,radius]:half, reach=kind==='sphere'?radius:Math.hypot(half[0],half[2]);
    const pose=(position,yaw,velocity=zero,spin=0)=>({position,turn:yaw,c:Math.cos(yaw),s:Math.sin(yaw),velocity,spin});
    const local=(p,t)=>{
      const x=p[0]-t.position[0], z=p[2]-t.position[2];
      return [t.c*x-t.s*z,p[1]-t.position[1],t.s*x+t.c*z];
    };
    const rotate=(p,t)=>[t.c*p[0]+t.s*p[2],p[1],t.c*p[2]-t.s*p[0]];
    const world=(p,t)=>V.add(t.position,rotate(p,t));
    const signed=kind==='sphere'?p=>V.len(p)-radius:p=>boxSigned(p,half);
    const distance=kind==='sphere'?(p,t)=>V.dist(p,t.position)-radius:(p,t)=>signed(local(p,t));
    function normal(p){
      if(kind==='sphere')return V.len(p)>1e-9?V.norm(p):[0,1,0];
      const q=p.map((x,i)=>Math.abs(x)-half[i]), delta=q.map((x,i)=>Math.max(0,x)*(p[i]<0?-1:1));
      if(V.len(delta)>1e-9)return V.norm(delta);
      const i=q.indexOf(Math.max(...q)), axis=[0,0,0];axis[i]=p[i]<0?-1:1;
      return axis;
    }
    function dimensions(t){
      if(kind==='sphere')return extent;
      return [Math.abs(t.c)*half[0]+Math.abs(t.s)*half[2],half[1],Math.abs(t.s)*half[0]+Math.abs(t.c)*half[2]];
    }
    const velocity=(p,t)=>{
      const d=V.sub(p,t.position);
      return [t.velocity[0]+t.spin*d[2],t.velocity[1],t.velocity[2]-t.spin*d[0]];
    };
    function crossing(a,b,skin){
      if(signed(a)<skin-1e-9)return null;
      const d=V.sub(b,a);
      if(kind==='sphere'){
        const r=radius+skin, q=V.dot(d,d), u=V.dot(a,d), det=u*u-q*(V.dot(a,a)-r*r);
        if(q<1e-16||u>=0||det<0)return null;
        const t=(-u-Math.sqrt(det))/q;
        return t>=-1e-9&&t<=1?V.mad(a,d,Math.max(0,t)):null;
      }
      let enter=0, exit=1;
      for(let j=0;j<3;j++){
        const limit=half[j]+skin;
        if(Math.abs(d[j])<1e-12){
          if(Math.abs(a[j])>limit)return null;
          continue;
        }
        const x=(-limit-a[j])/d[j], y=(limit-a[j])/d[j];
        enter=Math.max(enter,Math.min(x,y));
        exit=Math.min(exit,Math.max(x,y));
        if(exit<=enter)return null;
      }
      return enter>0&&enter<1?V.mad(a,d,enter):null;
    }
    function collide(from,to,speed,start,end,skin){
      const a=local(from,start), b=local(to,end), gap=signed(b), entry=crossing(a,b,skin);
      if(!entry&&gap>=skin)return null;
      const at=entry??b, n=normal(at), amount=Math.max(0,skin-signed(at))+skin*1e-4,
        point=world(V.mad(at,n,amount),end), axis=rotate(n,end), wall=velocity(point,end),
        relative=V.sub(speed,wall), inward=Math.min(0,V.dot(axis,relative)),
        tangent=V.mad(relative,axis,-V.dot(axis,relative)),
        response=V.mad(V.mad(speed,axis,-inward),tangent,-friction);
      return {point,speed:response,normal:axis,impact:-inward};
    }
    return {name,kind,position,turn,radius,half,reach,pose,dimensions,distance,collide,velocity};
  }

  function extract(density,domain,shapes,poses,settings){
    const {min,max,cell,toGrid}=domain, {iso,resolution,maxCells}=settings;
    const pad=cell*.7, bounds={min:min.map(n=>n-pad),max:max.map(n=>n+pad)};
    function field(x,y,z){
      const p=[x,y,z], grid=toGrid(p);
      const wall=Math.max(...p.map((n,i)=>Math.max(min[i]-n,n-max[i])));
      if(wall>=0)return wall+cell*.001;
      let value=Math.max(wall,cell*(iso-density.sample(...grid)));
      for(const [i,shape] of shapes.entries())value=Math.max(value,-shape.distance(p,poses[i]));
      return value;
    }
    const surface=P.geometry.surfaceNets(field,bounds,{cell:resolution,maxCells,maxSamples:Math.min(2800000,maxCells*32),refine:1});
    return {format:'ink-studio/liquid-surface',version:1,positions:surface.points.flat(),normals:surface.normals.flat(),
      triangles:surface.triangles.flat(),work:surface.work};
  }

  function oceanPatch(ocean,density,grid,domain,surface,time,focus){
    const {bounds,near,far,edge,samples}=ocean, chart=ocean.frame(time), {min,max,cell}=domain;
    const [nx,ny,nz]=grid.shape, col=new Float64Array(nx*nz), valid=new Uint8Array(col.length);
    const iso=surface.iso;
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)for(let y=ny-2;y>=1;y--){
      const i=grid.index(x,y,z), n=density.data[i], below=density.data[i-nx],above=density.data[i+nx];
      if(n<iso||below<iso*.68)continue;
      const scale=above>=iso?.5:Math.max(0,Math.min(1,(n-iso)/Math.max(1e-9,n-above)));
      const j=x+nx*z;
      valid[j]=1;col[j]=min[1]+(y+.5+scale)*cell;
      break;
    }
    function nearHeight(x,z){
      const gx=(x-min[0])/cell-.5,gz=(z-min[2])/cell-.5,i=Math.floor(gx),j=Math.floor(gz);
      let weight=0,sum=0;
      for(let b=Math.max(0,j);b<=Math.min(nz-1,j+1);b++)for(let a=Math.max(0,i);a<=Math.min(nx-1,i+1);a++){
        const k=a+nx*b;
        if(!valid[k])continue;
        const w=(1-Math.abs(a-gx))*(1-Math.abs(b-gz));weight+=w;sum+=w*col[k];
      }
      return {value:weight?sum/weight:null,weight};
    }
    const [width,height]=samples, positions=[], triangles=[], weights=[], spectral=[], local=[];
    for(let j=0;j<height;j++)for(let i=0;i<width;i++){
      const x=K.mix(bounds.min[0],bounds.max[0],i/(width-1)), z=K.mix(bounds.min[1],bounds.max[1],j/(height-1)),
        farHeight=ocean.height(chart,x,z), reach=Math.hypot(x-focus[0],z-focus[1]), inland=Math.min(x-min[0],max[0]-x,z-min[2],max[2]-z);
      const n=nearHeight(x,z), blend=(1-smooth((reach-near)/(far-near)))*smooth(inland/edge)*smooth(n.weight);
      positions.push(x,K.mix(farHeight,n.value??farHeight,blend),z);
      weights.push(blend);spectral.push(farHeight);local.push(n.value);
      if(i&&j){const d=i+j*width,c=d-1,b=d-width,a=c-width;triangles.push(a,c,b,b,c,d);}
    }
    return {format:'ink-studio/ocean-surface',version:1,focus,shape:samples,positions,triangles,weights,spectral,local,
      report:{nearVertices:weights.filter(w=>w>0).length,spectralVertices:weights.filter(w=>w===0).length}};
  }

  return Object.freeze({spectrum,collider,extract,oceanPatch,smooth});
})(KIT);
