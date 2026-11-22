const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { parseRate, parseSize } = require('./patch-media.js');
const { encodeOsc } = require('./show-protocols.js');

const loopback = '127.0.0.1';
const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const name = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function record(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || keys && Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('Invalid ' + label);
  return value;
}

function sources(value, directory, frames) {
  const { video, audio, videoTimeoutMs = 1000 } = value;
  function media(file, special) {
    if (file === undefined || file === special) return file;
    if (typeof file !== 'string' || !file) throw new TypeError('Show media needs a local file path');
    return path.resolve(directory, file);
  }
  if (!int(videoTimeoutMs, 50, 60000)) throw new RangeError('Show videoTimeoutMs must be 50–60000');
  if (audio === 'video' && (!video || video === '-' || frames === Infinity))
    throw new TypeError('Show audio from video needs a local video file and a finite frame count');
  return { video: media(video, '-'), audio: media(audio, 'video'), videoTimeoutMs };
}

function oscInput(value) {
  if (value === undefined) return;
  const { port = 9102, host = loopback, address = '/ink/preset', idleMs } =
    record(value, ['port', 'host', 'address', 'idleMs'], 'show OSC input');
  if (!int(port, 0, 65535) || !net.isIPv4(host) || idleMs !== undefined && !int(idleMs, 50, 3600000))
    throw new RangeError('Show OSC needs an IPv4 host, valid port and optional idleMs from 50–3600000');
  encodeOsc(address);
  return { port, host, address, idleMs };
}

function midiInput(value, presets) {
  if (value === undefined) return;
  const { input, channel = 1, notes = {}, programs = {} } = record(value, ['input', 'channel', 'notes', 'programs'], 'show MIDI input');
  function validateMap(mapping) {
    for (const [number, preset] of Object.entries(record(mapping, null, 'MIDI preset map')))
      if (!/^(0|[1-9]\d{0,2})$/.test(number) || !int(Number(number), 0, 127) || !name(preset) || !Object.hasOwn(presets, preset))
        throw new RangeError('MIDI maps need numbers 0–127 and known presets');
  }
  if (!int(channel, 1, 16) || input !== undefined && (typeof input !== 'string' || !input || input.length > 255))
    throw new TypeError('Show MIDI needs a channel from 1–16 and optional input name');
  validateMap(notes);
  validateMap(programs);
  return { input, channel, notes, programs };
}

async function readShow(file, rehearse, kit) {
  if (fs.statSync(file).size > 1024 * 1024) throw new RangeError('Show cue file exceeds 1 MiB');
  const config = record(JSON.parse(fs.readFileSync(file, 'utf8')), ['format', 'version', 'patch', 'output', 'size', 'fps',
    'frames', 'video', 'audio', 'videoTimeoutMs', 'inputs', 'presets', 'initial', 'cues', 'cueMap', 'projector', 'osc', 'midi', 'slowMs'], 'patch show cue file');
  const { patch, output, size, fps: rate = '30', frames = rehearse ? 120 : Infinity,
    inputs = {}, presets = {}, initial, cues = [], projector = {}, slowMs } = config;
  if (config.format !== 'ink-studio/patch-show' || config.version !== 1 || typeof patch !== 'string' || !patch || !name(output))
    throw new TypeError('Expected ink-studio/patch-show version 1 with a patch file and named output');
  if (!['string', 'number'].includes(typeof rate) || size !== undefined && typeof size !== 'string')
    throw new TypeError('Show needs a frame rate and a WIDTHxHEIGHT size');
  const fps = parseRate(rate), dimensions = parseSize(size);
  if (frames !== Infinity && !int(frames, 1, 36000) || slowMs !== undefined && (!Number.isFinite(slowMs) || slowMs <= 0 || slowMs > 60000))
    throw new RangeError('Show needs 1–36000 frames and an optional slowMs threshold in (0, 60000]');
  record(inputs, null, 'base show inputs');
  record(presets, null, 'show presets');
  for (const [preset, overrides] of Object.entries(presets)) {
    if (!name(preset)) throw new TypeError('Invalid show preset name');
    record(overrides, null, 'inputs for show preset ' + preset);
  }
  if (initial !== undefined && (!name(initial) || !Object.hasOwn(presets, initial))) throw new TypeError('Unknown initial show preset');
  if (!Array.isArray(cues) || cues.length > 4096) throw new TypeError('Show needs up to 4096 ordered cues');
  let previous = -1;
  for (const cue of cues) {
    const { frame, preset } = record(cue, ['frame', 'preset'], 'show cue');
    if (!int(frame, previous + 1, frames - 1) || !name(preset) || !Object.hasOwn(presets, preset))
      throw new RangeError('Show cues need increasing in-range frames and known presets');
    previous = frame;
  }
  const directory = path.dirname(path.resolve(file));
  let cueSource, scheduled=cues;
  if(config.cueMap!==undefined) {
    if(typeof config.cueMap!=='string'||!config.cueMap.trim()||
      path.isAbsolute(config.cueMap)||path.win32.isAbsolute(config.cueMap))
      throw new TypeError('Show cueMap needs a relative clock map report path');
    cueSource=path.resolve(directory,config.cueMap);
    const {KIT:K}=kit??require('../index.js').load();
    const report=JSON.parse(fs.readFileSync(cueSource,'utf8'));
    const mapped=K.world.clockMapping.read(report);
    if(mapped.clock.at(0).fps!==fps||report.issues.length)
      throw new RangeError('Show cue map needs the show frame rate and resolved cue addresses');
    scheduled=cues.concat(mapped.cues.map(cue=>({frame:cue.at.showFrame,preset:cue.preset,clockCue:cue})))
      .sort((a,b)=>a.frame-b.frame);
    if(scheduled.length>4096||scheduled.some((cue,i)=>!int(cue.frame,0,frames-1)||
      (i>0&&cue.frame===scheduled[i-1].frame)||!Object.hasOwn(presets,cue.preset)))
      throw new RangeError('Mapped show cues need distinct in-range frames and known presets');
  }
  const { port = 0, wait = !rehearse, surfaces = [] } = record(projector, ['port', 'wait', 'surfaces'], 'show projector');
  if (!int(port, 0, 65535) || typeof wait !== 'boolean' || !Array.isArray(surfaces) || surfaces.length > 32)
    throw new TypeError('Show projector needs a valid port, wait flag and up to 32 surfaces');
  const mapping = surfaces.map(surface => ({ ...record(surface, ['id', 'corners', 'crop', 'edges', 'gain', 'gamma'],
    'show projection surface'), source: 'picture' }));
  const { prepareProjectionSurfaces } = await import('../src/show/projection.mjs');
  prepareProjectionSurfaces(mapping);
  return { patch: path.resolve(directory, patch), output, rate, fps, frames, dimensions, inputs, presets, initial, cues:scheduled,cueSource,
    ...sources(config, directory, frames), projector: { port, wait, surfaces: mapping }, slowMs: slowMs ?? 1000 / fps,
    osc: oscInput(config.osc), midi: midiInput(config.midi, presets) };
}

module.exports = { readShow, int, loopback };
