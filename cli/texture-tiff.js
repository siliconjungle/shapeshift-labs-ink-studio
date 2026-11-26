const { deflateSync } = require('node:zlib');
const C = require('./texture-common.js');
const sizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1 };

function layout(file, page) {
  const bytes = C.input(file), marker = bytes.toString('ascii',0,2);
  if (!['II','MM'].includes(marker)) throw new TypeError('Expected TIFF byte order');
  const order = marker === 'II' ? 'LE' : 'BE';
  const short = (data,o) => data['readUInt16'+order](o), long = (data,o) => data['readUInt32'+order](o);
  if (short(bytes,2) !== 42) throw new TypeError('Expected classic TIFF');
  const directories = [], visited = new Set();
  for (let at=long(bytes,4); at;) {
    if (at < 8 || visited.has(at) || directories.length >= 64) throw new RangeError('Invalid TIFF directory chain');
    visited.add(at);
    const count = short(C.slice(bytes,at,2),0), body = C.slice(bytes,at+2,12*count+4), tags = new Map();
    if (count > 512) throw new RangeError('TIFF tag budget exceeded');
    for (let i=0; i<count; i++) {
      const offset=i*12, tag=short(body,offset), type=short(body,offset+2), length=long(body,offset+4);
      if (tags.has(tag)) throw new TypeError('Duplicate TIFF tag '+tag);
      tags.set(tag,{ type,length,value:body.subarray(offset+8,offset+12) });
    }
    directories.push(tags);
    at=long(body,12*count);
  }
  if (!directories.length || (page === undefined && directories.length > 1))
    throw new TypeError('Select an explicit page for a multi-page TIFF texture');
  const selected = page ?? 0;
  if (!C.uint(selected,0,directories.length-1)) throw new RangeError('Unknown TIFF page');
  const tags=directories[selected];
  function tagData(id, types) {
    const row=tags.get(id);
    if (!row) return;
    if (!types.includes(row.type) || !row.length) throw new TypeError('Invalid TIFF field '+id);
    const size=sizes[row.type]*row.length;
    return { ...row, bytes:size<=4 ? row.value.subarray(0,size) : C.slice(bytes,long(row.value,0),size) };
  }
  function numbers(id, types=[3,4], limit=65536) {
    const field=tagData(id,types);
    if (!field) return [];
    const { type,length,bytes }=field;
    if (length > limit) throw new RangeError('TIFF field exceeds its value budget '+id);
    return Array.from({length},(_,i)=>{
      const at=i*sizes[type];
      if (type === 3) return short(bytes,at);
      if (type === 4) return long(bytes,at);
      return long(bytes,at)/long(bytes,at+4);
    });
  }
  const one = (id,fallback) => numbers(id,[3,4],1)[0] ?? fallback;
  const width=one(256), height=one(257), channels=one(277,1), bits=numbers(258,[3],4);
  const bitDepth=bits[0], Type=C.sampleType(bitDepth), sampleFormat=numbers(339,[3],4), color=one(262);
  const alphaTag=one(338), orientation=one(274,1);
  if (!Type || ![1,2,3,4].includes(channels) || !bits.every(v=>v===bitDepth) || bits.length!==channels ||
      (sampleFormat.length && sampleFormat.length!==channels) ||
      (bitDepth===32 ? !sampleFormat.length || !sampleFormat.every(v=>v===3) : sampleFormat.some(v=>v!==1)) ||
      ![1,2,3,4].includes(orientation) || (channels>2 ? color!==2 : ![0,1].includes(color)) ||
      (channels%2 ? alphaTag!==undefined : ![0,1,2].includes(alphaTag)))
    throw new TypeError('Unsupported TIFF sample layout, orientation or alpha');
  const alpha=alphaTag===1?'premultiplied':alphaTag===2?'straight':'none';
  C.extent(width,height,channels*bitDepth/8);
  const compression=one(259,1), predictor=one(317,1), planar=one(284,1);
  if (![1,5,8,32946,32773].includes(compression) || ![1,2].includes(planar) ||
      ![1,2].includes(predictor) || predictor===2 && bitDepth===32)
    throw new TypeError('Unsupported TIFF compression, predictor or planar configuration');
  const tiled=tags.has(324) || tags.has(325);
  const columns=tiled ? one(322) : width, rows=tiled ? one(323) : Math.min(height,one(278,height));
  C.extent(columns,rows,(planar===1?channels:1)*bitDepth/8);
  const across=Math.ceil(width/columns), down=Math.ceil(height/rows), blocks=across*down;
  const count=blocks*(planar===1?1:channels);
  const offsets=numbers(tiled?324:273), lengths=numbers(tiled?325:279);
  if (offsets.length!==count || lengths.length!==count) throw new TypeError('Missing TIFF strips or tiles');
  for (let i=0;i<count;i++) if (offsets[i]<8 || !lengths[i] || offsets[i]+lengths[i]>bytes.length)
    throw new RangeError('Invalid TIFF block extent');
  const profile={};
  const embedded=tagData(34675,[1,7]);
  if (embedded) profile.icc=C.icc(embedded.bytes).toString('base64');
  const white=numbers(318,[5],2), primaries=numbers(319,[5],6);
  if (white.length===2 && primaries.length===6) profile.chromaticities=[...primaries,...white];
  C.profileMode(C.profile(profile).bytes,channels);
  const description = tagData(270,[2])?.bytes;
  const declared = description?.length <= 128 && description.toString('latin1');
  const colorSpace = /^Ink Studio color space: (srgb|srgb-linear|display-p3|display-p3-linear)\0$/.exec(declared)?.[1] ??
    (bitDepth===32&&!embedded ? profile.chromaticities?.every((n,i)=>Math.abs(n-C.p3[i])<1e-5) ? 'display-p3-linear' : 'srgb-linear' : undefined);
  return { info:{width,height,channels,bitDepth,alpha,profile,page:selected,pages:directories.length,...(colorSpace&&{colorSpace})},
    bytes, order,color,orientation,compression,predictor,planar,tiled,columns,rows,across,blocks,offsets,lengths };
}

