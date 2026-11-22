/* Native little-endian RIFF/WAVE I/O for normalized, interleaved audio. */
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const maxSamples = 32000000;
const maxBytes = 8 * maxSamples + 65536;
const pcmSubtypeTail = Buffer.from([0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]);
const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function shape({ sampleRate, channels, samples } = {}) {
  if (!int(sampleRate, 1, 768000) || !int(channels, 1, 64) ||
      !(Array.isArray(samples) || ArrayBuffer.isView(samples)) ||
      !int(samples.length, 0, maxSamples) || samples.length % channels)
    throw new TypeError('Audio needs a sample rate, channel count and bounded interleaved samples');
  return { sampleRate, channels, samples };
}

function readFormat(bytes,start,size) {
  if (size < 16) throw new RangeError('Invalid WAV format chunk');
  let kind = bytes.readUInt16LE(start);
  const channels = bytes.readUInt16LE(start + 2), sampleRate = bytes.readUInt32LE(start + 4);
  const align = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14);
  if (kind === 65534) {
    if (size < 40 || bytes.readUInt16LE(start + 16) < 22 || bytes.readUInt16LE(start + 18) > bits ||
        !bytes.subarray(start + 28, start + 40).equals(pcmSubtypeTail))
      throw new RangeError('Unsupported WAVEFORMATEXTENSIBLE subtype');
    kind = bytes.readUInt32LE(start + 24);
  }
  if (!int(channels, 1, 64) || !int(sampleRate, 1, 768000) || align !== bits / 8 * channels ||
      bytes.readUInt32LE(start + 8) !== sampleRate * align ||
      !(kind === 1 && [8, 16, 24, 32].includes(bits) || kind === 3 && [32, 64].includes(bits)))
    throw new RangeError('Unsupported WAV format. Use PCM or IEEE floating point');
  return { kind, bits, align, sampleRate, channels };
}

