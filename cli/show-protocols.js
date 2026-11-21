const ARTNET = Buffer.from('Art-Net\0', 'ascii');
const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const oscAddress = address => typeof address === 'string' && /^\/[A-Za-z0-9_.~/-]{1,255}$/.test(address);
const MAX_OSC = 8192;

function oscString(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new TypeError('OSC text must be a string without nulls');
  const size = Buffer.byteLength(text);
  if (size > MAX_OSC) throw new RangeError('OSC text exceeds the message limit');
  const bytes = Buffer.alloc(Math.ceil((size + 1) / 4) * 4);
  bytes.write(text);
  return bytes;
}

function encodeOsc(address, args = []) {
  if (!oscAddress(address) || !Array.isArray(args) || args.length > 64) throw new TypeError('Invalid OSC address or arguments');
  const tags = [], data = [];
  for (const value of args) {
    if (typeof value === 'string') {
      tags.push('s');
      data.push(oscString(value));
    } else if (typeof value === 'boolean') {
      tags.push(value ? 'T' : 'F');
    } else if (Number.isFinite(Math.fround(value)) && typeof value === 'number') {
      const bytes = Buffer.alloc(4);
      if (int(value, -2147483648, 2147483647)) {
        tags.push('i'); bytes.writeInt32BE(value);
      } else {
        tags.push('f'); bytes.writeFloatBE(value);
      }
      data.push(bytes);
    } else {
      throw new TypeError('OSC arguments must be strings, booleans or finite numbers');
    }
  }
  const packet = Buffer.concat([oscString(address), oscString(',' + tags.join('')), ...data]);
  if (packet.length > MAX_OSC) throw new RangeError('OSC packet exceeds the message limit');
  return packet;
}

function decodeOsc(packet) {
  if (!Buffer.isBuffer(packet) || packet.length > MAX_OSC || packet.length % 4) throw new RangeError('Invalid OSC packet length');
  let offset = 0;
  function string() {
    const end = packet.indexOf(0, offset);
    if (end < offset) throw new Error('Unterminated OSC string');
    const value = packet.toString('utf8', offset, end);
    offset = Math.ceil((end + 1) / 4) * 4;
    if (offset > packet.length || packet.subarray(end, offset).some(Boolean)) throw new Error('Invalid OSC string padding');
    return value;
  }
  const address = string(), tags = string();
  if (!oscAddress(address) || !/^,[ifsTF]{0,64}$/.test(tags)) throw new Error('Invalid or unsupported OSC message');
  const args = [];
  for (const tag of tags.slice(1)) {
    if (tag === 's') args.push(string());
    else if (tag === 'T' || tag === 'F') args.push(tag === 'T');
    else {
      if (offset + 4 > packet.length) throw new Error('Truncated OSC number');
      const value = tag === 'i' ? packet.readInt32BE(offset) : packet.readFloatBE(offset);
      if (!Number.isFinite(value)) throw new Error('Non-finite OSC number');
      args.push(value);
      offset += 4;
    }
  }
  if (offset !== packet.length) throw new Error('Unexpected trailing OSC data');
  return { address, args };
}

function encodeArtDmx({ universe = 0, sequence = 0, channels }) {
  if (!int(universe, 0, 32767) || !int(sequence, 0, 255) || !(channels instanceof Uint8Array) ||
      channels.length < 1 || channels.length > 512) throw new RangeError('Invalid Art-Net universe, sequence or channels');
  const length = channels.length + (channels.length & 1);
  const packet = Buffer.alloc(18 + length);
  ARTNET.copy(packet);
  packet.writeUInt16LE(0x5000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = sequence;
  packet.writeUInt16LE(universe, 14);
  packet.writeUInt16BE(length, 16);
  Buffer.from(channels).copy(packet, 18);
  return packet;
}

function decodeArtTimeCode(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 19 || !packet.subarray(0, 8).equals(ARTNET) ||
      packet.readUInt16LE(8) !== 0x9700 || packet.readUInt16BE(10) < 14 || !int(packet[18], 0, 3)) return null;
  const [frames, seconds, minutes, hours, type] = packet.subarray(14, 19);
  return { frames, seconds, minutes, hours, fps: [24, 25, 30000 / 1001, 30][type], drop: type === 2 };
}

function encodeSacn({ cid, universe = 1, sequence = 0, channels, source = 'Ink Studio', priority = 100, terminated = false }) {
  if (!(cid instanceof Uint8Array) || cid.length !== 16 || !int(universe, 1, 63999) || !int(sequence, 0, 255) ||
      !int(priority, 0, 200) || typeof source !== 'string' || source.includes('\0') || Buffer.byteLength(source) > 63 ||
      !(channels instanceof Uint8Array) || channels.length < 1 || channels.length > 512)
    throw new RangeError('Invalid sACN source, universe, sequence or channels');
  const packet = Buffer.alloc(126 + channels.length);
  packet.writeUInt16BE(16, 0);
  packet.write('ASC-E1.17', 4, 'ascii');
  for (const offset of [16, 38, 115]) packet.writeUInt16BE(0x7000 | (packet.length - offset), offset);
  packet.writeUInt32BE(4, 18);
  Buffer.from(cid).copy(packet, 22);
  packet.writeUInt32BE(2, 40);
  packet.write(source, 44, 63);
  packet[108] = priority;
  packet[111] = sequence;
  packet[112] = terminated ? 0x40 : 0;
  packet.writeUInt16BE(universe, 113);
  packet[117] = 2;
  packet[118] = 0xa1;
  packet.writeUInt16BE(1, 121);
  packet.writeUInt16BE(channels.length + 1, 123);
  Buffer.from(channels).copy(packet, 126);
  return packet;
}

module.exports = { encodeArtDmx, encodeSacn, decodeArtTimeCode, encodeOsc, decodeOsc };
