'use strict';

const Color = require('../src/color-space.js');
const linear = Color.prepare('srgb','srgb-linear'), srgb = Color.prepare('srgb-linear','srgb');
const maxFamily = 8;
const rgb = packed => [packed>>>16,packed>>>8&255,packed&255].map(n=>n/255);
const pack = color => color.reduce((n,c)=>n*256+Math.round(Math.max(0,Math.min(1,c))*255),0);
const packedRgb = packed => packed>>>16 | packed&0xff00 | (packed&255)<<16;
const mean = (rows,weights) => rows[0].map((_,i)=>rows.reduce((sum,row,j)=>sum+row[i]*weights[j],0));
const outer = ([x,y,z]) => [x*x,x*y,x*z,y*y,y*z,z*z];
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const coordinates = [4,5,6,8,9,10];

function area(covariance) {
  if (!Array.isArray(covariance) || covariance.length!==6 || !Array.from(covariance).every(n=>Number.isFinite(Math.fround(n))))
    throw new RangeError('Redistributed covariance needs six finite entries');
  const [xx,xy,xz,yy,yz,zz]=covariance.map(Math.fround);
  const minor=xx*yy-xy*xy, determinant=zz*minor-xx*yz*yz+2*xy*xz*yz-xz*xz*yy;
  if (xx<=0 || minor<=0 || determinant<=0)
    throw new RangeError('Redistributed covariance must be positive definite. Reduce the split offsets.');
  return Math.cbrt(determinant);
}

function packedRow({position,covariance,opacity,pigment}) {
  area(covariance);
  if (!Number.isFinite(Math.fround(opacity)) || Math.fround(opacity)<=0 ||
      !Number.isSafeInteger(pigment) || pigment<0 || pigment>0xffffff)
    throw new RangeError('Redistributed splats need positive opacity and RGB pigment');
  const data=new Float32Array(16);
  data.set(position);
  data[3]=opacity;
  data[7]=packedRgb(pigment);
  coordinates.forEach((at,i)=>{ data[at]=covariance[i]; });
  return data;
}

const thickness=opacity=>-Math.log1p(-Math.min(1-1e-5,opacity));
const opacity=(mass,covariance)=>-Math.expm1(-mass/area(covariance));
const massOf=row=>area(row.covariance)*(row.opacity>=1 ? row.opacity : thickness(row.opacity));
function weights(values) {
  if (!values.every(n=>Number.isFinite(n) && n>0)) throw new RangeError('Redistribution weights must be positive');
  const sum=values.reduce((a,b)=>a+b,0);
  if (!Number.isFinite(sum)) throw new RangeError('Redistribution weights exceed their range');
  return values.map(n=>n/sum);
}

function split(parent, children) {
  const fractions=weights(children.map(child=>child.weight??1));
  const offsets=children.map(child=>child.offset);
  const centroid=mean(offsets,fractions);
  const spread=mean(offsets.map(offset=>outer(sub(offset,centroid))),fractions);
  const covariance=sub(parent.covariance,spread), mass=massOf(parent);
  return children.map(({id,offset},i)=>({...parent,id,covariance,weight:fractions[i],
    position:parent.position.map((v,k)=>v+offset[k]-centroid[k]),
    opacity:parent.opacity>=1 ? parent.opacity : opacity(mass*fractions[i],covariance)}));
}

function merge(parents) {
  const masses=parents.map(massOf);
  const fractions=weights(masses);
  const position=mean(parents.map(row=>row.position),fractions);
  const covariance=mean(parents.map(row=>{
    const spread=outer(sub(row.position,position));
    return row.covariance.map((v,k)=>v+spread[k]);
  }),fractions);
  const pigment=pack(srgb(mean(parents.map(row=>linear(rgb(row.pigment))),fractions)));
  const scan=parents[0].scan;
  const blend=name=>mean(parents.map(row=>row.scan[name]),fractions);
  const density=parents[0].opacity>=1 ? mean(parents.map(row=>[row.opacity]),fractions)[0]
    : opacity(masses.reduce((a,b)=>a+b,0),covariance);
  return {position,covariance,pigment,opacity:density,
    weights:fractions,...(scan && {scan:{dc:blend('dc'),sh:blend('sh'),linear:scan.linear,
      ...(scan.normal && {normal:blend('normal').map(Math.round)})}})};
}

module.exports={maxFamily,packedRow,area,coordinates,split,merge,linearRGB:packed=>linear(rgb(packed))};
