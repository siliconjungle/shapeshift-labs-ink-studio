const { deflateSync } = require('node:zlib');
const C = require('./texture-common.js');

const cstring = value => Buffer.from(value+'\0');
function int(...values) {
  const out=Buffer.allocUnsafe(values.length*4);
  values.forEach((value,index)=>out.writeInt32LE(value,4*index));
  return out;
}
function float(...values) {
  const out=Buffer.allocUnsafe(values.length*4);
  values.forEach((value,index)=>out.writeFloatLE(value,4*index));
  return out;
}
function attribute(name,type,value) {
  return Buffer.concat([cstring(name),cstring(type),int(value.length),value]);
}
function zips(raw) {
  if (!raw.length) return raw;
  const packed=Buffer.allocUnsafe(raw.length), odd=Math.ceil(raw.length/2);
  for (let i=0;i<raw.length;i++) packed[(i&1?odd:0)+(i>>1)]=raw[i];
  for (let i=packed.length-1;i>0;i--) packed[i]=packed[i]-packed[i-1]+128;
  const zipped=deflateSync(packed,{level:4});
  return zipped.length<raw.length ? zipped : raw;
}
function unzip(packed,size) {
  const bytes=C.inflate(packed,size), raw=Buffer.allocUnsafe(size), odd=Math.ceil(size/2);
  for(let i=1;i<size;i++) bytes[i]=bytes[i]+bytes[i-1]-128;
  for(let i=0;i<size;i++) raw[i]=bytes[(i&1?odd:0)+(i>>1)];
  return raw;
}
module.exports={ cstring,int,float,attribute,zips,unzip };
