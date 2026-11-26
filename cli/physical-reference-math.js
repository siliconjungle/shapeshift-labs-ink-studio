const { dot, along, clamp } = require('./sdf-reference-field.js');
const sub = (a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a,b)=>[a[0]*b[0],a[1]*b[1],a[2]*b[2]];
const scale = (a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross = (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = a=>Math.hypot(a[0],a[1],a[2]);
const unit = a=>scale(a,1/(length(a)||1));
const luma = a=>.2126*a[0]+.7152*a[1]+.0722*a[2];
const max = a=>Math.max(a[0],a[1],a[2]);
const radians = d=>d*Math.PI/180;
const tau = 2*Math.PI;

function random(seed,pixel,sample) {
  let n=(seed^Math.imul(pixel+1,0x9e3779b1)^Math.imul(sample+1,0x85ebca77))|0;
  return ()=>{
    n=(n+0x6d2b79f5)|0;
    let x=Math.imul(n ^ n>>>15,1|n);
    x^=x+Math.imul(x^x>>>7,61|x);
    return ((x^x>>>14)>>>0)/4294967296;
  };
}

function distribution(entries) {
  let total=0;
  const sums=Float64Array.from(entries,weight=>total+=weight);
  function pick(u) {
    let low=0, high=sums.length;
    const q=u*total;
    while(high-low>1) {
      const middle=(high+low)>>>1;
      if(q<sums[middle-1]) high=middle;
      else low=middle;
    }
    return low;
  }
  return {total,pick,pdf:i=>total?entries[i]/total:0};
}

function frame(n) {
  const u=unit(cross(Math.abs(n[1])<.95?[0,1,0]:[1,0,0],n));
  return [u,cross(n,u)];
}
function direction(n, basis, cos, angle) {
  const sin = Math.sqrt(Math.max(0,1-cos*cos));
  return along(along(scale(n,cos),basis[0],sin*Math.cos(angle)),basis[1],sin*Math.sin(angle));
}
const mis = (a,b)=>a*a/(a*a+b*b||1);
module.exports = { dot,along,clamp,sub,mul,scale,cross,length,unit,luma,max,radians,tau,random,distribution,frame,direction,mis };
