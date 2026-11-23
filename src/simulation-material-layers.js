/* Simulation values drive material channels through stable UV or rest-space masks. */
const SimulationMaterialLayers=(()=>{
  const Inputs=typeof LookInputs==='undefined'?require('./look-inputs.js'):LookInputs;
  const Color=typeof ColorSpace==='undefined'?require('./color-space.js'):ColorSpace;
  const linear=Color.prepare('srgb','srgb-linear'), display=Color.prepare('srgb-linear','srgb');
  const format='ink-studio/simulation-material-layers', maxLayers=8, compiled=Symbol.for(format);
  const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
  const range=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const clamp=n=>Math.max(0,Math.min(1,n));
  const mix=(a,b,t)=>a+(b-a)*t;
  const fields=(row,keys)=>row&&Object.getPrototypeOf(row)===Object.prototype&&Object.keys(row).every(k=>keys.includes(k));
  const vector=(v,n,test=Number.isFinite)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(test);
  const signs=[-1,1];
  function check(ok,message){
    if(!ok)throw new TypeError('Simulation material layers: '+message);
  }
  function snapshot(value){
    if(Array.isArray(value))return Object.freeze(value.map(snapshot));
    if(value&&Object.getPrototypeOf(value)===Object.prototype)
      return Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,snapshot(v)])));
    return value;
  }
  function pigment(value){
    if(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)){
      const c=parseInt(value.slice(1),16);
      return linear([c>>>16,c>>>8&255,c&255].map(n=>n/255));
    }
    check(vector(value,3,unit),'pigment needs #RRGGBB or normalized sRGB');
    return linear(value);
  }
  function mask(raw){
    if(raw===undefined)return {kind:0};
    check(raw?.space==='uv'||raw?.space==='rest','a mask needs UV or rest space');
    const {space,kind='box'}=raw;
    if(kind==='raster'){
      const {width,height,values}=raw;
      check(space==='uv'&&fields(raw,['space','kind','width','height','values'])&&
        [width,height].every(n=>Number.isSafeInteger(n)&&range(n,1,256))&&
        (Array.isArray(values)||values instanceof Uint8Array||values instanceof Uint8ClampedArray)&&values.length===width*height&&
        Array.from(values).every(n=>Number.isSafeInteger(n)&&range(n,0,255)),
        'a UV raster needs dimensions up to 256 and matching grayscale bytes');
      return {kind:3,width,height,values:Uint8Array.from(values)};
    }
    const n=space==='uv'?2:3, {min,max,feather=0}=raw;
    const component=space==='uv'?unit:v=>range(v,-1e6,1e6);
    check(kind==='box'&&fields(raw,['space','kind','min','max','feather'])&&vector(min,n,component)&&vector(max,n,component)&&
      min.every((v,k)=>v<max[k])&&range(feather,0,Math.min(...max.map((v,k)=>v-min[k]))*.5),
      'a box needs increasing bounds and an interior feather');
    return {kind:space==='uv'?1:2,min:[...min,...(n===2?[0]:[])],max:[...max,...(n===2?[0]:[])],feather};
  }

  function create(doc){
    if(doc?.[compiled])return doc;
    check(fields(doc,['format','version','layers'])&&doc.format===format&&doc.version===1&&Array.isArray(doc.layers)&&
      doc.layers.length>0&&doc.layers.length<=maxLayers,'expected a version 1 document with up to eight layers');
    const ids=new Set(), rasters=[];
    let rows=0;
    const layers=Array.from(doc.layers,row=>{
      check(fields(row,['id','amount','driver','mask','pigment','roughness','sheen','relief'])&&
        typeof row.id==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)&&!ids.has(row.id),
        'layers need distinct lowercase IDs and recognized channels');
      const {id,amount=row.driver===undefined?1:0,driver,roughness,sheen,relief=0}=row;
      check(unit(amount)&&(roughness===undefined||unit(roughness))&&(sheen===undefined||range(sheen,0,4))&&
        range(relief,-2,2)&&['pigment','roughness','sheen','relief'].some(k=>Object.hasOwn(row,k)),
        'a layer needs bounded pigment, roughness, sheen or signed relief');
      ids.add(id);
      if(driver!==undefined)Inputs.validateDriver(driver,amount);
      const {values,...site}=mask(row.mask);
      if(site.kind===3){
        site.y=rows;
        rows+=site.height;
        rasters.push({site,values});
      }
      return Object.freeze({id,amount,driver:snapshot(driver),mask:Object.freeze(site),
        pigment:row.pigment===undefined?undefined:Object.freeze(pigment(row.pigment)),roughness,sheen,relief});
    });
    const width=256,height=Math.max(1,rows),bitmap=new Uint8Array(width*height);
    for(const {site:{width:w,height:h,y},values} of rasters)
      for(let j=0;j<h;j++)bitmap.set(values.subarray(j*w,(j+1)*w),(y+j)*width);
    return Object.freeze({format,version:1,layers:Object.freeze(layers),bitmap,width,height,[compiled]:true});
  }

  function resolve(plan,session){
    check(plan?.[compiled],'use a compiled material layer plan');
    const amounts=plan.layers.map(row=>row.driver&&session?clamp(Inputs.sample(row.driver,row.amount,session)):row.amount);
    return {amounts,active:amounts.some(Boolean),relief:plan.layers.some((row,i)=>row.relief!==0&&amounts[i]>0)};
  }

  function frame(atlases,{time,query,session,report}){
    const result=new Map(), receipts=[];
    for(const atlas of atlases)for(const row of atlas?.semanticMipmaps??[]){
      const plan=row.simulation;
      if(!plan)continue;
      if(!result.has(plan))result.set(plan,resolve(plan,session??=Inputs.session(time,query)));
      if(report)receipts.push({mesh:atlas.sceneMeshId,material:row.materialId,
        layers:plan.layers.map(({id},i)=>({id,amount:result.get(plan).amounts[i]}))});
    }
    if(report)report(receipts);
    return result;
  }

  function weight(plan,mask,uv,rest){
    const {kind}=mask;
    if(!kind)return 1;
    if(kind===3){
      if(uv.some(v=>v<0||v>1))return 0;
      const {width,height}=mask, x=uv[0]*(width-1),y=uv[1]*(height-1), i=Math.floor(x),j=Math.floor(y);
      const a=mask.y+j,b=mask.y+Math.min(j+1,height-1),c=Math.min(i+1,width-1);
      const value=(p,q)=>plan.bitmap[p*plan.width+q];
      return mix(mix(value(a,i),value(a,c),x-i),mix(value(b,i),value(b,c),x-i),y-j)/255;
    }
    const p=kind===1?uv:rest;
    let distance=Infinity;
    for(let i=0;i<p.length;i++)distance=Math.min(distance,p[i]-mask.min[i],mask.max[i]-p[i]);
    if(distance<=0)return 0;
    if(!mask.feather)return 1;
    const t=clamp(distance/mask.feather);
    return t*t*(3-2*t);
  }

  function apply(plan,state,uv,rest,base){
    let color,roughness=base.roughness,sheen=base.sheen,height=0;
    for(const [i,row] of plan.layers.entries()){
      if(!state.amounts[i])continue;
      const w=state.amounts[i]*weight(plan,row.mask,uv,rest);
      if(!w)continue;
      if(row.pigment){
        color??=linear(base.color);
        for(let k=0;k<3;k++)color[k]=mix(color[k],row.pigment[k],w);
      }
      if(row.roughness!==undefined)roughness=mix(roughness,row.roughness,w);
      if(row.sheen!==undefined)sheen=mix(sheen,row.sheen,w);
      height+=row.relief*w;
    }
    return {color:color?display(color):base.color,roughness,sheen,height};
  }

  function slope(plan,state,uv,rest,uvStep,restStep){
    const heights=signs.map(sign=>{
      const a=uv.map((n,i)=>n+sign*uvStep[i]*.25), b=rest.map((n,i)=>n+sign*restStep[i]*.25);
      let h=0;
      for(const [i,row] of plan.layers.entries())if(row.relief&&state.amounts[i])
        h+=row.relief*state.amounts[i]*weight(plan,row.mask,a,b);
      return h;
    });
    return (heights[1]-heights[0])*2;
  }

  return Object.freeze({format,maxLayers,create,resolve,frame,apply,slope});
})();
if (typeof module !== 'undefined') module.exports = SimulationMaterialLayers;
