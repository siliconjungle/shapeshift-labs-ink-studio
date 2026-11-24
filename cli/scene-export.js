const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { json } = require('./asset-files.js');
const { resize } = require('./render.js');
const Replay = require('./scene-replay.js');
const Join = require('./loop-join.js');
const Compatibility = require('./scene-compatibility.js');

const products = ['still', 'loop', 'replay', 'embed'];

function pictureClock(T, fps, from, to, exact) {
  const rate = T.read(fps), step = T.div(T.read(1), rate), speed = T.seconds(rate);
  const startPoint = T.read(from), limit = T.read(to);
  const point = index => T.add(startPoint, T.mul(T.read(index), step));
  const intervals = T.mul(T.sub(startPoint, limit), rate);
  const count = Math.max(1, exact ? -T.index(T.roundDown(intervals)) : Math.ceil((to - from) * speed - 1e-9));
  const frameRate = { numerator: T.index(rate[0]), denominator: T.index(rate[1]) };
  return { fps: speed, frameRate, count, startPoint, endPoint: point(count), duration: T.seconds(T.mul(T.read(count), step)),
    point, seconds: index => exact ? T.seconds(point(index)) : from + index / speed };
}

function exportScene(createCapture, { out, formats = products, width = 640, height = 360, fps = 12, from = 0, to,
  stillScale = 2, stillTime = from, embed, loopJoin = false, audio, mux, kit } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Scene export needs an output directory');
  if (!Array.isArray(formats) || !formats.length || Array.from(formats).some(format => !products.includes(format)))
    throw new RangeError('Choose scene export formats from ' + products.join(', '));
  const selected = new Set(formats);
  const still = selected.has('still'), sequence = Boolean(audio) || [...selected].some(format => format !== 'still');
  if (audio !== undefined && typeof audio?.render !== 'function' || mux !== undefined && (!audio || typeof mux !== 'function'))
    throw new TypeError('A scene mux needs a soundtrack and a codec adapter');
  const keepRecording = selected.has('replay') || selected.has('embed');
  if (typeof loopJoin !== 'boolean' || loopJoin && !sequence)
    throw new TypeError('Loop join inspection needs a moving export');
  const T = (kit ?? require('../index.js').load()).KIT.procedural.takeTime;
  const speed = T.seconds(T.read(fps));
  const exact = audio !== undefined || typeof fps === 'object';
  const stillWidth = width * stillScale, stillHeight = height * stillScale;
  if (!Replay.dimensions(width, height) || still && !Replay.dimensions(stillWidth, stillHeight) ||
      still && (!Number.isFinite(stillTime) || !Number.isFinite(stillScale) || stillScale < 1) ||
      sequence && (!(speed >= 1 && speed <= 120) || !Number.isFinite(from) || audio && from < 0 ||
        to !== undefined && (!Number.isFinite(to) || to <= from)))
    throw new RangeError('Invalid scene export resolution, time range or rate');
  if (selected.has('embed')) Replay.embedSettings(embed);

  const directory = path.resolve(out);
  fs.mkdirSync(directory, { recursive: true });
  const take = fs.mkdtempSync(path.join(directory, 'take-')), prefix = path.basename(take);
  function save(name, bytes) {
    const absolute = path.join(take, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    return prefix + '/' + name;
  }
  const manifest = { format: 'ink-studio/scene-export', version: 1 };
  const compatibility = Compatibility.collect();
  let inputs, captured = false;
  function capture(dimensions, moving) {
    const result = createCapture({ ...dimensions, moving, from });
    manifest.scene ??= result.scene;
    manifest.title ??= result.title ?? result.scene ?? 'Ink Studio scene';
    let document;
    if (result.simulationInputs !== undefined) {
      if (typeof result.scene !== 'string' || !Number.isSafeInteger(result.seed))
        throw new TypeError('Seeded scene tracks need a scene ID and integer seed');
      document = { format: 'ink-studio/scene-simulation-inputs', version: 1, scene: result.scene,
        seed: result.seed, simulationInputs: result.simulationInputs };
    }
    if (captured && JSON.stringify(document) !== JSON.stringify(inputs))
      throw new RangeError('Scene simulation inputs differed between captures');
    inputs = document;
    captured = true;
    return result;
  }
  try {
    if (sequence) {
      const source = capture({ width, height }, true);
      const end = to ?? (source.duration > from ? source.duration : from + 2);
      const picture = pictureClock(T, fps, from, end, exact), { count, frameRate } = picture;
      if (!Number.isSafeInteger(count) || count > Replay.maxFrames || count * width * height > Replay.maxPixels)
        throw new RangeError('Scene export exceeds the sequence budget. Shorten the range or lower the resolution or frame rate.');
      const packed = [], frames = [], files = [], videoFrames = [];
      const lastTime = picture.seconds(count - 1);
      if (selected.has('loop')) PNG.animationDelay(frameRate);
      const sound = audio?.render(picture, { timeline: source.timeline, runtime: source.runtime });
      let videoBytes = 0;
      const extra = inputs ? Buffer.byteLength(JSON.stringify(inputs)) : 0;
      let encodedLength = extra, first, penultimate, last;
      for (let index = 0; index < count; index++) {
        const time = picture.seconds(index);
        const sampled = source.sample(time, lastTime, { index, point: picture.point(index), frameRate });
        compatibility.sequence(sampled.compatibility, time, index);
        const image = resize(sampled, width, height);
        if (loopJoin) {
          if (index === 0) first = Join.capture(image);
          if (index === count - 2) penultimate = index === 0 ? first : Join.capture(image);
          if (index === count - 1) last = index === 0 ? first : Join.capture(image);
        }
        const frame = PNG.packFrame(image);
        if (selected.has('loop')) packed.push(frame);
        const png = PNG.encodeFrame(frame);
        if (mux) {
          videoBytes += png.length;
          if (videoBytes > Replay.maxReplayBytes) throw new RangeError('Scene video frames exceed the mux byte budget');
          videoFrames.push(png);
        }
        if (selected.has('loop')) {
          const name = 'frames/frame-' + String(index).padStart(6, '0') + '.png';
          files.push({ time, file: save(name, png) });
        }
        if (keepRecording) {
          const data = png.toString('base64');
          encodedLength += data.length + 5;
          if (encodedLength > Replay.maxReplayBytes - 4096) throw new RangeError('Scene replay exceeds the file size budget');
          frames.push(data);
        }
      }
      const timing = typeof fps === 'object' || !Number.isInteger(speed) ? { frameRate } : {};
      manifest.sequence = { width, height, start: from, fps: speed, ...timing, frameCount: count, duration: picture.duration };
      if (sound) {
        const { waves, report } = sound, { stems, ...mix } = report;
        manifest.audio = { ...mix, mix: save('audio/mix.wav', waves.mix), stems: Object.fromEntries(
          Object.entries(stems).map(([name, details]) => [name, { ...details, file: save('audio/' + name + '.wav', waves[name]) }])
        ) };
        if (mux) {
          const video = mux({ frames: videoFrames, width, height, fps: frameRate, audio: waves.mix, sampleRate: report.sampleRate });
          if (!/^[a-z0-9]{1,16}$/i.test(video?.extension ?? '') || !(video.bytes instanceof Uint8Array) || !video.bytes.length)
            throw new TypeError('Scene video codec needs a safe extension and encoded bytes');
          manifest.video = { file: save('review.' + video.extension, video.bytes), audio: manifest.audio.mix };
        }
      }
      if (loopJoin) {
        const endpoint = resize(source.sample(picture.seconds(count), lastTime, { index: count, point: picture.endPoint, frameRate }), width, height);
        const { report, image } = Join.inspect({ first, penultimate, last, endpoint, from, fps: speed, count });
        manifest.loopJoin = { image: save('loop-join.png', PNG.encode(image.w, image.h, image.rgb)),
          report: save('loop-join.json', JSON.stringify(report, null, 2) + '\n') };
      }
      if (selected.has('loop')) {
        manifest.loop = { file: save('loop.png', PNG.encodeAnimation(packed, frameRate)), frames: files };
      }
      if (keepRecording) {
        const document = { format: Replay.format, version: 1, scene: manifest.scene, title: manifest.title,
          width, height, start: from, fps: speed, ...timing, frames,
          ...(inputs && { seed: inputs.seed, simulationInputs: inputs.simulationInputs }) };
        if (selected.has('replay')) manifest.replay = save('scene.replay.json', JSON.stringify(document) + '\n');
        if (selected.has('embed')) manifest.embed = save('embed.html', Replay.embedPage(document, Replay.embedSettings(embed, document.title)));
      }
    }
    if (still) {
      const source = capture({ width: stillWidth, height: stillHeight }, false);
      const sampled = source.sample(stillTime);
      compatibility.still(sampled.compatibility, stillTime);
      const frame = resize(sampled, stillWidth, stillHeight);
      manifest.still = { file: save('still.png', PNG.encodeFrame(PNG.packFrame(frame))), time: stillTime,
        width: stillWidth, height: stillHeight };
    }
    if (inputs) manifest.simulationInputs = save('simulation-inputs.json', JSON.stringify(inputs, null, 2) + '\n');
    const review = compatibility.report();
    if (review) manifest.compatibility = review;
    const file = path.join(directory, 'export.json');
    json(file, manifest);
    return { file, manifest };
  } catch (error) {
    fs.rmSync(take, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { exportScene };
