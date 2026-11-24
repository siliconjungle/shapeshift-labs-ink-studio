const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decode } = require('./audio-round-trip-decode.js');
const WAV = require('./wav.js');
const Assets = require('./asset-files.js');

const fps = 120, sampleRate = 48000, duration = 5.5;
const flashFrames = [120, 232, 362, 522];
const flashLength = 15;

function media(executable, args, maxBuffer) {
  try {
    return execFileSync(executable, args, { maxBuffer, timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error('Calibration media failed. ' + (error.stderr?.toString().trim() || error.message));
  }
}

function timeBase(value) {
  const ratio = /^([1-9]\d{0,9})\/([1-9]\d{0,9})$/.exec(value);
  if (!ratio) throw new RangeError('Calibration tracks need valid presentation time bases');
  return Number(ratio[1]) / Number(ratio[2]);
}

async function recording(file, region, { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' } = {}) {
  const input = ['-protocol_whitelist', 'file,pipe'];
  const { format, streams, frames } = JSON.parse(media(ffprobe, ['-v', 'error', ...input,
    '-select_streams', 'v:0', '-show_format', '-show_streams', '-show_frames', '-show_entries',
    'format=duration:stream=width,height,time_base:stream_side_data=rotation:stream_disposition=attached_pic:frame=best_effort_timestamp,width,height',
    '-of', 'json', file], 4 * 1024 * 1024));
  const video = streams?.[0], span = Number(format?.duration);
  if (!(span >= 4.5 && span <= 20) || !video || video.disposition?.attached_pic ||
      !Array.isArray(frames) || frames.length < 16 || frames.length > 5000 ||
      !Number.isInteger(video.width) || !Number.isInteger(video.height) ||
      video.width < 8 || video.height < 8 || video.width * video.height > 8500000)
    throw new RangeError('Use a 4.5–20 second camera clip with an ordinary video track up to 8.5 MP');
  const tick = timeBase(video.time_base);
  const times = frames.map((frame, i) => {
    if (!Number.isSafeInteger(frame.best_effort_timestamp) || frame.width !== video.width || frame.height !== video.height ||
        (i > 0 && frame.best_effort_timestamp <= frames[i - 1].best_effort_timestamp))
      throw new RangeError('Camera video needs increasing frame timestamps and fixed dimensions');
    return frame.best_effort_timestamp * tick;
  });
  const turn = video.side_data_list?.find(row => row.rotation !== undefined)?.rotation ?? 0;
  if (!Number.isInteger(turn) || turn % 90 !== 0) throw new RangeError('Camera orientation must use a multiple of 90 degrees');
  const [width, height] = turn % 180 ? [video.height, video.width] : [video.width, video.height];
  const [x, y, w, h] = region;
  const crop = [Math.floor(x * width), Math.floor(y * height),
    Math.floor((x + w) * width), Math.floor((y + h) * height)];
  const [left, top, right, bottom] = crop;
  if (right - left < 4 || bottom - top < 4) throw new RangeError('The flash region must cover at least 4×4 camera pixels');
  const filter = 'crop=' + [right - left, bottom - top, left, top].join(':') +
    ':exact=1,scale=1:1:flags=area,format=gray';
  const luma = media(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', ...input, '-i', file, '-map', '0:v:0',
    '-an', '-sn', '-dn', '-vf', filter, '-fps_mode', 'passthrough', '-c:v', 'rawvideo', '-threads', '1',
    '-f', 'rawvideo', 'pipe:1'], 128 * 1024);
  if (luma.length !== times.length) throw new Error('Decoded flash samples do not match the video timestamps');
  const audio = await decode(file, 0, { leading: 0, trailing: 0 }, { ffmpeg, ffprobe });
  const audioStart = audio.info.firstPts * timeBase(audio.info.timeBase);
  const origin = Math.min(times[0], audioStart);
  return { audio, audioAt: audioStart - origin,
    picture: times.map((time, frame) => ({ frame, time: time - origin, luma: luma[frame] })),
    metadata: { originSeconds: origin, videoTimeBase: video.time_base, audioTimeBase: audio.info.timeBase,
      audioStartSeconds: audioStart - origin, videoStartSeconds: times[0] - origin,
      sampleRate: audio.sampleRate, regionPixels: [left, top, right - left, bottom - top] } };
}

function stimulus(destination, { pictureDelayMs = 0, audioDelayMs = 0 } = {}, ffmpeg = 'ffmpeg') {
  const videoDelay = Math.round(pictureDelayMs * fps / 1000);
  const audioDelay = Math.round(audioDelayMs * sampleRate / 1000);
  const seconds = duration + Math.max(videoDelay / fps, audioDelay / sampleRate);
  const clickTrack = new Float32Array(Math.ceil(seconds * sampleRate));
  for (const frame of flashFrames) {
    const start = frame * sampleRate / fps + audioDelay;
    for (let i = 0; i < sampleRate * .014; i++) {
      const time = i / sampleRate;
      clickTrack[start + i] = .32 * Math.cos(2 * Math.PI * 1600 * time) * Math.exp(-time / .0035) *
        Math.min(1, (sampleRate * .014 - i) / 96);
    }
  }
  const enabled = flashFrames.map(frame => {
    const at = frame + videoDelay;
    return 'between(n,' + at + ',' + (at + flashLength - 1) + ')';
  }).join('+');
  const filter = 'drawbox=x=75:y=55:w=490:h=250:color=0x283846:t=2,' +
    "drawbox=x=88:y=68:w=464:h=224:color=0xe1e2db:t=fill:enable='" + enabled + "'";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-output-latency-'));
  try {
    const wav = path.join(dir, 'click.wav'), mp4 = path.join(dir, 'pattern.mp4');
    fs.writeFileSync(wav, WAV.encode({ sampleRate, channels: 1, samples: clickTrack }, { encoding: 'pcm24' }));
    media(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
      'color=0x111821:s=640x360:r=' + fps + ':d=' + seconds, '-i', wav, '-vf', filter,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', mp4], 128 * 1024);
    Assets.write(destination, fs.readFileSync(mp4));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { pictureDelayMs: videoDelay * 1000 / fps, audioDelayMs: audioDelay * 1000 / sampleRate };
}

module.exports = { recording, stimulus, fps, flashFrames };
