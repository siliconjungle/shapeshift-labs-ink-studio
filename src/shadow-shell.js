/* A painted texel occupies one closed interval along the outward normal. */
const ShadowShell = (() => {
  const depthLimit = 64, precision = 4095;
  const isDepth = n => Number.isFinite(n) && Math.abs(n) <= depthLimit;
  const clampIndex = (n,size) => Math.max(0,Math.min(size-1,n));

  function prepare(definition, width, height) {
    if (definition === undefined || definition === false) return undefined;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > 1024 || height > 1024)
      throw new RangeError('Shadow shells need between 1 and 1024 pixels on each axis');
    const size = width*height;
    const source = typeof definition === 'number' ? { front:0, back:-definition } : definition;
    if (!source || Object.getPrototypeOf(source) !== Object.prototype ||
        Object.keys(source).some(key => key !== 'front' && key !== 'back'))
      throw new TypeError('A shadow shell needs a thickness or paired front and back depth maps');
    const map = (value,label) => {
      if (isDepth(value)) return () => value;
      if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== size)
        throw new RangeError('Shadow shell '+label+' needs a depth in [-64, 64] or one per paint texel');
      return i => value[i];
    };
    const front = map(source.front,'front'), back = map(source.back,'back');
    let min = Infinity, max = -Infinity;
    for (let i=0;i<size;i++) {
      const f=front(i), b=back(i);
      if (!isDepth(f) || !isDepth(b) || b>f)
        throw new RangeError('Shadow shell depths must be finite, in [-64, 64], with back at or behind front');
      min=Math.min(min,b);
      max=Math.max(max,f);
    }
    if (min===0 && max===0) return undefined;
    const data = new Uint8Array(size*3), span = max-min;
    const quantize = span === 0 ? () => 0 : value => Math.round((value-min)/span*precision);
    for (let i=0;i<size;i++) {
      const key = quantize(front(i)) | (quantize(back(i))<<12);
      data[i*3]=key&255;
      data[i*3+1]=(key>>8)&255;
      data[i*3+2]=(key>>16)&255;
    }
    return Object.freeze({ width,height,min,max,data });
  }

  function fit(shell,width,height) {
    if (!shell || shell.width===width && shell.height===height) return shell;
    const data = new Uint8Array(width*height*3);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const s = Math.floor((x+.5)*shell.width/width), t = Math.floor((y+.5)*shell.height/height);
      const offset=(t*shell.width+s)*3;
      data.set(shell.data.subarray(offset,offset+3),(y*width+x)*3);
    }
    return { ...shell,width,height,data };
  }

  function crop(shell,x,y,width,height) {
    if (!shell || x===0 && y===0 && shell.width===width && shell.height===height) return shell;
    const data=new Uint8Array(width*height*3);
    for (let j=0;j<height;j++) {
      const start=((y+j)*shell.width+x)*3;
      data.set(shell.data.subarray(start,start+width*3),j*width*3);
    }
    return { ...shell,width,height,data };
  }

  function slab(a,b,start,speed,lo,hi) {
    if (Math.abs(speed)<=1e-8) return start>=lo && start<=hi ? [a,b] : null;
    const t0=(lo-start)/speed, t1=(hi-start)/speed;
    a=Math.max(a,Math.min(t0,t1));
    b=Math.min(b,Math.max(t0,t1));
    return a<=b ? [a,b] : null;
  }

  function firstHit(image,mapping,cutoff,origin,direction,stop,scale) {
    const { width,height,alpha,shell }=image;
    const near=1e-5;
    if (stop<=near) return Infinity;
    const u=slab(near,stop,origin[0],direction[0],0,1);
    const v=u && slab(...u,origin[1],direction[1],0,1);
    const bottom=shell.min*scale, top=shell.max*scale;
    const span=v && slab(...v,origin[2],direction[2],bottom,top);
    if (!span || span[0]>=stop) return Infinity;
    let [time,end]=span;
    const gx=mapping[0]+origin[0]*mapping[2], gy=mapping[1]+origin[1]*mapping[3],
      dx=direction[0]*mapping[2], dy=direction[1]*mapping[3];
    const sx=Math.abs(dx)<=1e-8 ? 0 : Math.sign(dx), sy=Math.abs(dy)<=1e-8 ? 0 : Math.sign(dy);
    const atX=gx+dx*time, atY=gy+dy*time;
    let x=clampIndex(sx<0 ? Math.ceil(atX)-1 : Math.floor(atX),width),
      y=clampIndex(sy<0 ? Math.ceil(atY)-1 : Math.floor(atY),height);
    const decode = (top-bottom)/precision, bytes=shell.data;
    // A ray can visit at most one new cell per crossed grid boundary.
    for (let i=0;i<width+height+1;i++) {
      const nx=(sx>0 && x+1<width || sx<0 && x>0) ? (x+(sx>0)-gx)/dx : Infinity;
      const ny=(sy>0 && y+1<height || sy<0 && y>0) ? (y+(sy>0)-gy)/dy : Infinity;
      const far=Math.min(end,nx,ny), p=y*width+x;
      if (far>=time && alpha[p]>=cutoff) {
        const key=bytes[p*3]+bytes[p*3+1]*256+bytes[p*3+2]*65536;
        const back=bottom+(key>>12)*decode, front=bottom+(key&precision)*decode;
        const hit=slab(time,far,origin[2],direction[2],back,front);
        if (hit && hit[0]<stop) return hit[0];
      }
      if (far>=end) break;
      if (nx<=ny) x+=sx;
      if (ny<=nx) y+=sy;
      time=Math.max(time,far);
    }
    return Infinity;
  }

  function trace(image,mapping,cutoff,origin,direction,stop,scale) {
    return Number.isFinite(firstHit(image,mapping,cutoff,origin,direction,stop,scale));
  }
  return Object.freeze({ prepare, fit, crop, trace, firstHit });
})();
if (typeof module !== 'undefined') module.exports = ShadowShell;
