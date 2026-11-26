const { fields, range } = require('./character-rig-assembly.js');

const integer = (n,min,max) => Number.isSafeInteger(n) && n>=min && n<=max;
const pointMethods = ['linear','hold'];
const methods = [...pointMethods,'mean','rms','peak'];

function grid(T, spec, limit=14400) {
  if (!fields(spec,['rate','start','frames']) || !integer(spec.frames,1,limit))
    throw new RangeError('Use a channel clock with a rate, start and bounded positive frame count');
  const {frames} = spec, rate = T.read(spec.rate), start = T.read(spec.start ?? 0);
  if (!range(T.seconds(rate),.001,192000) || !range(T.seconds(start),-1e12,1e12))
    throw new RangeError('Channel clock exceeds its rate or time range');
  const period = T.div([1n,1n],rate);
  const at = index => T.add(start,T.mul([BigInt(index),1n],period));
  return {rate,start,frames,at,report:{rate:T.pack(rate),start:T.pack(start),end:T.pack(at(frames)),frames}};
}

function sample(T, series, start, end, method, measure) {
  if (series.at) {
    if (method!=='linear') throw new RangeError('Continuous animation channels use linear point sampling');
    return series.at(start);
  }
  const {clock,values} = series, length = values.length;
  const coordinate = time => T.mul(T.sub(time,clock.start),clock.rate);
  const position = coordinate(start), stop = [BigInt(length),1n];
  if (position[0]<0n || T.compare(position,stop)>=0) return null;
  const first = T.index(T.roundDown(position));
  if (pointMethods.includes(method)) {
    const a = values[first];
    if (method==='hold' || first+1===length || position[1]===1n || a===null) return a;
    const b = values[first+1];
    if (b===null) return null;
    const t = T.seconds([position[0]%position[1],position[1]]);
    return a*(1-t)+b*t;
  }

  // Native samples occupy half-open cells. Weight fractional edge cells without rounding the window.
  const finish = coordinate(end);
  if (T.compare(finish,stop)>0) return null;
  const last = T.index(T.roundDown(finish)), width = T.seconds(T.sub(finish,position));
  const left = 1-T.seconds([position[0]%position[1],position[1]]);
  const right = T.seconds([finish[0]%finish[1],finish[1]]);
  if (!(width>0)) return null;
  measure(last-first+1);
  if (last===first) return values[first]===null ? null :
    method==='mean' ? values[first] : Math.abs(values[first]);
  let sum = 0;
  for (let i=first;i<=last;i++) {
    const weight = i===first ? left : i===last ? right : 1;
    if (!weight) continue;
    const value = values[i];
    if (value===null) return null;
    if (method==='peak') sum = Math.max(sum,Math.abs(value));
    else sum += weight/width*(method==='rms'?value*value:value);
  }
  return method==='rms' ? Math.sqrt(sum) : sum;
}

module.exports = { grid, sample, methods, integer };
