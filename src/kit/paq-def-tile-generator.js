/* Periodic material grids with deterministic placements, signed stamps and aligned labels. */
const TypedTileGenerator = ({ shapes,descriptor,wrap,pack,storage,dimensions,fields,freeze,hash,hash01 }) => {
  const stamp=shapes.define({type:'rectangle',size:[1,1]});
  const patterns=Object.freeze(['grid','brick','column-stagger','checker']);
  const finite=Number.isFinite, safe=Number.isSafeInteger;
  const within=(n,lo,hi)=>finite(n)&&n>=lo&&n<=hi;
  const pair=(values,test)=>Array.isArray(values)&&values.length===2&&Array.from(values).every(test);
  const mod=(n,p)=>((n%p)+p)%p;
  const clamp=n=>Math.max(0,Math.min(1,n));
  const phaseUnits=2**40;
  const toLinear=ColorSpace.prepare('srgb','srgb-linear');
  const toDisplay=ColorSpace.prepare('srgb-linear',{space:'srgb',outOfRange:'clamp'});

  function color(value) {
    if (Array.isArray(value)&&value.length===4&&Array.from(value).every(n=>within(n,0,1))) return value.slice();
    return [...ColorCurves.color(value),1];
  }

  function settings(columns,rows,options,seed) {
    if (![columns,rows].every(n=>safe(n)&&within(n,1,128))||columns*rows>4096)
      throw new RangeError('Tile grid needs 1–128 counts and at most 4096 cells');
    if (!fields(options,['pattern','size','gutter','rotation','rowOffset','columnOffset','wrap','crop','aspect',
      'color','palette','colorMode','background','jitter','samples','precision','seed']))
      throw new TypeError('Unknown Tile Generator option');
    const {pattern='grid',size=[1,1],gutter=[.08,.08],rotation=0,rowOffset=pattern==='brick'?.5:0,
      columnOffset=pattern==='column-stagger'?.5:0,wrap:periodic=[true,true],crop=[0,0,1,1],aspect=1,
      color:base='#b97853',palette,colorMode='tile',background=[0,0,0,0],jitter={},
      samples=1,precision='unorm8',seed:resolvedSeed=seed}=options;
    if (!patterns.includes(pattern)||!pair(size,n=>within(n,.025,3))||!pair(gutter,n=>within(n,0,.98))||
        !finite(rotation)||![rowOffset,columnOffset].every(n=>within(n,-4,4))||!within(aspect,.125,8)||
        !pair(periodic,n=>typeof n==='boolean')||!['tile','course','column','cycle'].includes(colorMode)||
        ![1,2,4].includes(samples)||!Object.hasOwn(storage,precision)||!safe(resolvedSeed))
      throw new RangeError('Invalid tile pattern, size, gutter, angle, offset, wrap, sampling or seed');
    if (pattern==='checker'&&(periodic[0]&&columns%2||periodic[1]&&rows%2))
      throw new RangeError('Checker needs an even count on each wrapped axis');
    if (!Array.isArray(crop)||crop.length!==4||!Array.from(crop).every(n=>within(n,-32,32))||
        crop[2]-crop[0]<1/8192||crop[3]-crop[1]<1/8192)
      throw new RangeError('Tile crop needs increasing left, top, right, bottom bounds in texture coordinates');
    if (!fields(jitter,['position','size','rotation','color'])) throw new TypeError('Unknown tile jitter control');
    const {position=[0,0],size:scale=[0,0],rotation:turn=0,color:tone=0}=jitter;
    if (!pair(position,n=>within(n,0,.95))||!pair(scale,n=>within(n,0,.95))||
        !within(turn,0,180)||!within(tone,0,1))
      throw new RangeError('Tile jitter needs bounded position, size, angle and color variations');
    if (palette!==undefined&&(!Array.isArray(palette)||palette.length<1||palette.length>64))
      throw new RangeError('A tile palette needs 1–64 colors');
    const colors=Array.from(palette??[base],color);
    return {pattern,size,gutter,rotation,rowOffset,columnOffset,periodic,crop,aspect,colors,colorMode,
      background:color(background),position,scale,turn,tone,samples,precision,seed:resolvedSeed};
  }

  function courseOffsets(count,step,periodic) {
    const steps=Math.sign(step)*Math.round(Math.abs(step)*count);
    const effective=periodic ? steps/count : step;
    const phases=Array.from({length:count},(_,index)=>periodic ? mod(index*steps,count)/count : mod(index*step,1));
    return {requested:step,effective,phases};
  }

  function prepare(columns,rows,config,stamps,driver) {
    const {pattern,periodic,aspect,size,gutter,rotation,colors,colorMode,seed,position,scale,turn,tone}=config;
    const course=courseOffsets(rows,config.rowOffset,periodic[1]);
    const column=courseOffsets(columns,config.columnOffset,periodic[0]);
    const buckets=Array.from({length:columns*rows},()=>[]), placements=[];
    const salt=hash('tile generator/'+seed), across=[columns,rows], eps=1/phaseUnits;
    const stream=name=>driver?.salts[name]??salt;
    const positionSalt=stream('position'), scaleSalt=stream('scale'), rotationSalt=stream('rotation'), colorSalt=stream('color');
    const signed=(id,channel,key)=>hash01(channel+'/'+id,key)*2-1;
    const rejected={density:0,visibility:0};
    let visits=0,maxCandidates=0,maxCost=0;
    for (let r=0;r<rows;r++) for (let c=0;c<columns;c++) {
      if (pattern==='checker'&&(c+r)%2) continue;
      const id=1+r*columns+c;
      const u=c+.5+course.phases[r], v=r+.5+column.phases[c], anchor=[u/columns,v/rows];
      const driven=driver?.at(id,anchor);
      if (driven?.skip) { rejected[driven.skip]++; continue; }
      const stampId=driven?.stampId??1, shape=stamps[stampId-1], priority=driven?.priority??0;
      const center=[(u+position[0]*signed(id,'u',positionSalt)+(driven?.position[0]??0))/columns,
        (v+position[1]*signed(id,'v',positionSalt)+(driven?.position[1]??0))/rows];
      const stampSize=size.map((n,i)=>n*(1-gutter[i])*(1+scale[i]*signed(id,i?'height':'width',scaleSalt))*(driven?.scale[i]??1));
      const angle=(rotation%360+turn*signed(id,'angle',rotationSalt)+(driven?.rotation??0))%360;
      const theta=angle*Math.PI/180, cos=Math.cos(theta), sin=Math.sin(theta);
      let slot = id-1;
      if (colorMode==='course') slot=r;
      if (colorMode==='column') slot=c;
      if (colorMode==='tile') slot=Math.floor(hash01('palette/'+id,colorSalt)*colors.length);
      const rgba=colors[slot%colors.length], shift=tone*signed(id,'tone',colorSalt);
      const rgb=rgba.slice(0,3).map(n=>shift<0 ? n*(1+shift) : n+(1-n)*shift);
      const rgbaLinear=[...toLinear(rgb),rgba[3]];
      const tint=driven?.color;
      if (tint) for (let i=0;i<4;i++) rgbaLinear[i]*=tint[i];
      const displayColor=tint ? [...toDisplay(rgbaLinear),rgbaLinear[3]] : [...rgb,rgba[3]];
      const [sx,sy]=[stampSize[0]*aspect/columns,stampSize[1]/rows];
      const ex=(Math.abs(cos)*sx+Math.abs(sin)*sy)/2/aspect, ey=(Math.abs(sin)*sx+Math.abs(cos)*sy)/2;
      const extremes=[ex,ey];
      const min=center.map((n,i)=>Math.floor((n-extremes[i]-eps)*across[i]));
      const max=center.map((n,i)=>Math.floor((n+extremes[i]+eps)*across[i]));
      for (let i=0;i<2;i++) if(!periodic[i]) { min[i]=Math.max(0,min[i]); max[i]=Math.min(across[i]-1,max[i]); }
      const count=Math.max(0,1+max[0]-min[0])*Math.max(0,1+max[1]-min[1]);
      if ((visits+=count)>1e6) throw new RangeError('Tile placements exceed their bucket budget');
      const tile={id,row:r+1,cos,sin,sx,sy,rgba:rgbaLinear,shape,stampId,priority};
      if (count) maxCost=Math.max(maxCost,shape.cost);
      for (let y=min[1];y<=max[1];y++) for (let x=min[0];x<=max[0];x++) {
        const u=periodic[0]?mod(x,columns):x, v=periodic[1]?mod(y,rows):y;
        const bucket=buckets[v*columns+u];
        // Each copy is moved into the fundamental period. Owner IDs and order stay canonical.
        bucket.push({tile,x:center[0]-(x-u)/columns,y:center[1]-(y-v)/rows});
        maxCandidates=Math.max(maxCandidates,bucket.length);
      }
      placements.push({id,row:r+1,column:c+1,center,size:stampSize,rotation:angle,color:displayColor,
        ...(driver&&{anchor,stampId,priority})});
    }
    if (driver?.prioritize) for (const bucket of buckets)
      bucket.sort((a,b)=>a.tile.priority-b.tile.priority || a.tile.id-b.tile.id);
    return {buckets,work:Math.max(1,maxCandidates*maxCost),layout:{pattern,columns,rows,wrap:periodic.slice(),aspect,seed,
      rowOffset:course,columnOffset:column,placements,...(driver&&{rejected,seeds:driver.seeds})}};
  }

  function compositor(buckets,columns,rows,config) {
    const {aspect,periodic,background}=config;
    const [br,bg,bb]=toLinear(background.slice(0,3)), ba=background[3];
    function axis(x,repeat) {
      const integer=Math.round(x*phaseUnits);
      return repeat ? mod(integer,phaseUnits)/phaseUnits : integer/phaseUnits;
    }
    return (x,y,out)=>{
      const u=axis(x,periodic[0]),v=axis(y,periodic[1]);
      let r=0,g=0,b=0,a=0,coverage=0,id=0,row=0,stampId=0;
      if(u>=0&&u<1&&v>=0&&v<1) {
        const hit=buckets[Math.floor(v*rows)*columns+Math.floor(u*columns)];
        for(let i=hit.length;i>0;) {
          const {tile}=hit[i-1], {cos,sin,sx,sy,rgba}=tile;
          const {distance,profile}=tile.shape;
          let opacity=0;
          // A wide stamp can touch itself. Multiple copies contribute a single maximum mask for its ID.
          do {
            const copy=hit[--i], dx=(u-copy.x)*aspect, dy=v-copy.y;
            const px=.5+(cos*dx+sin*dy)/sx, py=.5+(cos*dy-sin*dx)/sy;
            if (px>=0&&px<=1&&py>=0&&py<=1&&distance(px,py)<=0)
              opacity=Math.max(opacity,profile?profile(px,py):1);
          } while(i>0&&hit[i-1].tile===tile);
          if (!opacity) continue;
          if (!id) {id=tile.id;row=tile.row;stampId=tile.stampId;}
          const weight=(1-a)*opacity*rgba[3];
          r+=rgba[0]*weight; g+=rgba[1]*weight; b+=rgba[2]*weight; a+=weight;
          coverage+=(1-coverage)*opacity;
          if (a===1&&coverage===1) break;
        }
      }
      const weight=(1-a)*ba;
      out[0]=r+br*weight; out[1]=g+bg*weight; out[2]=b+bb*weight; out[3]=a+weight;
      out[4]=coverage; out[5]=id; out[6]=row; out[7]=stampId;
    };
  }

  function render(width,height,columns,rows,sources,options,seed,controls) {
    if (![width,height].every(n=>safe(n)&&n>0)||!dimensions({width,height})||width*height>4e6)
      throw new RangeError('Tile bake exceeds its four-million-texel budget');
    const config=settings(columns,rows,options,seed);
    if (!Array.isArray(sources)||sources.length<1||sources.length>32)
      throw new RangeError('Tile sampling needs 1–32 signed stamp definitions');
    const stamps=Array.from(sources,source=>shapes.compile(source));
    const driver=controls?.(config.seed,config.periodic,stamps.length);
    const {buckets,work,layout}=prepare(columns,rows,config,stamps,driver);
    const {samples,precision,crop,periodic}=config, subpixels=samples*samples, count=width*height;
    if (count*(subpixels+(samples===1?0:1))*work>160e6)
      throw new RangeError('Tile bake exceeds its sample budget');
    const [left,top,right,bottom]=crop, spans=[right-left,bottom-top];
    const stepX=spans[0]/width,stepY=spans[1]/height;
    const address=spans.map((n,i)=>periodic[i]&&Math.abs(n-Math.round(n))<1e-12?'wrap':'clamp');
    const tiling={u:address[0],v:address[1]}, materialSeed=config.seed;
    const data=new storage[precision](count*4), coverage=new Float32Array(count);
    const id=new Float32Array(count), course=new Float32Array(count);
    const picked=driver&&new Float32Array(count);
    const grid={width,height,channels:4,data}, colorSpec=descriptor(grid,{intent:'color',colorSpace:'srgb',
      precision,tiling,materialSeed,sampling:samples===1?'nearest':'linear'});
    const sample=compositor(buckets,columns,rows,config);
    const hit=new Float64Array(8), rgba=new Float64Array(5), rgb=[0,0,0];
    for(let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
      rgba.fill(0);
      for(let j=0;j<samples;j++) for(let k=0;k<samples;k++) {
        sample(left+(x+(k+.5)/samples)*stepX,top+(y+(j+.5)/samples)*stepY,hit);
        for(let c=0;c<5;c++) rgba[c]+=hit[c];
      }
      const alpha=rgba[3];
      for(let c=0;c<3;c++) rgb[c]=alpha?rgba[c]/alpha:0;
      toDisplay(rgb,rgb);
      for(let c=0;c<3;c++) data[4*p+c]=pack(rgb[c],colorSpec,false,'clamp');
      data[4*p+3]=pack(alpha/subpixels,colorSpec,true,'clamp');
      coverage[p]=clamp(rgba[4]/subpixels);
      if(samples!==1) sample(left+(x+.5)*stepX,top+(y+.5)*stepY,hit);
      id[p]=hit[5]; course[p]=hit[6];
      if (picked) picked[p]=hit[7];
    }
    function scalar(data,intent,sampling='nearest') {
      const raster={width,height,channels:1,data};
      return wrap(raster,descriptor(raster,{intent,precision:'float32',tiling,materialSeed,sampling}));
    }
    return {value:wrap(grid,colorSpec),coverage:scalar(coverage,'mask',samples===1?'nearest':'linear'),
      tileId:scalar(id,'data'),course:scalar(course,'data'),layout:freeze(layout),
      ...(picked&&{stampId:scalar(picked,'data')})};
  }
  function generate(width,height,columns=4,rows=6,source=stamp,options={},seed=0) {
    return render(width,height,columns,rows,[source],options,seed);
  }
  return Object.freeze({generate,render,stamp});
};
