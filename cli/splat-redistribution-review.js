'use strict';

const Diagnostics = require('./splat-edit-diagnostics.js');
const Provenance = require('../src/splat-provenance.js');
const Fit = require('./splat-fit-asset.js');
const {linearRGB} = require('./splat-redistribution-math.js');

const defaults = {opacity:.15,pigment:.10,depth:.15,silhouette:.20};
const fields = (value, keys) => value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));
const range = (value,min,max)=>Number.isFinite(value) && value>=min && value<=max;

function settings(request) {
  if (!fields(request,['width','height','views','tolerances','threshold']))
    throw new TypeError('Splits and merges need a review with at least two distinct camera angles');
  const {width=160,height=112,views,threshold=.25,tolerances={}}=request;
  if (![width,height].every(n=>Number.isSafeInteger(n) && range(n,8,256)) ||
      !range(threshold,.05,.95) || !Array.isArray(views) || views.length<2 || views.length>8 ||
      !fields(tolerances,Object.keys(defaults)) ||
      Object.entries(tolerances).some(([k,n])=>!range(n,0,k==='depth' ? 1e5 : 1)))
    throw new RangeError('Invalid native splat redistribution review grid, threshold or tolerances');
  const names=new Set(), angles=new Set();
  for (const view of views) {
    if (!fields(view,['id','yaw','pitch','ortho','target','zoom','time']) ||
        typeof view.id!=='string' || !view.id.trim() || view.id.length>128 || names.has(view.id) ||
        !range(view.yaw,-Math.PI,Math.PI) || !range(view.pitch,-Math.PI/2,Math.PI/2) ||
        view.ortho!==undefined && typeof view.ortho!=='boolean' ||
        view.zoom!==undefined && !range(view.zoom,.05,30) || view.time!==undefined && !range(view.time,0,1e6) ||
        view.target!==undefined && (!Array.isArray(view.target) || view.target.length!==3 ||
          !Array.from(view.target).every(n=>range(n,-1e6,1e6))))
      throw new RangeError('Invalid or duplicate splat review camera');
    names.add(view.id);
    angles.add([Math.sin(view.yaw)*Math.cos(view.pitch),Math.sin(view.pitch),
      Math.cos(view.yaw)*Math.cos(view.pitch)].map(n=>Math.round(n*1e6)).join(','));
  }
  if (angles.size<2) throw new RangeError('Splat redistribution needs two distinct review angles');
  return {width,height,threshold,views,tolerances:{...defaults,...tolerances}};
}

// Use the native fragment stream, including occluders, to avoid relying on
// the bounded source-pick lanes for translucent overlap.
function frame(world, asset, families, config, view) {
  const {width,height}=config, {id,time=0,...camera}=view, size=width*height;
  const fit=Fit.prepare(world,asset);
  const bins=families.map(()=>new Float64Array(size*5));
  const render=require('./render.js').render;
  let captured=false;
  const options=Diagnostics.viewOptions(width,height,time,camera);
  render(world,{...options,splatFit:asset??false,raw:true,colored:false,coverageFilter:false,
    depthOfField:false,silhouetteProtection:false,reflections:false,
    [Diagnostics.scope](rendered,w,h) {
      if (captured || w!==width || h!==height) throw new RangeError('Redistribution needs one matched native review per view');
      captured=true;
      const source=Fit.sourceWorld(rendered,fit), ids=Provenance.identities(source);
      const affected=new Map();
      for (const [family,entry] of families.entries()) for (const name of entry.ids) {
        const row=ids.rowOf(name);
        if (row>=0) affected.set(row,{family,color:linearRGB(Fit.pigmentAt(source,row,fit))});
      }
      return {project(){},cull(){},fragment(pixel,row,depth,alpha,surface) {
        const candidate=!surface && affected.get(row), at=pixel*5, remain=1-alpha;
        for (let family=0;family<bins.length;family++) {
          const bin=bins[family];
          if (bin[at]) for (let i=0;i<5;i++) bin[at+i]*=remain;
        }
        if (!candidate) return;
        const bin=bins[candidate.family];
        bin[at]+=alpha;
        bin[at+1]+=alpha*depth;
        for (let c=0;c<3;c++) bin[at+2+c]+=alpha*candidate.color[c];
      }};
    }});
  if (!captured) throw new RangeError('Redistribution did not capture the native fragment stream');
  return bins;
}

function compare(a,b,{threshold,tolerances}) {
  let opacity=0, pigment=0, occupied=0, shared=0, silhouette=0, union=0, added=0, removed=0;
  let beforeOpacity=0, afterOpacity=0, peakOpacity=0;
  const depth=[];
  for (let at=0;at<a.length;at+=5) {
    const left=a[at], right=b[at];
    beforeOpacity+=left;
    afterOpacity+=right;
    if (Math.max(left,right)<.02) continue;
    occupied++;
    const delta=Math.abs(left-right);
    opacity+=delta;
    peakOpacity=Math.max(peakOpacity,delta);
    if (left>=threshold || right>=threshold) union++;
    if ((left>=threshold)!==(right>=threshold)) {
      silhouette++;
      if (right>=threshold) added++;
      else removed++;
    }
    if (left<.02 || right<.02) continue;
    shared++;
    depth.push(Math.abs(a[at+1]/left-b[at+1]/right));
    pigment+=Math.max(...[2,3,4].map(i=>Math.abs(a[at+i]/left-b[at+i]/right)));
  }
  depth.sort((x,y)=>x-y);
  const errors={opacity:occupied ? opacity/occupied : null, pigment:shared ? pigment/shared : null,
    depth:shared ? depth[Math.ceil(shared*.95)-1] : null, silhouette:union ? silhouette/union : 0};
  const failed=Object.keys(tolerances).filter(key=>errors[key]!==null && errors[key]>tolerances[key]+1e-10);
  if (!Number.isFinite(errors.depth) || !shared) failed.push('insufficient-visible-overlap');
  return {passed:!failed.length,failed,errors,pixels:{occupied,shared,silhouetteUnion:union,added,removed},
    opacity:{before:beforeOpacity,after:afterOpacity,peakError:peakOpacity}};
}

function review(world, before, after, families, config) {
  const views=config.views.map(view=>{
    const a=frame(world,before,families,config,view), b=frame(world,after,families,config,view);
    const measured=families.map(({sources,outputs},i)=>({sources,outputs,...compare(a[i],b[i],config)}));
    return {...view,passed:measured.every(row=>row.passed),families:measured};
  });
  return {format:'ink-studio/splat-redistribution-review',version:1,
    grid:[config.width,config.height],threshold:config.threshold,tolerances:config.tolerances,
    passed:views.every(view=>view.passed),views};
}

module.exports={settings,review};
