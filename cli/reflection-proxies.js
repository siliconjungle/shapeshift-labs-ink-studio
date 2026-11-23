const { planarWeight }=require('../src/reflection-proxy.js');
const ColorSpace=require('../src/color-space.js');
const linear=ColorSpace.prepare('srgb','srgb-linear'), srgb=ColorSpace.prepare('srgb-linear','srgb');
const epsilon=1e-6, reportRows=new WeakMap();

function create(planar, probes, sky, background, stats) {
  if(stats&&!reportRows.has(stats))reportRows.set(stats,new Map());
  const rows=stats&&reportRows.get(stats);
  function record(kind,id,plane,probeId,weight,planeMix,probeMix,environment) {
    if(!rows)return;
    const key=JSON.stringify([kind,id,plane,probeId]);
    if(!rows.has(key)){
      const report=stats.reflectionSources??={receivers:[]};
      const row={kind,id,plane,...(probeId&&{probe:probeId}),planar:0,probeSamples:0,environment:0,blended:0,planarMisses:0};
      rows.set(key,row);
      report.receivers.push(row);
    }
    const row=rows.get(key);
    const sources=Number(planeMix>epsilon)+Number(probeMix>epsilon)+Number(environment>epsilon);
    if(planeMix>epsilon)row.planar++;
    if(probeMix>epsilon)row.probeSamples++;
    if(environment>epsilon)row.environment++;
    if(sources>1)row.blended++;
    if(weight>epsilon&&planeMix<=epsilon)row.planarMisses++;
  }
  function environmentFor(layer, direction, point) {
    if(sky)return sky(direction,[0,0,0],point);
    if(!Array.isArray(layer.sky))return background;
    const y=direction[1], t=Math.min(1,Math.abs(y)/.8), weight=t*t*(3-2*t);
    const pole=y<0?layer.ground:layer.sky;
    return layer.horizon.map((value,c)=>value+(pole[c]-value)*weight);
  }
  return (layer,{x,y,shift,detail,depth,point,direction,kind,id})=>{
    const {proxy}=layer,weight=planarWeight(proxy,depth), available=planar?.has(layer.plane);
    const image=available&&weight>epsilon ? planar(layer,x,y,...shift,undefined,detail) : null;
    const planeMix=weight*(image?.coverage??0), secondary=available ? 1-weight : 1;
    let cube;
    if(secondary>epsilon&&proxy.probe){
      const r=proxy.roughness;
      cube=probes?.(proxy.probe,point,direction,[r,r],undefined,undefined,proxy.probeSize);
    }
    const probeMix=secondary*(cube?.coverage??0), envMix=Math.max(0,1-planeMix-probeMix);
    record(kind,id,layer.plane,proxy.probe,weight,planeMix,probeMix,envMix);
    if(planeMix>=1-epsilon)return image;
    const env=envMix>epsilon?environmentFor(layer,direction,point):null;
    const color=[0,0,0];
    for(const [source,mix] of [[image?.rgb,planeMix],[cube?.rgb,probeMix],[env,envMix]]){
      if(!source||mix<=epsilon)continue;
      const energy=linear(source);
      for(let c=0;c<3;c++)color[c]+=energy[c]*mix;
    }
    return {rgb:srgb(color),coverage:1,
      ...(image?.address&&{address:{...image.address,amount:image.address.amount*weight}}),
      ...(image?.matte&&{matte:Float64Array.from(image.matte,n=>n*weight)})};
  };
}

module.exports={create};
