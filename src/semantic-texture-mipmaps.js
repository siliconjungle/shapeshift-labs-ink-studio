/* Build per-material mip chains. Every level integrates the original texels. */
const SemanticTextureMipmaps = (() => {
  const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
  const rgb24=n=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffff;
  const bytes=a=>a instanceof Uint8Array || a instanceof Uint8ClampedArray;
  const bound=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  const linear=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
  const display=n=>n<=.0031308?n*12.92:1.055*n**(1/2.4)-.055;
  const linearByte=Float32Array.from({length:256},(_,n)=>linear(n/255));
  const toByte=n=>Math.round(bound(n,0,1)*255);
  const normalized=(n,fallback)=>{
    const len=Math.hypot(...n);
    return len>1e-8?n.map(x=>x/len):fallback;
  };
  const fromSRGBByte = value => linearByte[value];
  const toSRGBByte = value => toByte(display(value));
  function filterNormal(mean, roughnessSquared, variance = 1) {
    const length = Math.hypot(...mean);
    return {
      direction: length > 1e-8 ? mean.map(value => value / length) : [0,0,1],
      roughness: toByte(Math.sqrt(Math.min(1, roughnessSquared + variance * Math.max(0, 1 - length))))
    };
  }
  const rank=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  function settings(value) {
    if(value===undefined || value===false)return null;
    const s=value===true?{}:value;
    if(!s || Object.getPrototypeOf(s)!==Object.prototype ||
      Object.keys(s).some(key=>!['protect','protectCoverage','variance','light','specular','ambient'].includes(key)))
      throw new TypeError('Invalid semantic mipmap settings');
    const {protect=[],protectCoverage=.06,variance=1,light=[-.45,.66,.60],specular=.28,ambient=1}=s;
    if(!Array.isArray(protect)||protect.length>16||!Array.from(protect).every(rgb24)||new Set(protect).size!==protect.length ||
      !unit(protectCoverage)||protectCoverage===0 || !Number.isFinite(variance)||variance<0||variance>4 ||
      !Array.isArray(light)||light.length!==3||!Array.from(light).every(Number.isFinite)||Math.hypot(...light)<1e-8 ||
      !Number.isFinite(specular)||specular<0||specular>4||!unit(ambient))
      throw new RangeError('Invalid protected colors, normal variance or specular light');
    return Object.freeze({protect:protect.slice(),protectCoverage,variance,light:normalized(light),specular,ambient});
  }

  function texture(input) {
    if(input?.indices===undefined)return input;
    const {width,height,indices,palette,coverage}=input;
    if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024)||
      !bytes(indices)||indices.length!==width*height||
      !Array.isArray(palette)||!palette.length||palette.length>256||!Array.from(palette).every(rgb24)||
      !indices.every(i=>i<palette.length)||coverage!==undefined&&(!bytes(coverage)||coverage.length!==indices.length)||
      input.pixels!==undefined)
      throw new RangeError('Indexed pigment needs a palette, matching byte indices and optional coverage');
    const pixels=new Uint8Array(indices.length*4);
    for(let i=0;i<indices.length;i++){
      const c=palette[indices[i]], at=i*4;
      pixels[at]=c>>16; pixels[at+1]=(c>>8)&255; pixels[at+2]=c&255; pixels[at+3]=coverage?.[i]??255;
    }
    return {width,height,pixels,indices,palette};
  }

  function scanFrame(daylight=true, appearance=0) {
    if (typeof daylight!=='boolean' || !unit(appearance))
      throw new RangeError('Scan shading needs a daylight switch and an appearance weight from 0 to 1');
    return {daylight,appearance};
  }

  function scanCapture(source,count) {
    if (source===undefined) return null;
    if (!source || typeof source!=='object') throw new TypeError('Supply a registered scan material');
    const {pixels,sourceView,angles=[.75,.99]}=source;
    if (pixels!==undefined && (!bytes(pixels)||pixels.length!==count*4 ||
        !Array.isArray(sourceView)||sourceView.length!==4||!sourceView.every(Number.isFinite)||
        ![0,1].includes(sourceView[3])||sourceView[3]===0&&Math.hypot(...sourceView.slice(0,3))<1e-8 ||
        !Array.isArray(angles)||angles.length!==2||!angles.every(n=>Number.isFinite(n)&&n>=-1&&n<=1)||angles[0]>=angles[1]))
      throw new RangeError('Scan appearance needs registered RGBA pixels, capture view and increasing angle cosines');
    return pixels===undefined ? {} : {sourceView:sourceView.slice(),angles:angles.slice()};
  }

  function build({width,height,pigment,normal,roughness=.65,emission,emissionStrength=1,indices,palette,scan}, config=true) {
    const rule=settings(config), count=width*height;
    if(!rule||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=1024)||
      !bytes(pigment)||pigment.length!==count*4||normal!==undefined&&(!bytes(normal)||normal.length!==count*4)||
      !unit(roughness)&&(!bytes(roughness)||roughness.length!==count)||
      emission!==undefined&&(!bytes(emission)||![count*3,count*4].includes(emission.length)) ||
      !Number.isFinite(emissionStrength)||emissionStrength<0||emissionStrength>1024 ||
      (indices!==undefined||palette!==undefined)&&(!bytes(indices)||indices.length!==count||!Array.isArray(palette)||
        !palette.length||palette.length>256||!Array.from(palette).every(rgb24)||!indices.every(i=>i<palette.length)) ||
      rule.protect.some(c=>!palette?.includes(c)))
      throw new RangeError('Semantic mipmaps need matching maps and protected colors from the indexed palette');
    const capture=scanCapture(scan,count), captured=scan?.pixels;
    const captureStride=captured?4:0;
    const protect=palette?.map(color=>rule.protect.includes(color)), levels=[];
    const data=new Float32Array(count*8), appearance=captured&&new Float32Array(count*4), emissionStride=emission?emission.length/count:0;
    for(let p=0;p<count;p++){
      const i=p*4, at=p*8;
      if(!pigment[i+3])continue;
      for(let c=0;c<3;c++){
        data[at+c]=linearByte[pigment[i+c]];
        if(emission)data[at+3+c]=linearByte[emission[p*emissionStride+c]];
        if(appearance)appearance[i+c]=linearByte[captured[i+c]]*captured[i+3]/255;
      }
      if(appearance)appearance[i+3]=captured[i+3]/255;
      data[at+6]=unit(roughness)?roughness**2:(roughness[p]/255)**2;
      data[at+7]=pigment[i+3]/255;
    }
    const normals=normal && new Float32Array(count*3);
    if(normals)for(let i=0;i<count;i++){
      const at=i*4;
      normals.set(normal[at+3]>=128?normalized([0,1,2].map(c=>Math.max(-127,normal[at+c]-128)),[0,0,1]):[0,0,1],i*3);
    }
    const votes=indices&&new Float64Array(palette.length), used=[];
    for(let w=width,h=height;;w=Math.max(1,w>>1),h=Math.max(1,h>>1)){
      const texels=w*h, layerBytes=texels*4, rgba=new Uint8Array(layerBytes*(3+(captured?1:0)));
      const scaleX=width/w,scaleY=height/h;
      const sum=new Float64Array(11+captureStride);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const left=x*scaleX,right=(x+1)*scaleX,top=y*scaleY,bottom=(y+1)*scaleY;
        sum.fill(0);
        for(let sy=Math.floor(top);sy<Math.min(height,Math.ceil(bottom));sy++)for(let sx=Math.floor(left);sx<Math.min(width,Math.ceil(right));sx++){
          const p=sy*width+sx, at=p*8;
          const weight=(Math.min(right,sx+1)-Math.max(left,sx))*(Math.min(bottom,sy+1)-Math.max(top,sy))*data[at+7];
          if(weight<=0)continue;
          sum[0]+=weight;
          for(let c=0;c<7;c++)sum[c+1]+=data[at+c]*weight;
          if(normals)for(let c=0;c<3;c++)sum[c+8]+=normals[p*3+c]*weight;
          if(appearance)for(let c=0;c<4;c++)sum[11+c]+=appearance[p*4+c]*weight;
          if(indices){
            const index=indices[p];
            if(votes[index]===0)used.push(index);
            votes[index]+=weight;
          }
        }
        const area=sum[0], i=(y*w+x)*4;
        let best=-1, topVote=-1, protectedVote=-1, priority=-1;
        for(const index of used){
          const vote=votes[index];
          if(vote>topVote || vote===topVote&&index<best){best=index;topVote=vote;}
          if(protect[index] && vote+1e-10>=area*rule.protectCoverage &&
            (vote>protectedVote || vote===protectedVote&&index<priority)){priority=index;protectedVote=vote;}
          votes[index]=0;
        }
        used.length=0;
        if(!area)continue;
        // Pigment only sees covered texels. Indexed pigment returns an authored swatch.
        const chosen=priority>=0?priority:best;
        if(chosen>=0) {
          const c=palette[chosen];
          rgba[i]=c>>16; rgba[i+1]=c>>8&255; rgba[i+2]=c&255;
        } else for(let c=0;c<3;c++)rgba[i+c]=toSRGBByte(sum[c+1]/area);
        rgba[i+3]=toByte(area/(scaleX*scaleY));
        const mean=normals?[sum[8]/area,sum[9]/area,sum[10]/area]:[0,0,1];
        const filtered=filterNormal(mean,sum[7]/area,rule.variance);
        for(let c=0;c<3;c++){
          rgba[layerBytes+i+c]=128+Math.round(filtered.direction[c]*127);
          rgba[layerBytes*2+i+c]=toSRGBByte(sum[4+c]/area);
        }
        if(captured){
          const at=layerBytes*3+i;
          if(sum[14])for(let c=0;c<3;c++)rgba[at+c]=toByte(display(sum[11+c]/sum[14]));
          rgba[at+3]=toByte(sum[14]/area);
        }
        rgba[layerBytes+i+3]=filtered.roughness;
      }
      levels.push({width:w,height:h,rgba});
      if(w===1&&h===1)break;
    }
    return {width,height,levels,rule,emissionStrength,normal:!!normal,scan:capture,captured:!!captured};
  }

  function levelAt(chain,footprint) {
    return bound(Math.log2(Math.max(1,footprint)),0,chain.levels.length-1);
  }

  function sample(chain,u,v,footprint=1) {
    const lod=levelAt(chain,footprint), lo=Math.floor(lod), hi=Math.ceil(lod), blend=lod-lo;
    function read(index){
      const {width,height,rgba}=chain.levels[index], stride=width*height*4;
      const x=bound(Math.floor(.5+u*(width-1)),0,width-1), y=bound(Math.floor(.5+v*(height-1)),0,height-1);
      const at=(y*width+x)*4;
      return {x,y,rgba,at,stride};
    }
    const a=read(lo), b=hi===lo?a:read(hi), color=blend>=.5?b:a;
    const coverage=color.rgba[color.at+3]/255, visible=coverage>=(rank[color.y%4*4+color.x%4]+.5)/16;
    const weightA=(1-blend)*a.rgba[a.at+3],weightB=blend*b.rgba[b.at+3],total=weightA+weightB;
    function mix(readA,readB){
      return total?(readA*weightA+readB*weightB)/total:0;
    }
    const normal=normalized([0,1,2].map(c=>mix(a.rgba[a.at+a.stride+c]-128,b.rgba[b.at+b.stride+c]-128)),[0,0,1]);
    const roughness=mix(a.rgba[a.at+a.stride+3],b.rgba[b.at+b.stride+3])/255;
    const emission=[0,1,2].map(c=>chain.emissionStrength*
      mix(linearByte[a.rgba[a.at+a.stride*2+c]],linearByte[b.rgba[b.at+b.stride*2+c]]));
    const captured=chain.captured && Array.from(color.rgba.subarray(color.stride*3+color.at,color.stride*3+color.at+4),
      (n,k)=>k===3?n/255:linearByte[n]);
    return {color:Array.from(color.rgba.subarray(color.at,color.at+3),n=>n/255),coverage,visible,normal,roughness,emission,lod,
      ...(captured && {captured})};
  }

  function shade(color,normal,view,{roughness,emission,sheen,captured},rule, options) {
    const sun=options?.sun, light=sun?.direction??rule.light, h=normalized(light.map((n,c)=>n+view[c]),[0,0,0]);
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const gloss=1-roughness, daylight=options?.daylight!==false;
    const shine=daylight && dot(normal,light)>0 && dot(normal,view)>0 ?
      (sun?.intensity??1)*(sheen??rule.specular)*gloss*Math.max(0,dot(normal,h))**(4+96*gloss**2):0;
    const ambient=sun?.ambient??rule.ambient??1;
    const diffuse=ambient+(daylight?(sun?.intensity??1-ambient)*Math.max(0,dot(normal,light)):0);
    let blend=0;
    if(captured?.[3] && options?.appearance){
      const {sourceView,angles}=options.scan;
      const direction=normalized(sourceView.slice(0,3).map((n,k)=>n-sourceView[3]*options.position[k]),[0,0,0]);
      const weight=bound((dot(view,direction)-angles[0])/(angles[1]-angles[0]),0,1);
      blend=options.appearance*captured[3]*weight*weight*(3-2*weight);
    }
    return color.map((ink,c)=>{
      const lit=bound(linear(ink)*(diffuse+(options?.irradiance?.[c]??0))+emission[c]+shine+(options?.highlight?.[c]??0),0,1);
      return display(blend ? lit+(captured[c]-lit)*blend : lit);
    });
  }

  return Object.freeze({settings,texture,build,levelAt,sample,shade,scanFrame,rank,fromSRGBByte,toSRGBByte,filterNormal});
})();
if (typeof module !== 'undefined') module.exports = SemanticTextureMipmaps;
