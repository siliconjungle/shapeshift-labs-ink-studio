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

function readHeader(input, versions, message, limitBytes) {
  const bytes = C.input(input, limitBytes), version = bytes.readUInt32LE(4);
  if (bytes.readInt32LE(0) !== 20000630 || !versions.includes(version)) throw new TypeError(message);
  const limit = version & 0x400 ? 255 : 31;
  let at = 8;
  function word(source, offset) {
    const end = source.indexOf(0, offset);
    if (end < offset || end - offset > limit) throw new TypeError('Invalid OpenEXR name');
    const value = source.toString('latin1', offset, end);
    if (value && !/^[!-~]+$/.test(value)) throw new TypeError('Invalid OpenEXR name');
    return [value, end + 1];
  }
  const attrs = new Map();
  while (true) {
    const [name, next] = word(bytes, at);
    at = next;
    if (!name) break;
    const [type, body] = word(bytes, at), size = C.slice(bytes, body, 4).readInt32LE();
    if (attrs.has(name) || attrs.size >= 128 || body + 4 + size > 4 * 1024 ** 2)
      throw new RangeError('OpenEXR metadata exceeds its budget');
    attrs.set(name, { type, data: C.slice(bytes, body + 4, size) });
    at = body + 4 + size;
  }
  function get(name, type, length) {
    const row = attrs.get(name);
    if (!row || row.type !== type || length !== undefined && row.data.length !== length)
      throw new TypeError('Invalid OpenEXR attribute ' + name);
    return row.data;
  }
  return { bytes, at, attrs, word, get };
}

module.exports={ cstring,int,float,attribute,zips,unzip,readHeader };
