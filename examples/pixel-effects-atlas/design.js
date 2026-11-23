/* Shared art-grid and layer utilities for the procedural studies. */
module.exports = function design({KIT}, size) {
  const {generator, drawing2d, raster, fields, rasterSimulation, sampling} = KIT.procedural;
  const {width,height} = size, tau = Math.PI * 2;
  const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b,x));
  const mix = (a,b,f) => a+(b-a)*f;
  const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
  const wrap = (n, p=tau) => (n%p+p)%p;
  const rgb = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const rgbCache = new Map();
  const hex = n => typeof n==='string'?n:'#'+n.toString(16).padStart(6,'0');
  const band = (colors,x) => colors[Math.min(colors.length-1,Math.floor(clamp(x)*colors.length))];
  const hash = (x,y,seed=0) => {
    let n=Math.imul(x+127,0x45d9f3b)^Math.imul(y+31,0x27d4eb2d)^Math.imul(seed+1,0x7feb352d);
    n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;
  };
  function noise(x,y,seed=0){
    const i=Math.floor(x),j=Math.floor(y),sx=smooth(0,1,x-i),sy=smooth(0,1,y-j);
    return mix(mix(hash(i,j,seed),hash(i+1,j,seed),sx),mix(hash(i,j+1,seed),hash(i+1,j+1,seed),sx),sy);
  }
  const texture=(x,y,seed=0)=>.60*noise(x,y,seed)+.28*noise(x*2.11,y*2.11,seed+1)+.12*noise(x*4.23,y*4.23,seed+2);
  const pixel=(formula,dim=size)=>{
    const data=new Uint8Array(dim.width*dim.height*4);
    for(let y=0,o=0;y<dim.height;y++)for(let x=0;x<dim.width;x++,o+=4){
      const v=formula(x+.5,y+.5);
      if(v===undefined||v===null)continue;
      if(Array.isArray(v)){
        data[o]=v[0];data[o+1]=v[1];data[o+2]=v[2];data[o+3]=v[3]??255;
      }else{
        let q=rgbCache.get(v);if(!q){q=rgb(v);rgbCache.set(v,q);}
        data[o]=q[0];data[o+1]=q[1];data[o+2]=q[2];data[o+3]=255;
      }
    }
    return {...dim,channels:4,data};
  };
  const draw=commands=>drawing2d.render({...size,commands,edges:'hard'});
  const layer=(...rasters)=>raster.stack({...size,layers:rasters.map(source=>source?.source?source:{source})}).value;
  const circle=(x,y,r,fill,ry=r)=>({type:'ellipse',rect:[x-r,y-ry,2*r,2*ry],fill:hex(fill)});
  const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill:hex(fill)});
  const poly=(points,fill)=>({type:'polygon',points,fill:hex(fill)});
  const line=(points,color,width=1)=>({type:'path',points,color:hex(color),width});
  const ribbon=(points,width,fill)=>({type:'ribbon',points,width,fill:hex(fill)});
  const curve=(n,fn)=>Array.from({length:n+1},(_,i)=>fn(i/n,i));
  return {generator,fields,rasterSimulation,sampling,width,height,size,tau,
    clamp,mix,smooth,wrap,rgb,hex,band,hash,noise,texture,pixel,draw,layer,circle,rect,poly,line,ribbon,curve};
};
