const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { setTimeout: wait } = require('node:timers/promises');
const { encodeArtDmx, encodeSacn, decodeArtTimeCode, encodeOsc, decodeOsc } = require('../cli/show-protocols');
const { createShowBridge } = require('..');

test('MIDI Beat Clock follows position, transport, tempo and packet gaps', async () => {
  const { createMidiBeatClock, sampleLinkClock } = await import('../show-control.mjs');
  const clock = createMidiBeatClock();
  clock.push([0xfa], 10);
  for (let i = 0; i <= 48; i++) clock.push([0xf8], 10 + i / 48);
  const state = clock.sample(11);
  assert.equal(state.beat, 2);
  assert(Math.abs(state.bpm - 120) < 1e-8);
  assert.equal(state.locked, true);
  clock.push([0xfc], 11.01);
  assert.equal(clock.sample(11.2).beat, 2);
  assert.equal(clock.sample(12).locked, false);
  clock.push([0xf2, 20, 0], 12);
  clock.push([0xfb], 12);
  clock.push([0xf8], 12);
  assert.equal(clock.sample(12).beat, 5);
  const link = sampleLinkClock({ bpm: 90, beat: 19.25, sentAt: 1000, playing: true, peers: 2 }, 1250);
  assert.equal(link.beat, 19.625);
  assert.equal(link.phase, .625);
  assert.equal(sampleLinkClock({ bpm: 90, beat: 0, sentAt: 1000, playing: false, peers: 0 }, 2000).locked, false);
});

test('SMPTE drop-frame arithmetic, incoming MIDI full and reverse quarter-frame timecode', async () => {
  const { readTimecode, timecodeAt, createMidiTimecode } = await import('../show-control.mjs');
  const fps = 30000 / 1001;
  assert.equal(timecodeAt(1800, { fps, drop: true }).label, '00:01:00;02');
  assert.equal(timecodeAt(17982, { fps, drop: true }).label, '00:10:00;00');
  assert.equal(timecodeAt(-1, { fps, drop: true }).label, '23:59:59;29');
  assert.throws(() => readTimecode({ hours: 0, minutes: 1, seconds: 0, frames: 1, fps, drop: true }), /Invalid SMPTE/);
  const receiver = createMidiTimecode();
  const full = receiver.push([0xf0, 0x7f, 0x7f, 1, 1, 0x41, 2, 3, 4, 0xf7]);
  assert.equal(full.label, '01:02:03;04');
  const nibbles = [4,0,3,0,2,0,1,4];
  let code;
  for (let i = 0; i < 8; i++) code = receiver.push([0xf1, 16 * i + nibbles[i]]);
  assert.equal(code.label, '01:02:03;06');
  for (let i = 7; i >= 0; i--) code = receiver.push([0xf1, 16 * i + nibbles[i]]);
  assert.equal(code.label, '01:02:03;02');
});

test('LTC decodes irregular PCM blocks at integer and drop-frame rates', async () => {
  const { createLtcDecoder } = await import('../show-control.mjs');
  const { makeLtcLoop } = await import('../examples/live-show/signals.mjs');
  const context = { sampleRate: 44100, createBuffer: (channels, length) => {
    const signal = new Float32Array(length);
    return { getChannelData: () => signal };
  } };
  for (const fps of [24, 25, 30, 30000 / 1001]) {
    const pcm = makeLtcLoop(context, fps).getChannelData(0).map((sample, i) => -sample + Math.sin(i * 2) * .06);
    const decoder = createLtcDecoder({ sampleRate: context.sampleRate, fps });
    const codes = [];
    for (let i = 17; i < pcm.length; i += 257) codes.push(...decoder.push(pcm.subarray(i, i + 257)));
    assert(codes.length >= Math.round(fps) * 4 - 3);
    assert.equal(codes[0].hours, 1);
    assert.equal(codes[0].drop, fps === 30000 / 1001);
    for (let i = 1; i < codes.length; i++) assert.equal(codes[i].frame - codes[i-1].frame, 1);
  }
});

test('projection maps skewed corners and rejects concave or collinear surfaces', async () => {
  const { projectionHomography, projectionPoint } = await import('../show-control.mjs');
  const corners = [[.22,.11],[.92,.04],[.88,.81],[.07,.75]], expected = [[0,0],[1,0],[1,1],[0,1]];
  const matrix = projectionHomography(corners);
  for (const [i, point] of corners.entries()) {
    const uv = projectionPoint(matrix, point);
    assert(uv.every((value, j) => Math.abs(value - expected[i][j]) < 1e-9));
  }
  assert.throws(() => projectionHomography([corners[0], corners[2], corners[1], corners[3]]), /convex/);
});

