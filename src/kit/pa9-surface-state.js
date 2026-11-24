/* Layered surface values in persistent chart coordinates. */
(function (K) {
  const P=K.procedural, {clone,freeze}=P.data;
  const own=(row,key)=>Object.hasOwn(row,key), finite=Number.isFinite, clamp=K.clamp;
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const unit=value=>finite(value)&&value>=0&&value<=1;
  const uv=value=>Array.isArray(value)&&value.length===2&&value.every(unit);
  const xyz=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(finite);
  const name=value=>typeof value==='string'&&value.length>0&&value.length<=200&&
    !['__proto__','constructor','prototype'].includes(value);
  const full=freeze({min:[0,0],max:[1,1]});
  const defaults=freeze({
    paint:{type:'color'}, heat:{type:'number',default:20,min:-273.15,max:1e4,units:'degC'},
    grime:{type:'number',default:0,min:0,max:1}, scar:{type:'number',default:0,min:0,max:1},
    wear:{type:'number',default:0,min:0,max:1}, wetness:{type:'number',default:0,min:0,max:1}
  });
  function check(condition,message) {if(!condition)throw Error(message);}
  const scalar=(schema,value)=>finite(value)&&value>=schema.min&&value<=schema.max;
  const color=value=>ColorCurves.color(value);
  const inside=(p,box)=>p.every((v,i)=>v>=box.min[i]&&v<=box.max[i]);
  const window=box=>keys(box,['min','max'])&&uv(box.min)&&uv(box.max)&&box.max.every((v,i)=>v>box.min[i]);
  const into=(point,box=full)=>point.map((v,i)=>box.min[i]+v*(box.max[i]-box.min[i]));

  function channels(extra={}) {
    check(record(extra)&&Object.keys(extra).length<=16,'Expected a bounded surface channel table');
    const definitions={...defaults};
    for(const [key,spec] of Object.entries(extra)){
      check(name(key)&&(!own(defaults,key)||key==='wetness')&&keys(spec,['type','default','min','max','units'])&&
        ['number','color'].includes(spec.type),'Invalid surface channel '+key);
      if(spec.type==='number'){
        check(finite(spec.min)&&finite(spec.max)&&spec.min<=spec.max&&scalar(spec,spec.default)&&
          (spec.units===undefined||typeof spec.units==='string'&&spec.units.length<=64),'Invalid scalar surface channel '+key);
      }else check(keys(spec,['type']),'A color surface channel starts transparent');
      definitions[key]=clone(spec);
    }
    return freeze(definitions);
  }
  const finish = freeze({
    pigment:{type:'indexed',default:null},
    roughness:{type:'number',min:0,max:1,default:null,material:true},
    emission:{type:'emission',default:null},
    normal:{type:'normal',default:null},
    opacity:{type:'number',min:0,max:1,default:null,material:true}
  });
  const inkNames=['shadow-band','hatch','outline','light-spill'];
  const inkChannels=freeze(Object.fromEntries(inkNames.map((id,i)=>[id,
    {type:'number',min:i?0:-1,max:1,default:i?1:0}])));
  // Store deviations from the neutral settings so zero-filled carrier rows stay neutral.
  const inkAt=values=>inkNames.map((id,i)=>i?1-values[id]:values[id]);
  const maskId = value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,47}$/.test(value)&&name(value);
  function materialChannels(spec) {
    const masks = spec?.masks ?? [];
    check(Array.isArray(masks)&&masks.length<=16&&Array.from(masks).every(maskId)&&new Set(masks).size===masks.length,
      'Rest surface masks need up to 16 unique lowercase IDs');
    return freeze({ ...defaults,...finish,...inkChannels,...Object.fromEntries(masks.map(id=>['mask:'+id,
      {type:'number',min:0,max:1,default:0}])) });
  }
  function valueOf(schema,value,add=false) {
    if(schema.type==='color')return color(value);
    if(schema.type==='indexed'){
      check(keys(value,['swatch','color'])&&typeof value.swatch==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value.swatch)&&
        typeof value.color==='string'&&/^#[a-f0-9]{6}$/i.test(value.color),'Indexed pigment needs a swatch ID and exact #rrggbb color');
      return {swatch:value.swatch,color:value.color.toLowerCase()};
    }
    if(schema.type==='normal'||schema.type==='emission'){
      const vector=Array.isArray(value)&&value.length===3&&Array.from(value).every(finite);
      if(schema.type==='emission'){
        check(vector&&value.every(v=>v>=0&&v<=64),'Surface emission needs linear RGB values from 0 to 64');
        return value.slice();
      }
      check(vector&&value.every(v=>Math.abs(v)<=1)&&value[2]>=0&&Math.hypot(...value)>1e-8,
        'Surface normal needs a nonzero tangent-space XYZ vector in [-1, 1] with nonnegative Z');
      return K.V.norm(value);
    }
    check(add?finite(value)&&Math.abs(value)<=1e9:scalar(schema,value),'Invalid scalar surface stamp value');
    return value;
  }
  function mask(brush,size) {
    check(record(brush),'A surface stamp needs a brush');
    if(brush.kind==='stroke') {
      check(keys(brush,['kind','points','width','softness']),'Invalid surface stroke');
      const compiled=P.surfaceMasks.compile([{points:brush.points,width:brush.width,softness:brush.softness??0}],{size});
      return ([u,v])=>compiled.weight(u,v);
    }
    const box={min:brush.min,max:brush.max};
    check(window(box), 'A surface brush needs ordered unit UV bounds');
    if(brush.kind==='rect') {
      check(keys(brush,['kind','min','max']),'Invalid surface rectangle');
      return p=>Number(inside(p,box));
    }
    const rows=brush.rows;
    check(brush.kind==='bitmap'&&keys(brush,['kind','min','max','rows'])&&Array.isArray(rows)&&rows.length>=1&&rows.length<=128&&
      rows.every(row=>typeof row==='string'&&row.length===rows[0].length&&/^[.#]{1,256}$/.test(row)),
    'A surface bitmap needs equal-width rows of . and #');
    return p=>{
      if(!inside(p,box))return 0;
      const [x,y]=p.map((v,i)=>(v-box.min[i])/(box.max[i]-box.min[i]));
      const row=rows[Math.min(rows.length-1,Math.floor((1-y)*rows.length))];
      return Number(row[Math.min(row.length-1,Math.floor(x*row.length))]==='#');
    };
  }
  function retainedBrush(brush,chart) {
    const {V}=K;
    check(keys(brush,['kind','tip','space','at','pixelSize','direction']) &&
      ['uv','rest'].includes(brush.space) && Array.isArray(brush.pixelSize) && brush.pixelSize.length===2 &&
      Array.from(brush.pixelSize).every(n=>finite(n)&&n>=1e-8&&n<=(brush.space==='uv'?1:1000)),
      'A retained brush needs a tip, coordinate space and positive XY pixel sizes');
    const {space,at,pixelSize,direction}=brush;
    let offset;
    if (space==='uv') {
      check(uv(at)&&direction===undefined,'A UV brush needs a unit UV anchor. Use its tip angle to turn it.');
      offset=([u,v])=>[u-at[0],at[1]-v];
    } else {
      check(chart&&xyz(at)&&(direction===undefined||xyz(direction)),'A rest brush needs a chart and a finite XYZ anchor and tangent');
      const {origin,u,v,depth=.035}=chart, n=V.norm(V.cross(u,v));
      const delta=V.sub(at,origin), tangent=direction??u;
      const planar=V.mad(tangent,n,-V.dot(tangent,n));
      const chartU=V.dot(V.cross(delta,v),n)/V.len(V.cross(u,v));
      const chartV=V.dot(V.cross(u,delta),n)/V.len(V.cross(u,v));
      const tangentLength=V.len(planar);
      check(Math.abs(V.dot(delta,n))<=depth && [chartU,chartV].every(n=>n>=-1e-8&&n<=1+1e-8) &&
        finite(tangentLength)&&tangentLength>1e-8,
        'A rest brush anchor must lie on the chart and its direction must have a tangent component');
      const right=V.norm(planar), up=V.cross(n,right);
      const x=[V.dot(u,right),V.dot(v,right),V.dot(delta,right)];
      const y=[V.dot(u,up),V.dot(v,up),V.dot(delta,up)];
      offset=([u,v])=>[x[0]*u+x[1]*v-x[2],y[2]-y[0]*u-y[1]*v];
    }
    const tip=PixelBrushes.retained(brush.tip);
    return {...tip,read(p) {
      const [x,y]=offset(p);
      return tip.slotAt(x/pixelSize[0],y/pixelSize[1]);
    }};
  }
  function stamp(spec,size,definitions,chart) {
    check(keys(spec,['channel','value','mode','strength','brush','window'])&&own(definitions,spec.channel),
      'Unknown surface channel or stamp arguments');
    const {channel,mode='set',strength=1,window:chartWindow=full}=spec, type=definitions[channel].type;
    check(window(chartWindow)&&unit(strength)&&['set','add','clear'].includes(mode)&&
      (mode!=='add'||type==='number'&&!definitions[channel].material),'Invalid surface stamp mode, strength or window');
    const schema=definitions[channel];
    if (spec.brush?.kind==='retained') {
      const tip=retainedBrush(spec.brush,chart);
      const fromTip=mode!=='clear'&&spec.value===undefined&&(type==='indexed'||type==='color');
      const value=mode==='clear'||fromTip?undefined:valueOf(schema,spec.value,mode==='add');
      const colors=fromTip&&Array.from(new Set(tip.slots)).reduce((table,slot)=>{
        if (slot>=0) {
          const {id:swatch,color}=tip.palette[slot];
          table.set(slot,valueOf(schema,type==='indexed'?{swatch,color}:color));
        }
        return table;
      },new Map());
      return {channel,mode,value,amount:p=>inside(p,chartWindow)&&tip.read(p)>=0?strength:0,
        ...(fromTip&&{sample:p=>colors.get(tip.read(p))})};
    }
    const value=mode==='clear'?undefined:valueOf(schema,spec.value,mode==='add');
    const span=chartWindow.max.map((v,i)=>v-chartWindow.min[i]);
    const weight=mask(spec.brush,size.map((v,i)=>v*span[i]));
    return {channel,mode,strength,value,amount:p=>inside(p,chartWindow)?
      weight(p.map((v,i)=>clamp((v-chartWindow.min[i])/span[i],0,1)))*strength:0};
  }
  function stampList(list,size,definitions,chart) {
    check(Array.isArray(size)&&size.length===2&&size.every(n=>finite(n)&&n>0&&n<=5e5)&&
      Array.isArray(list)&&list.length<=256,'A surface chart needs a bounded size and at most 256 stamps');
    const pointCount=list.reduce((sum,row)=>sum+(row?.brush?.points?.length??0),0);
    check(pointCount<=8192,'Surface chart exceeds its stroke point budget');
    const tipPixels=list.reduce((sum,row)=>{
      if (row?.brush?.kind!=='retained') return sum;
      const tip=row.brush.tip, size=tip?.settings?.size;
      return sum+Math.max(tip?.slots?.length??0,Array.isArray(size)?size[0]*size[1]:0);
    },0);
    check(tipPixels<=2**18,'Surface chart exceeds its retained brush pixel budget');
    return list.map(row=>stamp(row,size,definitions,chart));
  }
  function prepare(list=[],{size=[1,1],definitions=defaults,chart}={}) {
    const rows=stampList(list,size,definitions,chart);
    return Object.freeze({sample(point) {
      check(uv(point),'Surface sampling needs unit UV coordinates');
      const values=Object.fromEntries(Object.entries(definitions).map(([key,schema])=>[key,schema.type==='color'?null:schema.default]));
      for(const row of rows){
        const {channel,mode,amount}=row;
        const a=amount(point);
        if(!a)continue;
        const value=row.sample?row.sample(point):row.value;
        const schema=definitions[channel], before=values[channel];
        if(schema.type==='indexed'){
          if(a>=.5)values[channel]=mode==='clear'?null:{...value};
        }else if(schema.type!=='number'||schema.material){
          const colorChannel=schema.type==='color', key=colorChannel?'color':'value';
          const retained=(before?.coverage??0)*(1-a);
          if(mode==='clear') values[channel]=retained?{[key]:before[key],coverage:retained}:null;
          else {
            const coverage=a+retained;
            const previous=before?.[key], combine=(next,prior)=>(next*a+(prior??0)*retained)/coverage;
            values[channel]={[key]:Array.isArray(value)?value.map((v,i)=>combine(v,previous?.[i])):combine(value,previous),coverage};
          }
        }else if(mode==='add')values[channel]=clamp(before+value*a,schema.min,schema.max);
        else values[channel]=before*(1-a)+(mode==='clear'?schema.default:value)*a;
      }
      return values;
    }});
  }
  function correspondence(corners,weights) {
    check(Array.isArray(corners)&&corners.length===3&&Array.isArray(weights)&&weights.length===3&&weights.every(unit)&&
      Math.abs(weights.reduce((a,b)=>a+b,0)-1)<=1e-8,'Surface correspondence needs three barycentric weights');
    if(!corners.every(row=>record(row)&&name(row.chart)&&uv(row.uv))||!corners.every(row=>row.chart===corners[0].chart))return null;
    const total=weights.reduce((a,b)=>a+b,0);
    return {chart:corners[0].chart,uv:[0,1].map(i=>clamp(corners.reduce((a,row,j)=>a+row.uv[i]*weights[j]/total,0),0,1))};
  }
  const wetness=values=>finite(values.wetness)?clamp(values.wetness,0,1):0;
  const active=values=>values.paint||(values.heat??20)!==20||values.grime||values.scar||values.wear||wetness(values);
  const mix=(a,b,t)=>a+(b-a)*t;
  const linear=ColorSpace.prepare('srgb','srgb-linear'), display=ColorSpace.prepare('srgb-linear','srgb');
  function shade(rgb,values,light=1) {
    const {paint,heat=20,grime=0,scar=0,wear=0}=values, wet=wetness(values);
    const ink=(paint?.coverage??0)*(1-wear), tint=clamp((heat-20)/350,0,.45);
    return rgb.map((v,k)=>{
      const worn=mix(v,180,wear*.23);
      const marked=mix(worn,(paint?.color[k]??0)*255*light,ink);
      return mix(marked,[255,105,39][k],tint)*(1-.55*grime)*(1-.4*scar)*(1-wet*[.36,.28,.2][k]);
    });
  }
  function ramp(indices,palette,values) {
    if(!active(values))return indices;
    return indices.map((index,i)=>{
      const rgb=palette[index]??palette[1]??palette[0], light=.45+.55*i/Math.max(1,indices.length-1);
      return PixelLook.nearest(shade(rgb,values,light),palette,true);
    });
  }
  function colorFor(input,palette,fallback) {
    if(input===undefined)return palette[fallback];
    if(Number.isSafeInteger(input))return palette[input];
    return color(input).map(v=>v*255);
  }
  const materialValue=(layer,base)=>layer?mix(base,layer.value,layer.coverage):base;
  const materialVector=(layer,base)=>layer?base.map((n,i)=>mix(n,layer.value[i],layer.coverage)):base;

  function appearance(base,hit,palette,point) {
    const {values,chart,paintedNormal,inkControls}=hit, adjusted={...base,surfaceId:chart};
    if(inkControls?.some(Boolean))adjusted.inkControls=inkControls;
    const stains=active(values), pigment=values.pigment, wet=wetness(values), masks={};
    for(const [id,value] of Object.entries(values))if(id.startsWith('mask:'))masks[id.slice(5)]=value;
    const channels=pigment||values.roughness||values.emission||paintedNormal||values.opacity||Object.keys(masks).length;
    if(!stains&&!channels)return adjusted;
    const source=base.rf?.(...point)||base.r;
    const rgb=colorFor(base.albedo,palette,source.at(-1));
    if(stains){
      adjusted.r=ramp(source,palette,values);
      adjusted.rf=undefined;
      if(rgb)adjusted.albedo=shade(rgb,values).map(v=>v/255);
    }
    const exact=pigment&&color(pigment.color);
    if(exact){
      adjusted.albedo=exact;
      adjusted.indexedPigment=exact;
    }
    const modelAt=(p,n)=>typeof base.model==='function'?base.model(p,n):base.model;
    const model=channels&&modelAt(point,hit.normal);
    if(values.roughness)adjusted.paintedRoughness=materialValue(values.roughness,model?.roughness??.8);
    if(paintedNormal)adjusted.paintedNormal=paintedNormal;
    if(values.opacity){
      const opacity=materialValue(values.opacity,clamp(base.a??model?.opacity??1,0,1));
      adjusted.a=opacity<1?opacity:Math.max(1,base.a??3);
    }
    if(values.emission){
      const previous=model?.emission??(base.em&&rgb?linear(rgb.map(v=>v/255)):[0,0,0]);
      adjusted.paintedEmission=materialVector(values.emission,previous);
      adjusted.em=false;
    }
    if(channels||base.model||wet)adjusted.model=(p,n)=>{
      const original=modelAt(p,n);
      const modelRGB=original?.color&&display(original.color).map(v=>v*255);
      const rough=mix(original?.roughness??.8,.25,wet);
      return {...original,
        ...(exact?{color:linear(exact)}:stains&&modelRGB&&{color:linear(shade(modelRGB,values).map(v=>v/255))}),
        ...(values.roughness||wet?{roughness:materialValue(values.roughness,rough)}:{}),
        ...(adjusted.paintedEmission&&{emission:adjusted.paintedEmission}),
        ...(paintedNormal&&{normal:paintedNormal}),
        ...(values.opacity&&{opacity:materialValue(values.opacity,original?.opacity??clamp(base.a??1,0,1))}),
        ...(Object.keys(masks).length&&{masks:{...original?.masks,...masks}})};
    };
    return adjusted;
  }
  function bind(material,locate,palette) {
    return {...material,surfaceState:{locate,maskNames:locate.maskNames,hasOpacity:locate.hasOpacity,hasNormal:locate.hasNormal,
      hasInkControls:locate.hasInkControls,
      apply(base,hit,point) {return appearance(base,hit,palette,point);} }};
  }
  function restSampler(chart,definitions=materialChannels()) {
    const {V}=K;
    const {u,v,stamps}=chart;
    return prepare(stamps,{size:[Math.sqrt(V.dot(u,u)),Math.sqrt(V.dot(v,v))],definitions,chart});
  }
  function projection(spec,{coordinatesOnly=false}={}) {
    check(keys(spec,['charts','masks'])&&record(spec.charts)&&Object.keys(spec.charts).length>0&&Object.keys(spec.charts).length<=32,
      'Expected one to 32 named rest surface charts');
    const {V}=K, definitions=materialChannels(spec);
    const projectors=Object.entries(clone(spec.charts)).map(([chart,row])=>{
      check(name(chart)&&keys(row,['origin','u','v','depth','twoSided','stamps']),'Invalid rest surface chart '+chart);
      const {origin,u,v,depth=.035,twoSided=false,stamps=[]}=row;
      check([origin,u,v].every(xyz)&&finite(depth)&&depth>0&&depth<=1e4&&typeof twoSided==='boolean',
        'Surface chart needs a finite origin, UV axes and positive depth');
      const cross=V.cross(u,v), uu=V.dot(u,u), vv=V.dot(v,v), uv=V.dot(u,v), det=V.dot(cross,cross);
      check(det>1e-12&&det>uu*vv*1e-10,'Surface chart UV axes must span a plane');
      const n=V.norm(cross), sampler=coordinatesOnly ? null : restSampler({origin,u,v,depth,stamps},definitions);
      return {chart,sampler,u,v,point(point,normal) {
        const delta=V.sub(point,origin), distance=Math.abs(V.dot(delta,n)), facing=V.dot(n,normal);
        if(distance>depth||(twoSided?Math.abs(facing):facing)<.5)return null;
        const a=V.dot(delta,u), b=V.dot(delta,v);
        const p=[(vv*a-uv*b)/det,(uu*b-uv*a)/det];
        if(p.some(value=>value< -1e-6||value>1+1e-6))return null;
        return {distance,uv:p.map(value=>clamp(value,0,1))};
      }};
    });
    const locate=(point,normal)=>{
      let best, distance=Infinity;
      for(const row of projectors){
        const hit=row.point(point,normal);
        if(hit&&hit.distance<distance){best={row,uv:hit.uv};distance=hit.distance;}
      }
      if(!best)return null;
      const {row,uv}=best, values=row.sampler?.sample(uv);
      if(!values)return {chart:row.chart,uv};
      let paintedNormal;
      if(values.normal){
        const n=V.norm(normal), u=V.norm(V.mad(row.u,n,-V.dot(row.u,n)),V.perp(n));
        const across=V.cross(n,u), v=V.dot(across,row.v)<0 ? V.mul(across,-1) : across;
        const [x,y,z]=values.normal.value;
        const mapped=V.norm(V.mad(V.mad(V.mul(n,z),u,x),v,y),n);
        paintedNormal=V.norm(V.mad(n,V.sub(mapped,n),values.normal.coverage),n);
      }
      return {chart:row.chart,uv,values,normal,...(paintedNormal&&{paintedNormal}),
        ...(locate.hasInkControls&&{inkControls:inkAt(values)})};
    };
    return Object.assign(locate,{maskNames:spec.masks?.slice()??[],
      hasOpacity:Object.values(spec.charts).some(chart=>chart.stamps?.some(stamp=>stamp.channel==='opacity')),
      hasNormal:Object.values(spec.charts).some(chart=>chart.stamps?.some(stamp=>stamp.channel==='normal')),
      hasInkControls:Object.values(spec.charts).some(chart=>chart.stamps?.some(stamp=>inkNames.includes(stamp.channel)))});
  }
  P.surfaceState=Object.freeze({channels,materialChannels,valueOf,prepare,restSampler,correspondence,projection,bind,appearance,ramp,window,into,isUv:uv,full});
})(KIT);
