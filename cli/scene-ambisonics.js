/* First-order ACN/SN3D handoff on the scene's absolute sample clock. */
const WAV = require('./wav.js');
const { addRoomResponse } = require('./scene-room-response.js');
const { sumVoices } = require('./scene-audio-mix.js');
const { sceneRole } = require('./scene-audio-post.js');

const folder = 'ambisonic';
const roles = ['ambience', 'effects', 'dialogue', 'foley'];
const filenames = { field: 'ambience-ambix', dialogue: 'dialogue', foley: 'close-foley' };
const channelOrder = ['W', 'Y', 'Z', 'X'];
const axes = { front: [0, 0, -1], left: [-1, 0, 0], up: [0, 1, 0] };
const spread = Math.SQRT1_2;
const foreground = name => name === 'dialogue' || name === 'foley';
const environment = name => name === 'ambience' || name === 'effects';

function direction(position, source) {
  return [position[0] - source[0], source[1] - position[1], position[2] - source[2]];
}

function writer({ start, end, sampleRate, roomResponse }) {
  const frames = end - start, historyStart = Math.min(start, roomResponse?.path[0]?.sample ?? start);
  const historyFrames = roomResponse ? end - historyStart : 0;
  if (!Number.isSafeInteger(frames) || start < 0 || frames <= 0 ||
      10 * frames + 2 * historyFrames > WAV.maxSamples)
    throw new RangeError('Ambisonic handoff exceeds its PCM sample budget');
  const field = new Float32Array(frames * 4);
  const dialogue = new Float32Array(frames * 2), foley = new Float32Array(frames * 2);
  const room = roomResponse && new Float32Array(historyFrames * 2);

  function write(role, sample, left, right, a, b, t, channels) {
    if (foreground(role)) {
      if (sample < start) return;
      const stem = role === 'dialogue' ? dialogue : foley, at = (sample - start) * 2;
      stem[at] += left;
      stem[at + 1] += right;
      return;
    }
    const from = a?.fieldDirection;
    const mid = (left + right) * .5;
    if (room && from && sample >= historyStart) {
      const at = (sample - historyStart) * 2;
      room[at] += mid;
      room[at + 1] += mid;
    }
    if (sample < start) return;
    const at = (sample - start) * 4;
    field[at] += mid;
    if (from) {
      const to = b?.fieldDirection ?? from;
      const y = from[0] + (to[0] - from[0]) * t;
      const z = from[1] + (to[1] - from[1]) * t;
      const x = from[2] + (to[2] - from[2]) * t;
      const length = Math.hypot(y, z, x);
      if (length > 1e-9) {
        const scale = mid / length;
        field[at + 1] += scale * y;
        field[at + 2] += scale * z;
        field[at + 3] += scale * x;
      }
    } else if (channels > 1) {
      field[at + 1] += (left - right) * .5 * spread;
      field[at + 3] += mid * spread;
    }
  }

  function finish(resolve, statistics) {
    let reverb;
    if (room) {
      const output = new Float32Array(frames * 2);
      reverb = addRoomResponse(roomResponse, resolve, room, output, sampleRate, historyStart, start);
      for (let i = 0; i < frames; i++) field[i * 4] += (output[i * 2] + output[i * 2 + 1]) * .5;
    }
    let peak = 0, directionalPeak = 0;
    for (let i = 0; i < field.length; i += 4) {
      peak = Math.max(peak, Math.abs(field[i]), Math.abs(field[i + 1]), Math.abs(field[i + 2]), Math.abs(field[i + 3]));
      directionalPeak = Math.max(directionalPeak, Math.hypot(field[i + 1], field[i + 2], field[i + 3]));
    }
    function samplePeak(samples) {
      let maximum = 0;
      for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
      return maximum;
    }
    const peaks = { field: peak, dialogue: samplePeak(dialogue), foley: samplePeak(foley), directionalMagnitude: directionalPeak };
    const headroom = 1 / Math.max(1, ...Object.values(peaks));
    const waves = {}, files = {};
    for (const [role, samples, channels] of [['field', field, 4], ['dialogue', dialogue, 2], ['foley', foley, 2]]) {
      if (headroom < 1) for (let i = 0; i < samples.length; i++) samples[i] *= headroom;
      const name = filenames[role];
      files[role] = { file: name + '.wav', channels };
      waves[folder + '/' + name] = WAV.encode({ samples, channels, sampleRate }, {
        encoding: 'pcm24', bwf: { description: role === 'field' ? 'Ink Studio FOA ACN SN3D W Y Z X' : 'Ink Studio pre-pan ' + name,
          timeReference: start }
      });
    }
    return { waves, manifest: { format: 'ink-studio/ambisonic-ambience', version: 1,
      sampleRate, firstSample: start, endSample: end, frames, encoding: 'pcm24',
      soundfield: { order: 1, channelOrdering: 'ACN', normalization: 'SN3D', channels: channelOrder, sceneAxes: axes,
        origin: 'listener-position', orientation: 'scene-fixed', stereoBedAzimuthDegrees: [45, -45], lateRoom: 'W' },
      files, peaks, headroom, roles: Object.fromEntries(Object.entries(statistics).map(([role, row])=>
        [role, { voices: row.voices, reflections: row.reflections ?? 0 }])), ...(reverb && { roomResponse: reverb })
    } };
  }

  return { write, finish, foreground, roomHistory: role => room && environment(role) ? historyStart : undefined };
}

function render(voices, resolve, options) {
  const output = writer(options);
  const classified = voices.flatMap(voice => {
    const stem = sceneRole(voice);
    if (!roles.includes(stem)) return [];
    return [{ ...voice, stem, ...(foreground(stem) && { reflections: undefined }) }];
  });
  const { roomResponse: _roomResponse, ...dry } = options;
  const { statistics } = sumVoices(classified, resolve, { ...dry, field: output }, roles);
  return output.finish(resolve, statistics);
}

module.exports = { direction, folder, render };