function decode(source, { metadata = false } = {}) {
  if (!(source instanceof Uint8Array)) throw new TypeError('WAV decoding needs bytes');
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (bytes.length < 12 || bytes.length > maxBytes || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE') throw new TypeError('Expected a bounded little-endian RIFF/WAVE file');
  const end = bytes.readUInt32LE(4) + 8;
  if (end < 12 || end > bytes.length) throw new RangeError('Truncated WAV container');
  const chunks = [];
  let format, bwf;
  for (let at = 12, count = 0; at < end;) {
    if (at + 8 > end || ++count > 65536) throw new RangeError('Invalid WAV chunk table');
    const tag = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    at = start + size + (size & 1);
    if (at > end) throw new RangeError('Truncated or unpadded WAV chunk ' + tag);
    if (tag === 'fmt ') {
      if (format) throw new RangeError('Duplicate WAV format chunk');
      format = readFormat(bytes,start,size);
    }
    if (metadata && tag === 'bext') {
      if (bwf || size < 602) throw new RangeError('Invalid Broadcast Wave metadata');
      const text = (offset, length) => bytes.toString('ascii', start + offset, start + offset + length).split('\0')[0];
      bwf = { description: text(0, 256), originator: text(256, 32), originatorReference: text(288, 32),
        date: text(320, 10), time: text(330, 8), timeReference: bytes.readBigUInt64LE(start + 338).toString(),
        version: bytes.readUInt16LE(start + 346) };
    }
    if (tag === 'data') chunks.push([start, size]);
  }
  if (!format || !chunks.length) throw new RangeError('WAV needs format and data chunks');
  const { kind, bits, align, sampleRate, channels } = format, stride = bits / 8;
  let count = 0;
  for (const [, length] of chunks) {
    if (length % align || (count += length / stride) > maxSamples) throw new RangeError('Invalid WAV frame alignment or audio budget');
  }
  const samples = new Float64Array(count), signedScale = 2 ** (bits - 1);
  let i = 0;
  for (const [start, length] of chunks) for (let at = start; at < start + length; at += stride) {
    samples[i++] = readSample(bytes,at,kind,bits,stride,signedScale);
  }
  return { sampleRate, channels, samples, ...(bwf && { bwf }) };
}

function readSample(bytes,at,kind,bits,stride,signedScale) {
  const n = kind === 3 ? bits === 32 ? bytes.readFloatLE(at) : bytes.readDoubleLE(at) :
    bits === 8 ? (bytes[at] - 128) / 128 : bytes.readIntLE(at, stride) / signedScale;
  if (!Number.isFinite(n)) throw new RangeError('WAV contains a nonfinite PCM sample');
  return Math.max(-1, Math.min(1, n));
}

const encodings = Object.freeze({ pcm8: [1, 8], pcm16: [1, 16], pcm24: [1, 24], pcm32: [1, 32],
  float32: [3, 32], float64: [3, 64] });

function broadcastExtension(bwf, sampleRate, channels, bits) {
  const ascii = (value, size) => typeof value === 'string' && value.length <= size && /^[ -~]*$/.test(value);
  const { description = '', originator = 'Ink Studio', originatorReference = '',
    date = '', time = '', timeReference = 0 } = bwf;
  if (!ascii(description, 256) || !ascii(originator, 32) || !ascii(originatorReference, 32) ||
      !ascii(date, 10) || date && !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !ascii(time, 8) || time && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time) ||
      !(int(timeReference, 0, Number.MAX_SAFE_INTEGER) || typeof timeReference === 'bigint' ||
        typeof timeReference === 'string' && /^\d{1,20}$/.test(timeReference)))
    throw new TypeError('Invalid Broadcast Wave origin or time reference');
  const reference = BigInt(timeReference);
  if (reference < 0n || reference >= 2n ** 64n) throw new RangeError('Broadcast Wave time reference exceeds 64 bits');
  const history=Buffer.from(`A=PCM,F=${sampleRate},W=${bits},M=${channels === 1 ? 'mono' : channels === 2 ? 'stereo' : 'multichannel'}\r\n`, 'ascii');
  const length=602+history.length, chunk=Buffer.alloc(8+length+(length & 1));
  chunk.write('bext',0);
  chunk.writeUInt32LE(length,4);
  for (const [value,offset] of [[description,0],[originator,256],[originatorReference,288],[date,320],[time,330]])
    chunk.write(value,8+offset,'ascii');
  chunk.writeBigUInt64LE(reference,8+338);
  chunk.writeUInt16LE(1,8+346);
  history.copy(chunk,8+602);
  return chunk;
}

function encode(source, { encoding = 'pcm16', bwf } = {}) {
  const { sampleRate, channels, samples } = shape(source);
  if (!Object.hasOwn(encodings, encoding)) throw new RangeError('Unsupported WAV encoding ' + encoding);
  const [kind, bits] = encodings[encoding], stride = bits / 8, align = stride * channels;
  if (bwf !== undefined && (kind !== 1 || !bwf || typeof bwf !== 'object'))
    throw new TypeError('Broadcast Wave export needs a PCM encoding and metadata');
  const extension = bwf === undefined ? null : broadcastExtension(bwf,sampleRate,channels,bits);
  const extensible = channels > 2, fmtSize = extensible ? 40 : kind === 3 ? 18 : 16;
  const dataLength = samples.length * stride, hasFact = kind === 3, header = 12 + 8 + fmtSize + (hasFact ? 12 : 0) + (extension?.length ?? 0) + 8;
  const bytes = Buffer.alloc(header + dataLength + (dataLength & 1));
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(fmtSize, 16);
  bytes.writeUInt16LE(extensible ? 65534 : kind, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * align, 28);
  bytes.writeUInt16LE(align, 32);
  bytes.writeUInt16LE(bits, 34);
  if (extensible) {
    bytes.writeUInt16LE(22, 36);
    bytes.writeUInt16LE(bits, 38);
    bytes.writeUInt32LE(kind, 44);
    pcmSubtypeTail.copy(bytes, 48);
  }
  if (hasFact) {
    bytes.write('fact', header - 20);
    bytes.writeUInt32LE(4, header - 16);
    bytes.writeUInt32LE(samples.length / channels, header - 12);
  }
  if (extension) extension.copy(bytes,header-8-extension.length);
  bytes.write('data', header - 8);
  bytes.writeUInt32LE(dataLength, header - 4);
  const signedScale = 2 ** (bits - 1);
  for (let i = 0, at = header; i < samples.length; i++, at += stride) {
    const n = samples[i];
    if (!Number.isFinite(n) || Math.abs(n) > 1) throw new RangeError('WAV encode needs finite normalized samples');
    if (kind === 3) {
      if (bits === 32) bytes.writeFloatLE(n, at);
      else bytes.writeDoubleLE(n, at);
    } else {
      const value = Math.min(signedScale - 1, Math.round(n * signedScale));
      if (bits === 8) bytes[at] = 128 + value;
      else bytes.writeIntLE(value, at, stride);
    }
  }
  return bytes;
}

