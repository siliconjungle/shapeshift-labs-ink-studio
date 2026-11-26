const Surface=require('./bake-job-surface.js');

const names=['thickness','thickness-valid'];
const fields=['thicknessRange','thicknessDirection','thicknessAxis'];
const epsilon=1e-8;

function settings(map,input) {
  if(!names.includes(map))return {};
  const {thicknessRange,thicknessDirection='geometric',thicknessAxis,encoding='png8'}=input;
  if(thicknessRange!==undefined&&(!Number.isFinite(thicknessRange)||thicknessRange<=0||
      input.rayBias!==undefined&&input.rayBias>=thicknessRange)||
    !['geometric','shading','axis'].includes(thicknessDirection)||
    (thicknessDirection==='axis' ?
      !Array.isArray(thicknessAxis)||thicknessAxis.length!==3||!Array.from(thicknessAxis).every(Number.isFinite)||
      !(Math.hypot(...thicknessAxis)>epsilon&&Number.isFinite(Math.hypot(...thicknessAxis))) : thicknessAxis!==undefined)||
    !Surface.encodings.includes(encoding))
    throw new RangeError('Thickness needs a positive search range, a ray direction and a nonzero axis for fixed-axis rays');
  return {encoding,thickness:{range:thicknessRange,direction:thicknessDirection,axis:thicknessAxis}};
}

function prepare(rows,nearest,{diagonal,rayBias,precision},settings,raw,V) {
  const {range=diagonal,direction='geometric',axis}=settings??{};
  if(!(range>rayBias&&Number.isFinite(range)))throw new RangeError('Thickness search range must exceed its ray bias');
  const fixed=axis&&V.norm(axis);
  const tolerance=Math.min(range*.01,Math.max(diagonal*1e-9,precision));
  const rejected={open:0,nonManifold:0,winding:0,degenerate:0,grazing:0,rangeMiss:0,bias:0,part:0,shell:0,ambiguous:0,orientation:0};
  let valid=0,clipped=0,min=Infinity,max=-Infinity;
  function measure(face,point,shading,i,scale,write) {
    const source=rows[face], normal=source.normal;
    let reason=source.invalid;
    if(!reason) {
      const along=direction==='axis'?fixed:direction==='shading'?shading??normal:normal;
      const dot=V.dot(normal,along);
      if(Math.abs(dot)<=epsilon)reason='grazing';
      else {
        const inward=dot>0?V.mul(along,-1):along;
        const result=nearest(point,inward,range,face,tolerance);
        if(!result)reason='rangeMiss';
        else if(result.distance<=rayBias)reason='bias';
        else {
          const {row:exit,distance,ties}=result;
          const facing=row=>V.dot(row.normal,inward)>epsilon;
          if(ties.some(({row})=>row.shell!==exit.shell||row.part!==exit.part||facing(row)!==facing(exit)))
            reason='ambiguous';
          else if(exit.part!==source.part)reason='part';
          else if(exit.shell!==source.shell)reason='shell';
          else if(!facing(exit))reason='orientation';
          else {
            if(raw) {
              const sample=Math.fround(distance);
              if(!Number.isFinite(sample))throw new RangeError('Thickness exceeds the float32 range');
              raw[i]=sample;
            }
            write(distance);
            valid++;
            clipped+=Number(distance>scale);
            min=Math.min(min,distance);
            max=Math.max(max,distance);
          }
        }
      }
    }
    if(reason)rejected[reason]++;
  }
  function report() {
    return {valid,unknown:Object.values(rejected).reduce((a,b)=>a+b,0),clipped,
      min:valid?min:null,max:valid?max:null,range,direction,...(fixed&&{axis:fixed}),rejected};
  }
  return {measure,report};
}

function output(result,raw,settings) {
  const {size,encoding}=settings, {geometryMasks,registeredMaps:{masks}}=result;
  const {thickness,thicknessScale:scale}=geometryMasks;
  const info={kind:'thickness',encoding,bitDepth:Surface.depth(encoding),units:'shape-units',
    range:encoding==='exr'?null:[0,scale],previewRange:[0,scale],searchRange:thickness.range,
    clipped:encoding==='exr'?0:thickness.clipped};
  if(encoding==='png8')return {bytes:masks.thickness,output:info};
  const units=Float32Array.from(raw,n=>Math.min(1,n/scale));
  const encoded=Surface.scalar(size,encoding,encoding==='exr'?raw:units,units);
  return {...encoded,output:info};
}

module.exports={names,fields,settings,prepare,output};
