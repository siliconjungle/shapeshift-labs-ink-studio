// The supported KTX2 profile is an opaque, single-level, 2D BC1 RGB texture.
const identifier = [0xab,0x4b,0x54,0x58,0x20,0x32,0x30,0xbb,0x0d,0x0a,0x1a,0x0a];
const rgbSrgb = 132;
const dfdOffset = 104, dfdLength = 44, dataOffset = 152;
const dimension = value => Number.isInteger(value) && value >= 4 && value <= 2048 && value % 4 === 0;

function rgb565(r,g,b) {
  return Math.round(r*31/255)*2048 + Math.round(g*63/255)*32 + Math.round(b*31/255);
}

function palette(a,b,colors) {
  for (let i=0;i<2;i++) {
    const color=i ? b : a, r=color>>11, g=color>>5&63, blue=color&31;
    colors.set([r<<3|r>>2,g<<2|g>>4,blue<<3|blue>>2],i*3);
  }
  for(let c=0;c<3;c++) {
    colors[6+c] = a>b ? Math.floor((2*colors[c]+colors[3+c]+1)/3) : (colors[c]+colors[3+c])>>1;
    colors[9+c] = a>b ? Math.floor((colors[c]+2*colors[3+c]+1)/3) : 0;
  }
}

function error(r,g,b,x,y,z) {
  return (r-x)**2 + 2*(g-y)**2 + (b-z)**2;
}

export function encodeKTX2BC1({width,height,pixels} = {}) {
  if(!dimension(width)||!dimension(height)||!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)
    throw new RangeError('BC1 needs RGBA8 pixels and dimensions divisible by four, from 4 to 2048');
  const length=width*height/2, bytes=new Uint8Array(dataOffset+length), dv=new DataView(bytes.buffer);
  bytes.set(identifier);
  const header=[rgbSrgb,1,width,height,0,0,1,1,0,dfdOffset,dfdLength];
  header.forEach((value,i)=>dv.setUint32(12+i*4,value,true));
  [dataOffset,length,length].forEach((value,i)=>dv.setBigUint64(80+i*8,BigInt(value),true));
  // Khronos basic DFD: BC1 color, BT.709 primaries, sRGB transfer, 4 × 4 × 1 blocks.
  dv.setUint32(dfdOffset,dfdLength,true);
  dv.setUint16(dfdOffset+8,2,true);
  dv.setUint16(dfdOffset+10,40,true);
  bytes.set([128,1,2,0,3,3,0,0,8],dfdOffset+12);
  bytes[dfdOffset+30]=63;
  dv.setUint32(dfdOffset+40,0xffffffff,true);

  const points=new Uint8Array(48), colors=new Uint8Array(12);
  for(let y=0,offset=dataOffset;y<height;y+=4) for(let x=0;x<width;x+=4,offset+=8) {
    for(let i=0;i<16;i++) {
      const at=((y+(i>>2))*width+x+(i&3))*4;
      if(pixels[at+3]!==255) throw new RangeError('BC1 requires opaque color. Use lossless delivery for cutouts');
      points.set(pixels.subarray(at,at+3),i*3);
    }
    let farthest=-1, a=0, b=0;
    for(let i=0;i<48;i+=3) for(let j=i+3;j<48;j+=3) {
      const distance=error(points[i],points[i+1],points[i+2],points[j],points[j+1],points[j+2]);
      if(distance>farthest){farthest=distance;a=i;b=j;}
    }
    a=rgb565(points[a],points[a+1],points[a+2]);
    b=rgb565(points[b],points[b+1],points[b+2]);
    if(a<b)[a,b]=[b,a];
    if(a===b){if(a===0)a++;else b--;}
    palette(a,b,colors);
    let selectors=0;
    for(let i=0;i<16;i++) {
      let nearest=Infinity, choice=0;
      for(let c=0;c<4;c++) {
        const distance=error(points[i*3],points[i*3+1],points[i*3+2],colors[c*3],colors[c*3+1],colors[c*3+2]);
        if(distance<nearest){nearest=distance;choice=c;}
      }
      selectors|=choice<<(2*i);
    }
    dv.setUint16(offset,a,true);
    dv.setUint16(offset+2,b,true);
    dv.setUint32(offset+4,selectors,true);
  }
  return bytes;
}

export function readKTX2BC1(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length<dataOffset||!identifier.every((n,i)=>n===bytes[i]))
    throw new TypeError('Expected KTX2 texture bytes');
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u32=offset=>dv.getUint32(offset,true);
  const width=u32(20), height=u32(24), blockLength=width*height/2;
  if(!dimension(width)||!dimension(height)||u32(12)!==rgbSrgb||u32(16)!==1||u32(28)||u32(32)||
      u32(36)!==1||u32(40)!==1||u32(44)||u32(56)||u32(60)||dv.getBigUint64(64,true)||dv.getBigUint64(72,true))
    throw new RangeError('Expected one opaque BC1 sRGB KTX2 level with default orientation and no metadata');
  const dfd=u32(48), length=u32(52), offset=Number(dv.getBigUint64(80,true));
  if(dfd!==dfdOffset||length!==dfdLength||u32(dfd)!==length||u32(dfd+12)!==0x00020180||
      u32(dfd+16)!==0x0303||u32(dfd+20)!==8||
      !Number.isSafeInteger(offset)||offset<dfd+length||offset%8||offset+blockLength!==bytes.length||
      dv.getBigUint64(88,true)!==BigInt(blockLength)||dv.getBigUint64(96,true)!==BigInt(blockLength))
    throw new RangeError('Invalid BC1 KTX2 level index or format descriptor');
  return { width,height,blocks:bytes.subarray(offset) };
}

export function decodeBC1({width,height,blocks}) {
  const data=new DataView(blocks.buffer,blocks.byteOffset,blocks.length);
  const pixels=new Uint8Array(width*height*4), colors=new Uint8Array(12);
  for(let y=0,offset=0;y<height;y+=4) for(let x=0;x<width;x+=4,offset+=8) {
    palette(data.getUint16(offset,true),data.getUint16(offset+2,true),colors);
    const selectors=data.getUint32(offset+4,true);
    for(let i=0;i<16;i++) {
      const dest=((y+(i>>2))*width+x+(i&3))*4, c=(selectors>>>(2*i)&3)*3;
      pixels[dest]=colors[c];
      pixels[dest+1]=colors[c+1];
      pixels[dest+2]=colors[c+2];
      pixels[dest+3]=255;
    }
  }
  return pixels;
}
