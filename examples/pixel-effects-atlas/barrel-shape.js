/* Shared signed-field barrel for the Effects Atlas and editable material study. */
const tau=2*Math.PI;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const wrap=(n,p=tau)=>(n%p+p)%p;
const hoops=[-.77,-.17,.44,.86];
const nStaves=15;
function section(y){
  return .688+.264*Math.cos(clamp(y,-1.1,1.1)*1.52)**2;
}
function barrelShape(x,y,z){
  const r=Math.hypot(x,z),theta=Math.atan2(x,z);
  const furrow=smooth(.095,.015,Math.abs(wrap(theta*nStaves/tau+.5,1)-.5));
  const wood=Math.max(r-section(y)+.013*furrow,Math.abs(y)-(1+.036*smooth(.60,.74,r)));
  let hoop=Infinity;
  for(const h of hoops) {
    const dy=Math.abs(y-h);
    hoop=Math.min(hoop,Math.max(dy-.096,r-section(h)-.068+.024*smooth(.064,.093,dy)));
  }
  return Math.min(wood,hoop);
}
barrelShape.bounds={min:[-1.03,-1.06,-1.03],max:[1.03,1.06,1.03]};
module.exports={barrelShape,hoops,nStaves};
