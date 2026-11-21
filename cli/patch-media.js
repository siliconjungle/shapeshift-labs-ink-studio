const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WAV = require('./wav.js');

function localFile(input) {
  const file = path.resolve(input);
  if (!fs.statSync(file).isFile()) throw new TypeError('Expected a local media file: ' + input);
  return file;
}

function ffmpeg(executable, arguments_, signal) {
  const child = spawn(executable, ['-nostdin','-hide_banner','-loglevel','error',...arguments_], {
    stdio:['ignore','pipe','pipe'], signal
  });
  let diagnostics = '', cause;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', part => { diagnostics = (diagnostics + part).slice(-8000); });
  child.on('error', error => { cause = error; });
  const done = new Promise(resolve => child.once('close', (code, signal) => resolve({code,signal})));
  return { stream:child.stdout, async finish() {
    const {code,signal}=await done;
    if (cause || code!==0)
      throw new Error('FFmpeg failed: ' + (cause?.message || diagnostics.trim() || signal || String(code)));
  }, async stop() {
    if (child.exitCode===null && child.signalCode===null) child.kill();
    await done;
  } };
}

async function* splitFrames(stream, width, height) {
  const size=width*height*4;
  let data=new Uint8Array(size), filled=0;
  for await (const chunk of stream) {
    for (let offset=0;offset<chunk.length;) {
      const count=Math.min(size-filled,chunk.length-offset);
      data.set(chunk.subarray(offset,offset+count),filled);
      filled+=count; offset+=count;
      if (filled===size) {
        yield {width,height,channels:4,data};
        data=new Uint8Array(size); filled=0;
      }
    }
  }
  if (filled) throw new Error('Video ended with a partial RGBA frame');
}

async function* videoFrames(input, {width,height,rate,executable='ffmpeg',stream=process.stdin,signal}) {
  if (input==='-') {
    signal?.throwIfAborted();
    const stop=()=>stream.destroy(signal.reason);
    signal?.addEventListener('abort',stop,{once:true});
    try { yield* splitFrames(stream,width,height); }
    finally { signal?.removeEventListener('abort',stop); }
    return;
  }
  const file=localFile(input);
  const process=ffmpeg(executable, ['-protocol_whitelist','file,pipe','-i',file,'-map','0:v:0',
    '-an','-vf','fps='+rate+',scale='+width+':'+height+':flags=lanczos','-pix_fmt','rgba','-f','rawvideo','pipe:1'],signal);
  try {
    yield* splitFrames(process.stream,width,height);
    await process.finish();
  } finally { await process.stop(); }
}

async function audioSource(input, {video,executable='ffmpeg',duration,signal}) {
  if (input!=='video') return WAV.read(localFile(input));
  if (!video || video==='-') throw new TypeError('--audio video needs a local video file');
  const file=localFile(video), sampleRate=48000, channels=2;
  const maxBytes=Math.min(WAV.maxSamples*4, Math.ceil(duration*sampleRate)*channels*4+8192);
  const process=ffmpeg(executable, ['-protocol_whitelist','file,pipe','-i',file,'-map','0:a:0','-vn',
    '-t',duration.toFixed(6),'-ar',String(sampleRate),'-ac',String(channels),'-f','f32le','pipe:1'],signal);
  const pieces=[];
  let bytes=0;
  try {
    for await (const chunk of process.stream) {
      bytes+=chunk.length;
      if (bytes>maxBytes) throw new RangeError('Patch audio exceeds the sample budget');
      pieces.push(chunk);
    }
    await process.finish();
  } finally { await process.stop(); }
  if (bytes===0 || bytes%(4*channels)) throw new Error('No complete audio samples in video');
  const raw=Buffer.concat(pieces,bytes), samples=new Float32Array(bytes/4);
  for (let i=0;i<samples.length;i++) {
    const value=raw.readFloatLE(i*4);
    if (!Number.isFinite(value)) throw new Error('Non-finite audio sample from video');
    samples[i]=Math.max(-1,Math.min(1,value));
  }
  return {sampleRate,channels,samples};
}
module.exports={videoFrames,audioSource};
