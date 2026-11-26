const OpenTransport = require('./physical-openpbr-transport.js');
const { layer } = require('./physical-openpbr-optics.js');
const { openPbrBrdf } = require('./physical-openpbr-brdf.js');
const { surface,coordinates } = require('./physical-reference-geometry.js');
const { dot,along,clamp,sub,mul,scale,length,unit,luma,max,tau,distribution,frame,direction,mis,random } =
  require('./physical-reference-math.js');

const offset = (point,n,d)=>along(point,n,(dot(n,d)<0?-1:1)*2e-6*Math.max(1,length(point)*.01));

function brdf(hit,view) {
  const { n,ng,m:{color,roughness,metalness} }=hit;
  const a=Math.max(.002,roughness*roughness), a2=a*a, nv=Math.max(.00001,dot(n,view));
  const f0=color.map(n=>.04*(1-metalness)+n*metalness);
  const diffuse=luma(color)*(1-metalness), specular=luma(f0)+(1-luma(f0))*(1-nv)**5;
  const choose=diffuse>1e-7?clamp(specular/(diffuse+specular),.12,.93):1;
  const basis=frame(n);
  function evaluate(out) {
    const nl=dot(n,out);
    if(nl<=0||dot(ng,out)<=0) return null;
    const h=unit(along(view,out,1)), nh=Math.max(0,dot(n,h)), vh=Math.max(0,dot(view,h));
    if(!nh||!vh) return null;
    const d=a2/(Math.PI*(nh*nh*(a2-1)+1)**2);
    const gv=Math.sqrt(a2+(1-a2)*nv*nv), gl=Math.sqrt(a2+(1-a2)*nl*nl);
    const g=d/(2*(nl*gv+nv*gl));
    const f=f0.map(value=>value+(1-value)*(1-vh)**5);
    return {pdf:(1-choose)*nl/Math.PI+choose*d*nh/(4*vh),
      weight:f.map((n,i)=>(g*n+(1-n)*(1-metalness)*color[i]/Math.PI)*nl)};
  }
  function sample(rng) {
    const specular=rng()<choose, u=rng(), angle=tau*rng();
    if(!specular) return direction(n,basis,Math.sqrt(1-u),angle);
    const h=direction(n,basis,Math.sqrt((1-u)/(1+(a2-1)*u)),angle), vh=dot(view,h);
    return vh>0?along(scale(view,-1),h,2*vh):null;
  }
  return { evaluate,sample };
}

function emitters(triangles) {
  const lit=triangles.filter(t=>t.material.weight>0);
  const selection=distribution(lit.map(t=>t.area*t.material.weight));
  const index=new Map(lit.map((t,i)=>[t,i]));
  function cosine(t,from) {
    const angle=dot(t.ng,from);
    return t.material.twoSidedEmission?Math.abs(angle):Math.max(0,angle);
  }
  function pdf(t,point,from) {
    const i=index.get(t);
    if(i===undefined) return 0;
    const delta=sub(from,point), distance=length(delta);
    const angle=distance?cosine(t,scale(delta,1/distance)):0;
    return angle?selection.pdf(i)*distance*distance/(t.area*angle):0;
  }
  function sample(point,rng) {
    if(!lit.length) return null;
    const i=selection.pick(rng()), t=lit[i], radius=Math.sqrt(rng());
    const u=radius*(1-rng()), v=radius-u;
    const on=along(along(t.a,t.e1,u),t.e2,v), delta=sub(on,point), distance=length(delta);
    if(distance<=1e-8) return null;
    const dir=scale(delta,1/distance), angle=cosine(t,scale(dir,-1));
    if(angle<=1e-8) return null;
    const uv=coordinates(t,u,v);
    if(!t.material.visible(uv,rng)) return null;
    return { dir,distance,radiance:t.material.emitted(uv,angle), pdf:selection.pdf(i)*distance*distance/(t.area*angle) };
  }
  return {sample,pdf,count:lit.length};
}

