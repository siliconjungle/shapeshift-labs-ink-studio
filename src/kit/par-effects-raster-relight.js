/* Direct screen-space transfer from a colored emission raster to a diffuse receiver. */
(function (P) {
  const {view,channel,unit,byte,int,plane}=P.pixelEffectSupport;
  const maxPixels=1048576, maxVisits=64e6;
  const raster=(width,height,channels,data)=>({width,height,channels,data});
  const decode=ColorSpace.prepare('srgb','srgb-linear');
  const encode=ColorSpace.prepare('srgb-linear','srgb');
  const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;
  const range=(value,min,max)=>Number.isFinite(value) && value>=min && value<=max;

  function grid(source, width, height, allowed, label) {
    const data=view(source).data, channels=data.length/(source.width*source.height);
    if (source.width!==width || source.height!==height || !allowed.includes(channels))
      throw new RangeError('Raster relight '+label+' needs matching dimensions and '+allowed.join(' or ')+' channels');
    return {data,channels};
  }

  function receiver(width,height,{normals,heightMap,mask,normalEncoding,heightScale,maskScale}) {
    const area=width*height;
    const normalMap=normals==null ? null : grid(normals,width,height,[3,4],'normals');
    const relief=heightMap==null ? null : Float64Array.from(grid(heightMap,width,height,[1],'height').data,n=>{
      const z=n*heightScale;
      if (!range(z,-1e6,1e6)) throw new RangeError('Raster relight height exceeds its art-pixel range');
      return z;
    });
    if (mask!=null && (mask.width!==width || mask.height!==height))
      throw new RangeError('Raster relight mask needs matching dimensions');
    const maskValues=mask==null ? null : channel(mask);
    if (!relief && !normalMap && !maskValues) return {relief,normal:null};

    // Premultiply the normal by coverage so a partial mask scales only the received light.
    const normal=new Float32Array(area*3);
    for (let y=0,p=0;y<height;y++) for (let x=0;x<width;x++,p++) {
      const coverage=maskValues ? unit(maskValues[p]/maskScale) : 1;
      if (!coverage) continue;
      let nx=0,ny=0,nz=1;
      if (normalMap) {
        const {data,channels}=normalMap, i=p*channels;
        if (channels===4 && data[i+3]<=0) continue;
        nx=data[i]; ny=data[i+1]; nz=data[i+2];
        if (normalEncoding==='rgb8') {
          nx=unit(nx/255)*2-1; ny=unit(ny/255)*2-1; nz=unit(nz/255)*2-1;
        }
      } else if (relief) {
        const left=x>0 ? x-1 : x, right=x+1<width ? x+1 : x;
        const top=y>0 ? y-1 : y, bottom=y+1<height ? y+1 : y;
        nx=(relief[y*width+left]-relief[y*width+right])/(right-left || 1);
        ny=(relief[bottom*width+x]-relief[top*width+x])/(bottom-top || 1);
      }
      const length=Math.hypot(nx,ny,nz);
      if (!length) continue;
      if (!Number.isFinite(length)) throw new RangeError('Raster relight normal magnitude must be finite');
      normal[3*p]=nx/length*coverage;
      normal[3*p+1]=ny/length*coverage;
      normal[3*p+2]=nz/length*coverage;
    }
    return {relief,normal};
  }

  function footprint(x,y,radius,width,height) {
    return [Math.max(0,Math.ceil(x-radius)),Math.max(0,Math.ceil(y-radius)),
      Math.min(width-1,Math.floor(x+radius)),Math.min(height-1,Math.floor(y+radius))];
  }

  function sourceSamples(emission,width,height,radius,{sampleStep,emissionEncoding,emissionScale}) {
    const {data,channels}=emission, step=sampleStep;
    const hasAlpha=channels===2 || channels===4, mono=channels<3;
    const output=new Float64Array(5*Math.ceil(width/step)*Math.ceil(height/step));
    const rgb=[0,0,0];
    let visits=0, used=0;
    for (let y0=0;y0<height;y0+=step) for (let x0=0;x0<width;x0+=step) {
      const right=Math.min(width,x0+step), bottom=Math.min(height,y0+step);
      let r=0,g=0,b=0,mx=0,my=0,energy=0;
      for (let y=y0;y<bottom;y++) for (let x=x0;x<right;x++) {
        const i=(y*width+x)*channels;
        const a=hasAlpha ? unit(data[i+channels-1]/emissionScale) : 1;
        if (!a) continue;
        for (let c=0;c<3;c++) {
          const component=Math.max(0,data[i+(mono ? 0 : c)]/emissionScale);
          if (emissionEncoding==='linear' && component>4096)
            throw new RangeError('Raster relight linear emission exceeds 4096 after scaling');
          rgb[c]=emissionEncoding==='linear' ? component : unit(component);
        }
        if (!(rgb[0] || rgb[1] || rgb[2])) continue;
        if (emissionEncoding==='srgb') decode(rgb,rgb);
        const red=rgb[0]*a, green=rgb[1]*a, blue=rgb[2]*a;
        const weight=luma(red,green,blue);
        mx+=(x-x0)*weight; my+=(y-y0)*weight; energy+=weight;
        r+=red; g+=green; b+=blue;
      }
      if (!energy) continue;
      const ex=x0+mx/energy, ey=y0+my/energy;
      const [left,top,endX,endY]=footprint(ex,ey,radius,width,height);
      visits+=(endX-left+1)*(endY-top+1);
      if (visits>maxVisits) throw new RangeError('Raster relight exceeds its light visit budget. Reduce radius or increase sampleStep.');
      output[used++]=ex; output[used++]=ey; output[used++]=r; output[used++]=g; output[used++]=b;
    }
    return output.subarray(0,used);
  }

  function relight(emission,{normals,height:heightMap,mask,radius=32,emitterHeight=8,strength=1,heightScale=1,
    normalEncoding='signed',emissionEncoding=emission?.colorSpace==='srgb-linear' ? 'linear' : 'srgb',
    emissionScale=emission?.colorSpace==='srgb-linear' ? 1 : 255,maskScale=255,sampleStep=1}={}) {
    const {width,height,data}=view(emission), area=width*height;
    if (area>maxPixels || !range(radius,1,256) || !range(emitterHeight,-4096,4096) ||
        !range(strength,0,1024) || !range(heightScale,-4096,4096) ||
        !range(emissionScale,1/65536,65536) || !range(maskScale,1/65536,65536) ||
        !int(sampleStep,1,32) || !['signed','rgb8'].includes(normalEncoding) ||
        !['srgb','linear'].includes(emissionEncoding))
      throw new RangeError('Invalid raster relight grid, reach, strength, encoding, scale or sample step');
    const {relief,normal}=receiver(width,height,{normals,heightMap,mask,normalEncoding,heightScale,maskScale});
    const light=new Float64Array(area*3), value=new Uint8Array(area*4), magnitude=new Float64Array(area);
    const reach=relief ? radius : Math.sqrt(Math.max(0,radius*radius-emitterHeight*emitterHeight));
    if (!strength || !reach) return result();
    const sources=sourceSamples({data,channels:data.length/area},width,height,reach,
      {sampleStep,emissionEncoding,emissionScale});
    const squaredRadius=radius*radius;
    for (let j=0;j<sources.length;j+=5) {
      const ex=sources[j],ey=sources[j+1],r=sources[j+2],g=sources[j+3],b=sources[j+4];
      const [left,top,right,bottom]=footprint(ex,ey,reach,width,height);
      for (let y=top;y<=bottom;y++) for (let x=left,p=y*width+left;x<=right;x++,p++) {
        const dx=ex-x,dy=y-ey,dz=emitterHeight-(relief?.[p] ?? 0);
        const distanceSquared=dx*dx+dy*dy+dz*dz;
        if (!distanceSquared || distanceSquared>=squaredRadius) continue;
        const i=3*p;
        const facing=normal ? normal[i]*dx+normal[i+1]*dy+normal[i+2]*dz : dz;
        if (facing<=0) continue;
        const distance=Math.sqrt(distanceSquared);
        const weight=strength*(facing/distance)*(1-distance/radius)**2;
        light[i]+=r*weight; light[i+1]+=g*weight; light[i+2]+=b*weight;
      }
    }

    const show=[0,0,0];
    for (let p=0,i=0;p<area;p++,i+=3) {
      const r=light[i],g=light[i+1],b=light[i+2];
      magnitude[p]=luma(r,g,b);
      if (!magnitude[p]) continue;
      show[0]=unit(r); show[1]=unit(g); show[2]=unit(b);
      encode(show,show);
      const peak=Math.max(...show), target=p*4;
      value[target+3]=byte(255*peak);
      if (value[target+3]) for (let c=0;c<3;c++) value[target+c]=byte(255*show[c]/peak);
    }
    return result();

    function result() {
      return {value:{...raster(width,height,4,value),colorSpace:'srgb'},
        irradiance:{...raster(width,height,3,light),colorSpace:'srgb-linear'},
        intensity:plane(width,height,magnitude)};
    }
  }

  P.pixelEffects.relight=relight;
})(KIT.procedural);
