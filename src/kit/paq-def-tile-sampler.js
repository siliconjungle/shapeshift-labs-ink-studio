/* Independent typed map drivers for the periodic tile compositor. */
const TypedTileSampler = ({tileGenerator,fields,requireImage,integerMax,convertColor,sampler,hash,hash01}) => {
  const mapNames=['selection','position','rotation','scale','color','density','visibility','priority'];
  const streams=['selection','position','rotation','scale','color','density'];
  const stampDefaults=Object.freeze([tileGenerator.stamp]);
  const within=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const pair=(value,test)=>Array.isArray(value)&&value.length===2&&Array.from(value).every(test);
  const unit=n=>Math.max(0,Math.min(1,n));
  const neutralPosition=[0,0], neutralScale=[1,1];

  function mapReader(name,source,filter) {
    const {raster,descriptor}=requireImage(source), {width,height,channels,data}=raster;
    const {intent,units,precision,tiling,sampling}=descriptor, colored=name==='color'&&intent==='color';
    const counts=name==='position'?[2]:name==='scale'?[1,2]:[1];
    if (!colored&&(!['data','mask'].includes(intent)||units!=='unitless'||!counts.includes(channels))) {
      const expected=name==='color'?'typed color or a unitless scalar image':'unitless '+counts.join(' or ')+' channel samples';
      throw new TypeError('Tile '+name+' map needs '+expected);
    }
    const axes=[tiling.u,tiling.v].map(TextureAddress.axis), values=new Float64Array(colored?4:channels);
    const scale=integerMax(precision)||1;
    const rgb=[0,0,0], read=colored&&convertColor(descriptor,'srgb-linear');
    const accumulate=colored ? (i,out,weight)=>{
      const a=read(data,i,rgb)*weight;
      if (!a) return;
      for(let c=0;c<3;c++) out[c]+=unit(rgb[c])*a;
      out[3]+=a;
    } : (i,out,weight)=>{
      for(let c=0;c<channels;c++) out[c]+=unit(data[i+c]/scale)*weight;
    };
    const sample=sampler({width,height,accumulate},channels,filter==='image'?sampling:filter,...axes);
    return (u,v)=>{
      values.fill(0); sample(u,v,1,values);
      if(colored) {
        const a=values[3];
        if(a) for(let c=0;c<3;c++) values[c]/=a;
      }
      for(let c=0;c<values.length;c++) values[c]=unit(values[c]);
      return values;
    };
  }

  function drivers(maps,controls) {
    if(!fields(maps,mapNames)||!fields(controls,['positionAmount','scaleRange','rotationAmount','density',
      'visibilityThreshold','mapFilter','seeds'])) throw new TypeError('Unknown Tile Sampler map or control');
    const {positionAmount=[1,1],scaleRange=[.25,1.75],rotationAmount=180,density=1,
      visibilityThreshold=.5,mapFilter='image',seeds}=controls;
    if(!pair(positionAmount,n=>within(n,0,4))||!pair(scaleRange,n=>within(n,.025,4))||scaleRange[0]>scaleRange[1]||
      !within(rotationAmount,0,360)||!within(density,0,1)||!within(visibilityThreshold,0,1)||
      !['image','nearest','linear'].includes(mapFilter)||seeds!==undefined&&
      (!fields(seeds,streams)||!Object.values(seeds).every(Number.isSafeInteger)))
      throw new RangeError('Invalid Tile Sampler map range, filter, density, visibility or seed stream');
    const reader=Object.fromEntries(Object.entries(maps).filter(([,source])=>source!==null)
      .map(([name,source])=>[name,mapReader(name,source,mapFilter)]));
    const [lo,hi]=scaleRange;
    return (root,periodic,count)=>{
      const keys=Object.fromEntries(streams.map(name=>[name,seeds?.[name]??root]));
      const salts=Object.fromEntries(streams.map(name=>[name,hash('tile generator/'+keys[name])]));
      const normalize=(n,i)=>periodic[i]?n-Math.floor(n):n;
      return {seeds:keys,salts,prioritize:!!reader.priority,at(id,anchor){
        const u=normalize(anchor[0],0),v=normalize(anchor[1],1);
        if(reader.visibility&&reader.visibility(u,v)[0]<visibilityThreshold) return {skip:'visibility'};
        const probability=density*(reader.density?.(u,v)[0]??1);
        if(hash01('density/'+id,salts.density)>=probability) return {skip:'density'};
        const selection=reader.selection?.(u,v)[0]??hash01('selection/'+id,salts.selection);
        const stampId=Math.min(count,1+Math.floor(unit(selection)*count));
        const rg=reader.position?.(u,v), size=reader.scale?.(u,v), tint=reader.color?.(u,v);
        const rotation=reader.rotation ? (2*unit(reader.rotation(u,v)[0])-1)*rotationAmount : 0;
        const priority=reader.priority?.(u,v)[0]??0;
        const color=tint?.length===1 ? [tint[0],tint[0],tint[0],1] : tint;
        return {stampId,priority,rotation,position:rg?[(2*unit(rg[0])-1)*positionAmount[0],(2*unit(rg[1])-1)*positionAmount[1]]:neutralPosition,
          scale:size?[lo+(hi-lo)*unit(size[0]),lo+(hi-lo)*unit(size[1]??size[0])]:neutralScale,
          color};
      }};
    };
  }

  function sample(width,height,columns=4,rows=6,stamps=stampDefaults,maps={},options={},controls={},seed=0) {
    return tileGenerator.render(width,height,columns,rows,stamps,options,seed,drivers(maps,controls));
  }
  return Object.freeze({sample,stampDefaults,mapNames:Object.freeze(mapNames)});
};
