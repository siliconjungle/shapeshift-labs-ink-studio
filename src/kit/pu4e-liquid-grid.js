/* Staggered volume grid and free-surface pressure projection. */
const liquidGrid3d = (() => {
  const offsets=[[1,.5,.5],[.5,1,.5],[.5,.5,1]];
  const cellOrigin=[.5,.5,.5];
  function lattice(shape){
    const [nx,ny,nz]=shape, count=nx*ny*nz, strides=[1,nx,nx*ny],
      index=(x,y,z)=>x+nx*(y+ny*z);
    const centers=Array.from({length:count},(_,i)=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))]);
    function visit(x,y,z,origin,callback){
      const gx=x-origin[0],gy=y-origin[1],gz=z-origin[2], ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz);
      for(let k=Math.max(0,iz);k<=Math.min(iz+1,nz-1);k++)for(let j=Math.max(0,iy);j<=Math.min(iy+1,ny-1);j++)
        for(let i=Math.max(0,ix);i<=Math.min(ix+1,nx-1);i++){
          const weight=(1-Math.abs(gx-i))*(1-Math.abs(gy-j))*(1-Math.abs(gz-k));
          if(weight>0)callback(index(i,j,k),weight);
        }
    }
    return {shape,count,strides,index,centers,visit};
  }

  function faces(cells){
    return offsets.map((_,axis)=>{
      const ext=cells.shape.map((n,i)=>n+Number(i===axis)), shape=lattice(ext), count=shape.count;
      const origin=offsets[axis].map((n,i)=>i===axis?0:n);
      const left=new Int32Array(count).fill(-1), right=new Int32Array(count).fill(-1);
      for(const [i,p] of shape.centers.entries()){
        const q=p.slice();q[axis]--;
        if(q[axis]>=0)left[i]=cells.index(...q);
        if(p[axis]<cells.shape[axis])right[i]=cells.index(...p);
      }
      return {...shape,origin,left,right,axis,open:new Uint8Array(count),wet:new Uint8Array(count),
        wall:new Float64Array(count),mass:new Float64Array(count),data:new Float64Array(count),
        at:shape.centers.map(p=>p.map((n,i)=>n+origin[i]))};
    });
  }

  function sample(grid,data,x,y,z,open){
    let value=0,total=0;
    grid.visit(x,y,z,grid.origin??cellOrigin,(i,w)=>{
      if(open&&!open[i])return;
      value+=w*data[i];total+=w;
    });
    return total?value/total:0;
  }

  function extend(grid,values,known,layers){
    let data=values.slice(), valid=known.slice();
    for(let layer=0;layer<layers;layer++){
      const next=data.slice(), flags=valid.slice();
      for(const [i,p] of grid.centers.entries()){
        if(!grid.open[i]||valid[i])continue;
        let count=0,total=0;
        for(let k=0;k<3;k++){
          const stride=grid.strides[k], a=i-stride,b=i+stride;
          if(p[k]>0&&valid[a]){total+=data[a];count++;}
          if(p[k]+1<grid.shape[k]&&valid[b]){total+=data[b];count++;}
        }
        if(count){next[i]=total/count;flags[i]=1;}
      }
      data=next;valid=flags;
    }
    return data;
  }

  function create(shape,cell){
    const cells=lattice(shape), axes=faces(cells), count=cells.count;
    const minFaces=axes.map(grid=>Int32Array.from(cells.centers,p=>grid.index(...p)));
    const maxFaces=axes.map((grid,axis)=>minFaces[axis].map(i=>i+grid.strides[axis]));
    const pressure=new Float64Array(count), rhs=new Float64Array(count),
      neighbors=new Int32Array(count*6), nNeighbors=new Uint8Array(count),
      solid=new Uint8Array(count), fluid=new Uint8Array(count);
    const divergence=(arrays,i)=>{
      let total=0;
      for(let k=0;k<3;k++)total+=arrays[k][maxFaces[k][i]]-arrays[k][minFaces[k][i]];
      return total;
    };

    function projection(arrays,iters){
      pressure.fill(0);nNeighbors.fill(0);
      const wet=[];
      let before=0;
      for(let i=0;i<count;i++)if(fluid[i]){
        wet.push(i);
        before+=Math.abs(rhs[i]=divergence(arrays,i));
        let n=0;
        for(let k=0;k<3;k++){
          if(axes[k].open[minFaces[k][i]])neighbors[i*6+n++]=i-cells.strides[k];
          if(axes[k].open[maxFaces[k][i]])neighbors[i*6+n++]=i+cells.strides[k];
        }
        nNeighbors[i]=n;
      }
      for(let pass=0;pass<iters;pass++)for(const i of wet){
        const n=nNeighbors[i];
        if(!n)continue;
        let total=0;
        for(let j=0;j<n;j++)total+=pressure[neighbors[i*6+j]];
        pressure[i]=(total-rhs[i])/n;
      }
      for(const [k,grid] of axes.entries())for(let i=0;i<grid.count;i++)if(grid.wet[i]){
        const a=grid.left[i],b=grid.right[i];
        arrays[k][i]-=pressure[b]-pressure[a];
      }
      let after=0;
      for(const i of wet)after+=Math.abs(divergence(arrays,i));
      const scale=1/(Math.max(1,wet.length)*cell);
      return {before:before*scale,after:after*scale,wetCells:wet.length};
    }

    function transfer(markers,obstacle,wallVelocity,dt,settings,oceanForce){
      fluid.fill(0);
      const obstacleId=new Int8Array(count).fill(-1);
      for(const [i,p] of cells.centers.entries())obstacleId[i]=obstacle(p[0]+.5,p[1]+.5,p[2]+.5);
      for(let i=0;i<count;i++)solid[i]=Number(obstacleId[i]>=0);
      for(const [x,y,z] of markers){
        const i=cells.index(Math.floor(x),Math.floor(y),Math.floor(z));
        if(!solid[i])fluid[i]=1;
      }
      for(const [k,grid] of axes.entries()){
        grid.wall.fill(0);
        for(let i=0;i<grid.count;i++){
          const a=grid.left[i],b=grid.right[i], inside=a>=0&&b>=0, block=inside?(solid[a]?obstacleId[a]:obstacleId[b]):-1;
          grid.open[i]=Number(inside&&block<0);
          grid.wet[i]=Number(inside&&block<0&&(fluid[a]||fluid[b]));
          if(block>=0)grid.wall[i]=wallVelocity(block,grid.at[i],k);
        }
      }
      function deposit(grid,k){
        grid.data.fill(0);grid.mass.fill(0);
        for(const row of markers)grid.visit(row[0],row[1],row[2],grid.origin,(i,w)=>{
          if(!grid.open[i])return;
          grid.mass[i]+=w;grid.data[i]+=row[k+3]*w;
        });
        const known=new Uint8Array(grid.count);
        for(let i=0;i<grid.count;i++)if(grid.mass[i]){
          grid.data[i]/=grid.mass[i];known[i]=1;
        }
        return extend(grid,grid.data,known,2);
      }
      const deposited=axes.map(deposit), before=deposited.map((data,k)=>extend(axes[k],data,axes[k].wet,2));
      const projected=before.map((data,k)=>{
        const grid=axes[k], next=data.slice();
        for(let i=0;i<next.length;i++){
          if(!grid.open[i])next[i]=grid.wall[i];
          else if(grid.wet[i]){
            const modified=next[i]+settings.gravity[k]*dt;
            next[i]=oceanForce?oceanForce(grid.at[i],k,modified):modified;
          }
        }
        return next;
      });
      const diagnostics=projection(projected,settings.pressureIterations);
      const after=projected.map((data,k)=>extend(axes[k],data,axes[k].wet,2));
      function gather([x,y,z],values){
        return axes.map((grid,k)=>sample(grid,values[k],x,y,z,grid.open));
      }
      const flow=pos=>gather(pos,after);
      const update=(row,velocity)=>flow(row).map((value,k)=>value+settings.flip*(velocity[k]-sample(axes[k],before[k],
        row[0],row[1],row[2],axes[k].open)));
      const wetAt=(x,y,z)=>x>=0&&x<shape[0]&&y>=0&&y<shape[1]&&z>=0&&z<shape[2]&&
        fluid[cells.index(Math.floor(x),Math.floor(y),Math.floor(z))]!==0;
      return {diagnostics,flow,update,wetAt};
    }

    function density(markers,radius,perCell){
      const result=new Float64Array(count), scale=1/(perCell*(32*Math.PI/105)*radius**3), r2=radius*radius;
      for(const [x,y,z] of markers){
        const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
        for(let k=Math.max(0,iz-1);k<=Math.min(iz+1,shape[2]-1);k++)
          for(let j=Math.max(0,iy-1);j<=Math.min(iy+1,shape[1]-1);j++)
            for(let i=Math.max(0,ix-1);i<=Math.min(ix+1,shape[0]-1);i++){
              const d=((x-i-.5)**2+(y-j-.5)**2+(z-k-.5)**2)/r2;
              if(d<1)result[cells.index(i,j,k)]+=(1-d)**2*scale;
            }
      }
      return {data:result,sample:(x,y,z)=>sample(cells,result,x,y,z)};
    }

    return {cells,axes,transfer,density};
  }
  return Object.freeze({create});
})();