function glassBounce(hit,d,media,rng) {
  const { m:{glass},front,t,ng }=hit;
  const outside=[...media.entries()].filter(([id])=>id!==t.object).at(-1)?.[1].ior??1;
  const entered=[...media.values()].at(-1)?.ior??(front?outside:glass.ior);
  const eta=entered/(front?glass.ior:outside), co=clamp(-dot(ng,d));
  const sin2=eta*eta*(1-co*co), transmitted=Math.sqrt(Math.max(0,1-sin2));
  const a=(eta*co-transmitted)/(eta*co+transmitted||1), b=(co-eta*transmitted)/(co+eta*transmitted||1);
  if(sin2>=1||rng()<(a*a+b*b)*.5) return {dir:along(d,ng,2*co),gain:1};
  if(front) media.set(t.object,glass);
  else media.delete(t.object);
  return {dir:unit(along(scale(d,eta),ng,eta*co-transmitted)),gain:eta*eta};
}

function makeTracer(scene) {
  const {geometry,sky,options:{bounces},lights,metersPerUnit}=scene;
  const area=emitters(scene.triangles);
  const stats={cameraRays:0,shadowRays:0,continuationRays:0,transmittedEvents:0,emissiveTriangles:area.count,
    volumeScatters:0,subsurfaceScatters:0,dispersionPaths:0,thinSpecularEvents:0,thinDiffuseEvents:0};
  const trace=geometry.intersect;
  function visible(point,normal,dir,distance,rng) {
    const from=offset(point,normal ?? dir,dir);
    stats.shadowRays++;
    return !trace(from,dir,0,distance-4*length(sub(from,point)),true,rng);
  }

  function direct(point, normal, medium, evaluate, rng, bounce, add) {
    const weight = (sample, fit, misWeight) => {
      if(!fit || !visible(point,normal,sample.dir,sample.distance??Infinity,rng)) return;
      const radiance=medium ? mul(sample.radiance,OpenTransport.attenuation(medium.extinction,sample.distance??Infinity)) :
        sample.radiance;
      add(mul(fit.weight,radiance),misWeight/sample.pdf);
    };
    const light=sample=>{
      if(!sample||!sample.pdf||!max(sample.radiance)) return;
      const fit=evaluate(sample.dir);
      if(fit) weight(sample,fit,bounce<bounces?mis(sample.pdf,fit.pdf):1);
    };
    light(area.sample(point,rng));
    light(sky.sample(rng));
    for(const row of lights) {
      const delta=sub(row.position,point), distance=length(delta);
      if(distance<=1e-6) continue;
      const dir=scale(delta,1/distance);
      weight({dir,distance,radiance:row.intensity,pdf:distance*distance},evaluate(dir),1);
    }
  }

  function path(ray,rng,dispersionSample=null) {
    stats.cameraRays++;
    let {origin,direction:d}=ray, gain=[1,1,1], last=null, channel=null;
    const result=[0,0,0], media=new Map();
    function add(value,weight=1) {
      for(let c=0;c<3;c++) result[c]+=value[c]*gain[c]*weight;
    }
    for(let bounce=0;bounce<=bounces;bounce++) {
      const intersection=trace(origin,d,0,Infinity,false,rng);
      let owner, interior;
      for(const [id,medium] of media) { owner=id; interior=medium; }
      const volume=interior?.kind ? interior : null;
      const flight=volume && OpenTransport.freeFlight(volume,intersection?.distance??Infinity,channel,rng);
      if(flight) gain=mul(gain,flight.weight);
      else if(interior && intersection)
        for(let c=0;c<3;c++) gain[c]*=Math.exp(-interior.absorption[c]*intersection.distance);
      if(max(gain)<=0) break;

      let next, point, normal;
      if(flight?.scatter) {
        point=along(origin,d,flight.distance);
        stats[volume.kind==='subsurface'?'subsurfaceScatters':'volumeScatters']++;
        const scatter=OpenTransport.phase(d,volume);
        direct(point,null,volume,scatter.evaluate,rng,bounce,add);
        if(bounce===bounces) break;
        next=scatter.sample(rng);
        last={point,pdf:scatter.evaluate(next).pdf};
      } else {
        if(!intersection) {
          if(bounce||sky.background) add(sky.eval(d),last?mis(last.pdf,sky.pdf(d)):1);
          break;
        }
        const hit=surface(intersection,origin,d), {m,t}=hit, view=scale(d,-1);
        point=hit.point; normal=hit.ng;
        if(hit.front||t.material.twoSidedEmission) {
          const emission=m.openPbr?t.material.emitted(hit.uv,Math.abs(dot(hit.ng,d))):m.emission;
          if(max(emission)>0) add(emission,last?mis(last.pdf,area.pdf(t,point,last.point)):1);
        }

        if(volume && owner===t.object && !hit.front) {
          if(bounce===bounces) break;
          const outside=[...media.values()].at(-2)?.ior??1;
          const exit=OpenTransport.leave(hit,view,volume,outside,channel,rng);
          if(!exit) break;
          if(exit.exit) { media.delete(owner); stats.transmittedEvents++; }
          next=exit.dir; gain=mul(gain,exit.weight); last=null;
        } else if(m.glass) {
          if(bounce===bounces) break;
          const event=glassBounce(hit,d,media,rng);
          next=event.dir; gain=scale(gain,event.gain);
          if(dot(next,hit.ng)<0) stats.transmittedEvents++;
          last=null;
        } else {
          const ambient=interior?.ior??1, optics=m.openPbr?layer(m.openPbr,ambient):null;
          const bsdf=optics?openPbrBrdf(hit,view,ambient,optics):brdf(hit,view);
          const transport=optics?OpenTransport.transmission(hit,view,ambient,optics):null;
          const surfaceChance=1-(transport?.probability??0);
          const evaluate=surfaceChance<1 ? out=>{
            const fit=bsdf.evaluate(out);
            return fit && {weight:fit.weight,pdf:fit.pdf*surfaceChance};
          } : bsdf.evaluate;
          direct(point,normal,volume,evaluate,rng,bounce,add);
          if(bounce===bounces) break;
          if(transport && (surfaceChance===0 || rng()<transport.probability)) {
            const event=transport.sample(rng,channel,metersPerUnit,dispersionSample);
            if(!event) break;
            next=event.dir; gain=mul(gain,event.weight); last=null;
            if(event.medium) {
              channel=event.channel;
              media.set(t.object,event.medium);
              if(event.disperses) stats.dispersionPaths++;
            } else stats.thinSpecularEvents++;
            stats.transmittedEvents++;
          } else {
            next=bsdf.sample(rng);
            const fit=next&&evaluate(next);
            if(!fit||!fit.pdf) break;
            if(dot(next,normal)<0) stats.thinDiffuseEvents++;
            gain=mul(gain,scale(fit.weight,1/fit.pdf));
            last={point,pdf:fit.pdf};
          }
        }
      }
      if(max(gain)<=0) break;
      if(bounce>=3) {
        const survive=clamp(max(gain),.08,.97);
        if(rng()>=survive) break;
        gain=scale(gain,1/survive);
      }
      origin=offset(point,normal??next,next); d=next;
      stats.continuationRays++;
    }
    return result;
  }
  return {path,stats};
}