// TIFF LZW uses MSB-first codes, clear/end codes, and the early code-width change.
function lzw(bytes, size) {
  const result=Buffer.alloc(size), previous=new Int16Array(4096), suffix=new Uint8Array(4096), queue=new Uint8Array(4096);
  let width=9, end=258, old=-1, bit=0, out=0, reachedEnd=false;
  while (bit+width<=bytes.length*8) {
    let key=0;
    for (let i=0;i<width;i++,bit++) key=(key<<1)|((bytes[bit>>3]>>(7-(bit&7)))&1);
    if (key===257) { reachedEnd=true; break; }
    if (key===256) { width=9; end=258; old=-1; continue; }
    if (key>end || key===end && old<0) throw new RangeError('Invalid TIFF LZW code');
    let walk=key===end?old:key, tail=0;
    while (walk>=258) {
      if (walk>=end || tail>=queue.length-1) throw new RangeError('Invalid TIFF LZW dictionary');
      queue[tail++]=suffix[walk];
      walk=previous[walk];
    }
    if (walk<0 || walk>255 || out+tail+1+Number(key===end)>size)
      throw new RangeError('TIFF LZW block exceeds its sample count');
    result[out++]=walk;
    while(tail) result[out++]=queue[--tail];
    if (key===end) result[out++]=walk;
    if (old>=0 && end<4096) {
      previous[end]=old;
      suffix[end++]=walk;
      if (width<12 && end===(1<<width)-1) width++;
    }
    old=key;
  }
  if (!reachedEnd || out!==size) throw new RangeError('Incomplete TIFF LZW block');
  return result;
}

function packBits(bytes, size) {
  const result=Buffer.alloc(size);
  let write=0;
  for(let at=0;at<bytes.length;) {
    const count=bytes.readInt8(at++);
    if (count===-128) continue;
    const n=count>=0 ? count+1 : 1-count;
    if (n>size-write || at+(count>=0?n:1)>bytes.length)
      throw new RangeError('Invalid TIFF PackBits run');
    if (count>=0) { bytes.copy(result,write,at,at+n); at+=n; }
    else result.fill(bytes[at++],write,write+n);
    write+=n;
  }
  if (write!==size) throw new RangeError('Incomplete TIFF PackBits block');
  return result;
}

function read(file,{ layoutOnly=false,page }={}) {
  const parsed=layout(file,page), {info}=parsed;
  if (layoutOnly) return info;
  const {width,height,channels,bitDepth}=info, bps=bitDepth/8, Type=C.sampleType(bitDepth);
  const {bytes,order,color,orientation,compression,predictor,planar,tiled,columns,rows,across,blocks,offsets,lengths}=parsed;
  const data=new Type(width*height*channels), lanes=planar===1?channels:1, stride=lanes*bps;
  const method=bitDepth===32?'readFloat'+order:bitDepth===16?'readUInt16'+order:'readUInt8';
  const max=bitDepth===32?1:2**bitDepth-1;
  for (let i=0;i<offsets.length;i++) {
    const p=i%blocks,x0=(p%across)*columns,y0=Math.floor(p/across)*rows;
    const lines=tiled?rows:Math.min(rows,height-y0), rawBytes=columns*lines*stride;
    const stored=C.slice(bytes,offsets[i],lengths[i]);
    const raw=compression===1 ? stored : compression===5 ? lzw(stored,rawBytes) :
      compression===32773 ? packBits(stored,rawBytes) : C.inflate(stored,rawBytes);
    if (raw.length!==rawBytes) throw new RangeError('TIFF block does not match its sample count');
    const prior=new Array(lanes);
    for (let y=0;y<lines && y0+y<height;y++) {
      prior.fill(0);
      const targetY=orientation>=3?height-1-y0-y:y0+y;
      for(let x=0;x<columns && x0+x<width;x++) {
        const targetX=orientation===2||orientation===3?width-1-x0-x:x0+x;
        for(let lane=0;lane<lanes;lane++) {
          let sample=raw[method](((y*columns+x)*lanes+lane)*bps);
          if (predictor===2) sample=prior[lane]=(sample+prior[lane])&max;
          const c=planar===1?lane:Math.floor(i/blocks);
          if (color===0 && c===0) sample=max-sample;
          if (!Number.isFinite(sample)) throw new RangeError('TIFF texture contains nonfinite samples');
          data[(targetY*width+targetX)*channels+c]=sample;
        }
      }
    }
  }
  return { ...info,data };
}