function read(file, options) {
  if (fs.statSync(file).size > maxBytes) throw new RangeError('WAV file exceeds the audio budget');
  const bytes=fs.readFileSync(file);
  if (options?.sha256!==undefined && createHash('sha256').update(bytes).digest('hex')!==options.sha256)
    throw new RangeError('WAV hash does not match its reference');
  return decode(bytes, options);
}

// Read the RIFF table once, then fetch only the sample ranges requested by the audio host.
async function openPages(file) {
  const handle=await fs.promises.open(file,'r');
  async function readExact(start,count) {
    const bytes=Buffer.alloc(count);
    for (let i=0;i<count;) {
      const {bytesRead}=await handle.read(bytes,i,count-i,start+i);
      if (!bytesRead) throw new RangeError('Truncated WAV');
      i+=bytesRead;
    }
    return bytes;
  }
  try {
    const header=await readExact(0,12), {size}=await handle.stat();
    if (header.toString('ascii',0,4)!=='RIFF' || header.toString('ascii',8,12)!=='WAVE')
      throw new TypeError('Expected a little-endian RIFF/WAVE file');
    const end=header.readUInt32LE(4)+8;
    if (end<12 || end>size) throw new RangeError('Truncated WAV container');
    const chunks=[];
    let format;
    for (let at=12, count=0;at<end;) {
      if (at+8>end || ++count>4096) throw new RangeError('Invalid WAV chunk table');
      const chunk=await readExact(at,8), tag=chunk.toString('ascii',0,4);
      const size=chunk.readUInt32LE(4), start=at+8;
      at=start+size+(size&1);
      if (at>end) throw new RangeError('Truncated WAV chunk '+tag);
      if (tag==='fmt ') {
        if (format) throw new RangeError('Duplicate WAV format chunk');
        format=readFormat(await readExact(start,Math.min(size,40)),0,size);
      }
      if (tag==='data') chunks.push({start,size});
    }
    if (!format || !chunks.length) throw new RangeError('WAV needs format and data chunks');
    const {kind,bits,align,sampleRate,channels}=format, stride=bits/8, scale=2**(bits-1);
    let frames=0;
    for (const chunk of chunks) {
      if (chunk.size%align) throw new RangeError('Invalid WAV frame alignment');
      chunk.first=frames;
      frames+=chunk.size/align;
      chunk.last=frames;
    }
    async function readPage(first,count) {
      if (!int(first,0,frames-1) || !int(count,1,Math.min(16384,frames-first)))
        throw new RangeError('Invalid WAV page range');
      const samples=new Float32Array(count*channels);
      let written=0;
      for (const chunk of chunks) {
        const start=Math.max(first,chunk.first), size=Math.min(first+count,chunk.last)-start;
        if (size<=0) continue;
        const bytes=await readExact(chunk.start+(start-chunk.first)*align,size*align);
        for (let at=0;at<bytes.length;at+=stride) samples[written++]=readSample(bytes,at,kind,bits,stride,scale);
      }
      return samples;
    }
    return {sampleRate,channels,frames,readPage,close:()=>handle.close()};
  } catch (error) {
    await handle.close();
    throw error;
  }
}

module.exports = { decode, encode, read, openPages, maxSamples, maxBytes, encodings: Object.freeze(Object.keys(encodings)) };