test('DMX, Art-Net, sACN and OSC packet fields match their wire layouts', async () => {
  const { patchDmx } = await import('../show-control.mjs');
  const fixture = { id: 'wash', address: 510, channels: ['r', 'g', 'b'] };
  const channels = patchDmx([fixture], { wash: { r: 1, g: .5 } });
  assert.deepEqual([...channels.slice(-3)], [255,128,0]);
  assert.throws(() => patchDmx([fixture, { ...fixture, id: 'fill' }], {}), /Overlapping/);
  const art = encodeArtDmx({ universe: 0x1234, sequence: 7, channels: Uint8Array.of(255,128,0) });
  assert.equal(art.toString('hex'), '4172742d4e6574000050000e070034120004ff800000');
  const sacn = encodeSacn({ cid: new Uint8Array(16).fill(9), universe: 7, sequence: 6, channels, terminated: true });
  assert.equal(sacn.length, 638);
  assert.equal(sacn.readUInt16BE(16), 0x726e);
  assert.equal(sacn.readUInt16BE(38), 0x7258);
  assert.equal(sacn.readUInt16BE(115), 0x720b);
  assert.equal(sacn.readUInt16BE(113), 7);
  assert.equal(sacn[112], 0x40);
  assert.deepEqual([...sacn.slice(-3)], [255,128,0]);
  const packet = encodeOsc('/light/level', [.25, 17, 'warm', true, false]);
  assert.deepEqual(decodeOsc(packet), { address: '/light/level', args: [.25,17,'warm',true,false] });
  assert.throws(() => decodeOsc(packet.subarray(0, -4)), /Invalid|Truncated|Unterminated/);
  const time = Buffer.from('4172742d4e6574000097000e00000403020102', 'hex');
  assert.deepEqual(decodeArtTimeCode(time), { hours:1, minutes:2, seconds:3, frames:4, fps:30000/1001, drop:true });
});

test('the bridge sends real loopback UDP only while armed and rejects stale leases', async t => {
  const receiver = dgram.createSocket('udp4'), inbox = [];
  receiver.on('message', packet => inbox.push(packet));
  await new Promise(resolve => receiver.bind(0, '127.0.0.1', resolve));
  t.after(() => receiver.close());
  const destination = { host: '127.0.0.1', port: receiver.address().port };
  const bridge = await createShowBridge({ port: 0, oscInput: 0, artTimecodeInput: 0, leaseMs: 250,
    dmx: { ...destination, protocol:'artnet', universe:19 }, oscOutput: destination });
  t.after(() => bridge.close());
  const { connectShowBridge } = await import('../show-control.mjs');
  const client = await connectShowBridge(bridge.url);
  async function until(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await wait(10);
    }
    assert.fail('Expected show bridge state');
  }
  const levels = new Uint8Array(512);
  levels[0] = 155;
  await assert.rejects(client.dmx(levels), /Arm/);
  assert.equal(inbox.length, 0);
  assert.equal((await fetch(bridge.url + '/package.json')).status, 404);
  assert.equal((await fetch(bridge.url + '/show/session', { headers: { Origin:'https://example.com' } })).status, 403);
  await client.arm();
  await client.dmx(levels);
  await until(() => inbox.some(packet => packet[18] === 155));
  const lit = inbox.find(packet => packet[18] === 155);
  assert.equal(lit.readUInt16LE(14), 19);
  await until(() => inbox.length > 1 && inbox.at(-1)[18] === 0);
  await assert.rejects(client.dmx(levels), /must be armed/);
  await client.osc('/control/cue', [2]);
  await until(() => inbox.some(packet => packet[0] === 47));
  assert.deepEqual(decodeOsc(inbox.find(packet => packet[0] === 47)), { address:'/control/cue', args:[2] });
  receiver.send(encodeOsc('/ink/link', [123, 8.5, true, 2]), bridge.oscPort, '127.0.0.1');
  await until(async () => (await client.read()).link?.bpm === 123);
  receiver.send(Buffer.from('4172742d4e6574000097000e00000403020102', 'hex'), bridge.artTimecodePort, '127.0.0.1');
  await until(async () => (await client.read()).timecode?.label === '01:02:03;04');
});

test('sACN output stops with terminated blackout packets on disarm', async t => {
  const receiver = dgram.createSocket('udp4'), packets = [];
  receiver.on('message', data => packets.push(data));
  await new Promise(resolve => receiver.bind(0, '127.0.0.1', resolve));
  t.after(() => receiver.close());
  const bridge = await createShowBridge({ port:0, oscInput:0, dmx:{
    host:'127.0.0.1', port: receiver.address().port, protocol:'sacn', universe:8
  } });
  t.after(() => bridge.close());
  const { connectShowBridge } = await import('../show-control.mjs');
  const client = await connectShowBridge(bridge.url);
  await client.arm();
  await client.dmx(new Uint8Array(512).fill(144));
  for (let i = 0; i < 100 && !packets.some(data => data[126] === 144); i++) await wait(10);
  assert(packets.some(data => data.readUInt16BE(113) === 8 && data[126] === 144));
  await client.disarm();
  for (let i = 0; i < 100 && packets.filter(data => data[112] === 64).length < 3; i++) await wait(10);
  assert.equal(packets.filter(data => data[112] === 64 && data[126] === 0).length, 3);
});
