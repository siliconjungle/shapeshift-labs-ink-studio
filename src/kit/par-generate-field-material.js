/* Object-space materials for traced native-pixel field sprites. */
(function (K) {
  const P=K.procedural;
  const {raster,vector,range,unit,wrap,sampleField,validRaster}=P.generatorSupport;
  const validMaterial=P.graphTypes.validator('fieldSpriteMaterial');
  const validSurface=P.graphTypes.validator('fieldSpriteSurface');
  const validField=P.graphTypes.validator('field');
  const validPalette=P.graphTypes.validator('palette');
  const neutral=Object.freeze(raster(1,1,Object.freeze([128])));
  const projected=['cylinder-y','xy','xz','yz','triplanar'];
  const tau=2*Math.PI;
  const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;
  const addresses=['clamp','wrap','mirror','transparent'];

  function paletteSampler(ramp) {
    if (ramp==null) return null;
    const parse=P.materials.perceptual.parse;
    if (validPalette(ramp)) {
      const colors=Array.from(ramp.palette ?? ramp,parse);
      return t=>colors[Math.min(colors.length-1,Math.floor(t*colors.length))];
    }
    if (Array.isArray(ramp.stops))
      return ColorCurves.ramp({stops:ramp.stops,interpolation:ramp.interpolation ?? 'step'},parse);
    throw new TypeError('Field sprite material ramp needs an Ink palette or ordered color stops');
  }

  function mapUV(point, frame, projection, uv) {
    const {min,max,span,center}=frame;
    const x=(point[0]-min[0])/span[0], y=(max[1]-point[1])/span[1], z=(point[2]-min[2])/span[2];
    if (projection==='cylinder-y') {
      uv[0]=wrap(Math.atan2(point[0]-center[0],point[2]-center[2])/tau+.5,1);
      uv[1]=y;
    } else {
      uv[0]=projection==='yz' ? z : x;
      uv[1]=projection==='xz' ? z : y;
    }
  }

  function textureSampler(source,{projection,scale,offset,filter,edgeU,edgeV,sharpness}) {
    if (!validRaster(source) || source.width*source.height>262144)
      throw new RangeError('Field sprite material texture needs a raster of up to 262,144 pixels');
    const sample=P.rasterWarp.createSampler(source,{filter,edgeU,edgeV});
    const uv=[0,0], part=new Float64Array(4);
    function plane(point,frame,axes,out) {
      mapUV(point,frame,axes,uv);
      sample(uv[0]*scale[0]+offset[0],uv[1]*scale[1]+offset[1],out);
    }
    if (projection!=='triplanar') return (point,_normal,frame,out)=>plane(point,frame,projection,out);
    const planes=['yz','xz','xy'];
    return (point,normal,frame,out)=>{
      const wx=Math.abs(normal[0])**sharpness, wy=Math.abs(normal[1])**sharpness, wz=Math.abs(normal[2])**sharpness;
      const sum=wx+wy+wz;
      if (!sum) return plane(point,frame,'xy',out);
      const weights=[wx/sum,wy/sum,wz/sum];
      out.fill(0);
      for (let axis=0;axis<3;axis++) {
        const weight=weights[axis];
        if (!weight) continue;
        plane(point,frame,planes[axis],part);
        for (let c=0;c<4;c++) out[c]+=part[c]*weight;
      }
    };
  }

  function fieldMaterial({texture=neutral,mask=null,maskTexture=null,ramp=null,projection='triplanar',
    scale=[1,1],offset=[0,0],filter='nearest',edgeU=projection==='cylinder-y' ? 'wrap' : 'clamp',edgeV='clamp',
    sharpness=4,opacity=1,maskLevel=0,maskFeather=0,lightGain=1,lightBias=0,textureGain=1}={}) {
    if (!projected.includes(projection) || !vector(scale,2) || !scale.every(n=>range(Math.abs(n),1e-6,1024)) ||
        !vector(offset,2) || !offset.every(n=>range(n,-1e6,1e6)) ||
        !['nearest','linear'].includes(filter) || !addresses.includes(edgeU) || !addresses.includes(edgeV) ||
        !range(sharpness,.25,32) || !range(opacity,0,1) || !range(maskLevel,-1e9,1e9) ||
        !range(maskFeather,0,1e6) || !range(lightGain,0,16) || !range(lightBias,-16,16) ||
        !range(textureGain,0,16) || mask!=null&&!validField(mask))
      throw new RangeError('Invalid field sprite material mapping, light, opacity or mask controls');
    const options={projection,scale:scale.slice(),offset:offset.slice(),filter,edgeU,edgeV,sharpness};
    const shade=textureSampler(texture,options), palette=paletteSampler(ramp);
    const stencil=maskTexture==null ? null : textureSampler(maskTexture,options);
    const texel=new Float64Array(4), matte=new Float64Array(4), rampColor=[0,0,0];
    function sample(point,normal,frame,light,time,out) {
      let strength=opacity;
      if (mask!=null && strength) {
        const distance=maskLevel-sampleField(mask,point[0],point[1],point[2],time);
        strength*=maskFeather ? unit(.5+distance/maskFeather) : Number(distance>=0);
      }
      if (!strength) return 0;
      if (stencil) {
        stencil(point,normal,frame,matte);
        strength*=unit(luma(matte[0],matte[1],matte[2])/255);
        if (!strength) return 0;
      }
      shade(point,normal,frame,texel);
      const a=texel[3];
      if (!a) return 0;
      const illumination=lightBias+lightGain*light;
      if (palette) {
        const tone=luma(texel[0]/a-128,texel[1]/a-128,texel[2]/a-128)/255;
        const tint=palette(unit(illumination+textureGain*tone),rampColor);
        for (let c=0;c<3;c++) out[c]=255*tint[c];
      } else for (let c=0;c<3;c++) out[c]=255*unit((texel[c]/255/a)*illumination);
      return unit(strength*a);
    }
    return Object.freeze({format:'ink-studio/field-sprite-material',sample});
  }

  function shadeFieldSprite(surface,materials=[],{time=surface?.time ?? 0}={}) {
    if (!validSurface(surface) || !Array.isArray(materials) || materials.length>16 ||
        !Array.from(materials).every(validMaterial) || !Number.isFinite(time))
      throw new TypeError('Field sprite shading needs a traced surface, ≤16 materials and finite time');
    const {value,position,normal,illumination,coverage,bounds}=surface, {width,height}=value;
    if (width*height>262144 || !vector(bounds?.min,3) || !vector(bounds?.max,3) ||
        !bounds.min.every((n,i)=>n<bounds.max[i] && Number.isFinite(bounds.max[i]-n)) ||
        [value,position,normal,illumination,coverage].some((plane,i)=>
          plane.width!==width || plane.height!==height || plane.data.length!==width*height*[4,3,3,1,1][i]))
      throw new RangeError('Field sprite surface requires bounded, aligned trace planes');
    const {min,max}=bounds, span=max.map((n,i)=>n-min[i]);
    const frame={min,max,span,center:min.map((n,i)=>n+span[i]*.5)};
    const ids=new Int16Array(width*height).fill(-1), data=materials.length ? Uint8Array.from(value.data) : value.data;
    const point=[0,0,0], direction=[0,0,0], tint=[0,0,0];
    for (let i=0;i<ids.length;i++) {
      if (!coverage.data[i]) continue;
      ids[i]=0;
      if (!materials.length) continue;
      const rgb=i*4, geometry=i*3;
      for (let c=0;c<3;c++) {
        point[c]=position.data[geometry+c];
        direction[c]=normal.data[geometry+c];
      }
      let r=data[rgb],g=data[rgb+1],b=data[rgb+2];
      for (let k=0;k<materials.length;k++) {
        const opacity=materials[k].sample(point,direction,frame,illumination.data[i],time,tint);
        if (!opacity) continue;
        r+=(tint[0]-r)*opacity; g+=(tint[1]-g)*opacity; b+=(tint[2]-b)*opacity;
        ids[i]=k+1;
      }
      data[rgb]=Math.round(r); data[rgb+1]=Math.round(g); data[rgb+2]=Math.round(b);
    }
    return {value:{...value,data},materialId:raster(width,height,ids)};
  }

  Object.assign(P.generator,{fieldMaterial,shadeFieldSprite});
  P.generatorSupport.fieldMaterialTexture=neutral;
})(KIT);
