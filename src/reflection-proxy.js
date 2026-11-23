/* Select a planar capture and its lower-cost reflection sources using shot depth and roughness. */
const ReflectionProxy = (() => {
  const record=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
  const range=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  function band(value,limit,label) {
    if(value===false)return false;
    if(!Array.isArray(value)||value.length!==2||!Array.from(value).every(n=>range(n,0,limit))||value[0]>value[1])
      throw new RangeError('Reflection proxy '+label+' needs an ordered pair');
    return value.slice();
  }
  function prepare(value, roughness=0) {
    if(value===undefined||value===false)return;
    if(!record(value)||Object.keys(value).some(key=>!['distance','roughness','roughnessRange','probe','probeSize'].includes(key)))
      throw new TypeError('Invalid reflection proxy settings');
    const {distance=[7,12],roughnessRange=[.5,.85],roughness:surface=roughness,probe,probeSize=32}=value;
    if(!range(surface,0,1)||probe!==undefined&&(typeof probe!=='string'||!probe.trim()||probe.length>256)||
        ![16,32,64].includes(probeSize))
      throw new RangeError('Reflection proxy needs roughness in [0,1] and an optional named 16, 32 or 64 pixel probe');
    return {distance:band(distance,10000,'distance'),roughnessRange:band(roughnessRange,1,'roughness'),
      roughness:surface,...(probe!==undefined&&{probe,probeSize})};
  }
  function keep(value, pair) {
    if(!pair||value<=pair[0])return 1;
    if(value>=pair[1])return 0;
    const t=(value-pair[0])/(pair[1]-pair[0]);
    return 1-t*t*(3-2*t);
  }
  const planarWeight=(proxy,depth)=>keep(depth,proxy.distance)*keep(proxy.roughness,proxy.roughnessRange);
  const reflected=(toward,normal)=>{
    const twice=2*toward.reduce((sum,n,i)=>sum+n*normal[i],0);
    return toward.map((n,i)=>normal[i]*twice-n);
  };
  return Object.freeze({prepare,keep,planarWeight,reflected});
})();
if (typeof module !== 'undefined') module.exports = ReflectionProxy;
