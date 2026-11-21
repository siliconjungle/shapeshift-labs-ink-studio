// Rasterize opaque, cutout atlas triangles into the existing scene compositor.
const SpriteSurface = require('../src/sprite-surface.js');
const uvSlip=Symbol.for('ink-studio.spriteSurface.uvSlip');
function rasterize(atlas,{V,W,H,focal,ortho,near,clip,paletteSampling,artScale=1}) {
  if(!atlas)return [];
  const fragments=new Array(W*H),eye=[0,1,2].map(k=>-(V[k*4]*V[12]+V[k*4+1]*V[13]+V[k*4+2]*V[14]));
  const transform=(v)=>({p:v.slice(0,3),uv:v.slice(3),x:V[0]*v[0]+V[4]*v[1]+V[8]*v[2]+V[12],
    y:V[1]*v[0]+V[5]*v[1]+V[9]*v[2]+V[13],z:-(V[2]*v[0]+V[6]*v[1]+V[10]*v[2]+V[14])});
  const interpolate=(a,b,t)=>({p:a.p.map((n,k)=>n+(b.p[k]-n)*t),uv:a.uv.map((n,k)=>n+(b.uv[k]-n)*t),
    x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:near});
  const project=v=>({ ...v,sx:W*.5+v.x*focal/(ortho?1:v.z),sy:H*.5+v.y*focal/(ortho?1:v.z) });
  const edge=(a,b,x,y)=>(b.sx-a.sx)*(y-a.sy)-(b.sy-a.sy)*(x-a.sx);
  for (const layer of Array.isArray(atlas) ? atlas : [atlas]) {
    if (!layer) continue;
    const {vertices,pixels,width,height}=layer;
    if(!(vertices instanceof Float32Array)||vertices.length%15||!Number.isSafeInteger(width)||width<1||
      !Number.isSafeInteger(height)||height<1||!(pixels instanceof Uint8Array)||pixels.length!==width*height*4||
      !vertices.every(Number.isFinite))throw new RangeError('Invalid sprite surface atlas');
    const plan=layer[uvSlip];
    const ranges=plan?.vertices===vertices&&plan.width===width&&plan.height===height ? plan.ranges : [];
    const filtered = paletteSampling === false ? null : SpriteSurface.samplingPlan(layer);
    let rangeIndex=0, filterIndex=0;
    for(let offset=0;offset<vertices.length;offset+=15){
      const first=offset/5;
      while(ranges[rangeIndex]?.end<=first)rangeIndex++;
      const range=ranges[rangeIndex];
      const shifted=range&&range.first<=first;
      while(filtered?.[filterIndex]?.end<=first)filterIndex++;
      const filter = filtered?.[filterIndex]?.filter;
      const input=[0,1,2].map(i=>transform(Array.from(vertices.subarray(offset+i*5,offset+i*5+5))));
      const polygon=[];
      for(let i=0;i<3;i++){
        const a=input[i],b=input[(i+1)%3];
        if(a.z>=near)polygon.push(a);
        if((a.z>=near)!==(b.z>=near))polygon.push(interpolate(a,b,(near-a.z)/(b.z-a.z)));
      }
      for(let tri=1;tri+1<polygon.length;tri++){
        const [a,b,c]=[polygon[0],polygon[tri],polygon[tri+1]].map(project),area=edge(a,b,c.sx,c.sy);
        if(Math.abs(area)<1e-10)continue;
        const loX=Math.max(0,Math.ceil(Math.min(a.sx,b.sx,c.sx)-.5)),hiX=Math.min(W-1,Math.floor(Math.max(a.sx,b.sx,c.sx)-.5));
        const loY=Math.max(0,Math.ceil(Math.min(a.sy,b.sy,c.sy)-.5)),hiY=Math.min(H-1,Math.floor(Math.max(a.sy,b.sy,c.sy)-.5));
        const u=b.p.map((n,k)=>n-a.p[k]),v=c.p.map((n,k)=>n-a.p[k]);
        const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...normal)||1;
        if(normal.reduce((sum,n,k)=>sum+n*(eye[k]-a.p[k]),0)<0)for(let k=0;k<3;k++)normal[k]=-normal[k];
        const row=[a,b,c], transform = shifted ? range.transform : [1,1,0,0];
        const bounds = shifted ? range.bounds : filter ? [filter.rect.x,filter.rect.y,
          filter.rect.x + filter.rect.width - 1,filter.rect.y + filter.rect.height - 1] : [0,0,width-1,height-1];
        let gradients;
        if (filter) {
          const weighted = (vx, vy, vz) => {
            const dw = [vx,vy,vz].map((n,k) => n * artScale / (area * (ortho ? 1 : row[k].z)));
            return [dw.reduce((n,v,k) => n + v * row[k].uv[0], 0),
              dw.reduce((n,v,k) => n + v * row[k].uv[1], 0), ortho ? 0 : dw[0] + dw[1] + dw[2]];
          };
          gradients = [weighted(b.sy-c.sy,c.sy-a.sy,a.sy-b.sy), weighted(c.sx-b.sx,a.sx-c.sx,b.sx-a.sx)];
        }
        for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
          const weights=[edge(b,c,x+.5,y+.5)/area,edge(c,a,x+.5,y+.5)/area,edge(a,b,x+.5,y+.5)/area];
          if(weights.some(n=>n < -1e-7))continue;
          const w=weights.map((n,k)=>ortho?n:n/row[k].z),sum=w[0]+w[1]+w[2];
          const z=ortho?weights.reduce((s,n,k)=>s+n*row[k].z,0):1/sum,p=y*W+x;
          if(fragments[p]&&z>=fragments[p].z)continue;
          const sample=k=>row.reduce((s,n,i)=>s+n.uv[k]*w[i]/sum,0);
          const s=sample(0),t=sample(1);
          const S = s * transform[0] + transform[2], T = t * transform[1] + transform[3];
          let ink;
          if (filter) {
            const [[dxU, dxV, dxZ], [dyU, dyV, dyZ]] = gradients;
            ink = filter.sample(S, T, transform[0] * (dxU - s * dxZ) / sum, transform[1] * (dxV - t * dxZ) / sum,
              transform[0] * (dyU - s * dyZ) / sum, transform[1] * (dyV - t * dyZ) / sum);
            if (ink === null) continue;
          }
          if (ink === undefined) {
            const tx = Math.max(bounds[0], Math.min(bounds[2], Math.floor(S)));
            const ty = Math.max(bounds[1], Math.min(bounds[3], Math.floor(T)));
            const texel = (ty * width + tx) * 4;
            if (pixels[texel+3] < 128) continue;
            ink = (pixels[texel] << 16) | (pixels[texel + 1] << 8) | pixels[texel + 2];
          }
          const position=[0,1,2].map(k=>row.reduce((s,n,i)=>s+n.p[k]*w[i]/sum,0));
          if(clip&&!clip(position))continue;
          fragments[p]={p,z,alpha:1,color:[ink >>> 16, (ink >>> 8) & 255, ink & 255].map(n=>n/255),position,
            normal:normal.map(n=>n/len),objectPosition:position,surface:true};
        }
      }
    }
  }
  return fragments.filter(Boolean);
}
module.exports={rasterize};