function write(image, value, compression='zip') {
  const {width,height,channels,depth,data}=C.checkedRaster(image), bps=depth/8;
  if (!['none','zip'].includes(compression)) throw new TypeError('TIFF texture compression is none or zip');
  const alpha=image.alpha??(channels%2?'none':'straight');
  if (!['none','straight','premultiplied'].includes(alpha)||channels%2&&alpha!=='none')
    throw new TypeError('TIFF texture alpha needs an extra sample lane');
  const {bytes:icc,chromaticities,gamma,srgb}=C.profile(value);
  C.profileMode(icc,channels);
  if (gamma!==undefined || srgb!==undefined) throw new TypeError('Use an ICC profile or chromaticities to tag TIFF textures');
  if (chromaticities?.some(n=>n<0||n>1)) throw new RangeError('TIFF chromaticities need normalized coordinates');
  const rows=Math.min(32,height), stripes=[];
  for(let y=0;y<height;y+=rows) {
    const count=Math.min(rows,height-y)*width*channels, start=y*width*channels;
    const raw=Buffer.allocUnsafe(count*bps);
    const method=depth===32?'writeFloatLE':depth===16?'writeUInt16LE':'writeUInt8';
    for(let i=0;i<count;i++) raw[method](data[start+i],i*bps);
    stripes.push(compression==='zip'?deflateSync(raw):raw);
  }
  const tags=[];
  function tag(id,type,values) {
    const bytes=Buffer.isBuffer(values)?values:Buffer.alloc(values.length*sizes[type]);
    if (!Buffer.isBuffer(values)) for(let i=0;i<values.length;i++) {
      const at=i*sizes[type];
      if (type===3) bytes.writeUInt16LE(values[i],at);
      else if (type===4) bytes.writeUInt32LE(values[i],at);
      else { bytes.writeUInt32LE(Math.round(values[i]*1e6),at); bytes.writeUInt32LE(1e6,at+4); }
    }
    const row={id,type,bytes};tags.push(row);return row;
  }
  const s=(id,v)=>tag(id,3,[v]), l=(id,v)=>tag(id,4,[v]);
  l(256,width); l(257,height); tag(258,3,new Array(channels).fill(depth));
  s(259,compression==='zip'?8:1); s(262,channels>2?2:1);
  const offsets=tag(273,4,stripes.map(()=>0));
  s(274,1); s(277,channels); l(278,rows); tag(279,4,stripes.map(v=>v.length));
  s(284,1);
  if (['srgb','srgb-linear','display-p3','display-p3-linear'].includes(image.colorSpace))
    tag(270,2,Buffer.from('Ink Studio color space: '+image.colorSpace+'\0'));
  if (chromaticities) { tag(318,5,chromaticities.slice(6)); tag(319,5,chromaticities.slice(0,6)); }
  if (channels%2===0) s(338,alpha==='premultiplied'?1:alpha==='straight'?2:0);
  tag(339,3,new Array(channels).fill(depth===32?3:1));
  if (icc) tag(34675,7,icc);
  tags.sort((a,b)=>a.id-b.id);
  const header=Buffer.alloc(14+tags.length*12), metadata=[];
  header.write('II',0); header.writeUInt16LE(42,2); header.writeUInt32LE(8,4); header.writeUInt16LE(tags.length,8);
  let at=header.length;
  for(const row of tags) if (row.bytes.length>4) {
    row.offset=at; at+=row.bytes.length+(row.bytes.length&1);
  }
  for(let i=0;i<stripes.length;i++) { offsets.bytes.writeUInt32LE(at,4*i); at+=stripes[i].length; }
  if (at>C.maxBytes) throw new RangeError('TIFF export exceeds its byte budget');
  tags.forEach(({id,type,bytes,offset},i)=>{
    const p=10+i*12;
    header.writeUInt16LE(id,p); header.writeUInt16LE(type,p+2); header.writeUInt32LE(bytes.length/sizes[type],p+4);
    if (offset===undefined) bytes.copy(header,p+8);
    else {
      header.writeUInt32LE(offset,p+8); metadata.push(bytes);
      if (bytes.length&1) metadata.push(Buffer.alloc(1));
    }
  });
  return Buffer.concat([header,...metadata,...stripes],at);
}

module.exports = { read, write };