function auxiliaries(scene) {
  const {width,height}=scene.options, count=width*height;
  const material=new Uint16Array(count), normal=new Float32Array(count*3), albedo=new Float32Array(count*3);
  const depth=new Float32Array(count).fill(Infinity);
  for(let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
    const ray=scene.lens.ray(x+.5,height-y-.5);
    const raw=scene.geometry.intersect(ray.origin,ray.direction);
    if(!raw) continue;
    const hit=surface(raw,ray.origin,ray.direction);
    material[p]=hit.t.material.id;
    depth[p]=hit.distance*ray.axial;
    normal.set(hit.n,p*3);
    albedo.set(hit.m.color,p*3);
  }
  return {material,normal,albedo,depth};
}

function accumulate(scene,tracer,state,count) {
  const {width,height,seed}=scene.options, {sums,samples}=state;
  for(let p=0;p<width*height;p++) {
    const x=p%width, y=Math.floor(p/width), at=p*4;
    for(let i=samples;i<samples+count;i++) {
      const rng=random(seed,p,i);
      const dispersionSample=(i+(Math.imul(p+1,1013904223)>>>0))%3;
      const value=tracer.path(scene.lens.ray(x+rng(),height-y-rng()),rng,dispersionSample);
      for(let c=0;c<3;c++) sums[at+c]+=value[c];
      sums[at+3]+=luma(value)**2;
    }
  }
  state.samples+=count;
}
module.exports = { makeTracer,auxiliaries,accumulate };
