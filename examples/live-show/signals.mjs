import { timecodeAt } from '../../show-control.mjs';

export function makeLoop(context, part) {
  const rate = context.sampleRate, length = rate * 8;
  const buffer = context.createBuffer(1, length, rate), output = buffer.getChannelData(0);
  let seed = 2026;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2147483648) - 1;
  const notes = [55, 55, 65.4, 49, 55, 73.4, 65.4, 49];
  for (let i = 0; i < length; i++) {
    const t = i / rate, beat = t * 2, eighth = t * 4, onset = t % .5, hat = t % .25, kick = Math.floor(beat) % 4 !== 3;
    if (part === 'pulse') output[i] = (kick ? .78 * Math.sin(2 * Math.PI * (48 * onset + 4 * (1 - Math.exp(-onset * 28)))) * Math.exp(-onset * 21) : 0) +
      (Math.floor(eighth) % 2 ? .11 : .05) * noise() * Math.exp(-hat * 38);
    else {
      const f = notes[Math.floor(beat / 2) % notes.length], envelope = (1 - Math.exp(-onset * 65)) * Math.exp(-onset * 5);
      output[i] = envelope * (.36 * Math.sin(2 * Math.PI * f * t) +
        .18 * Math.sin(2 * Math.PI * f * 3 * t) + .10 * Math.sin(2 * Math.PI * f * 5 * t));
    }
  }
  return buffer;
}

export function makeLtcLoop(context, fps) {
  const rate = context.sampleRate, drop = fps === 30000 / 1001;
  const bitLength = rate / (fps * 80), frames = Math.round(fps) * 4;
  const buffer = context.createBuffer(1, Math.round(frames * 80 * bitLength), rate), output = buffer.getChannelData(0);
  let polarity = -1, previous = 0;
  for (let f = 0; f < frames; f++) {
    const code = timecodeAt(Math.round(fps) * 60 * 60 - (drop ? 108 : 0) + f, { fps, drop });
    const bits = new Uint8Array(80);
    function write(offset, n, width) {
      for (let i = 0; i < width; i++) bits[offset + i] = (n >> i) & 1;
    }
    for (const [i, value] of [code.frames, code.seconds, code.minutes, code.hours].entries()) {
      write(16 * i, value % 10, 4);
      write(16 * i + 8, Math.floor(value / 10), i % 3 === 0 ? 2 : 3);
    }
    bits[10] = Number(drop);
    for (let i = 0; i < 16; i++) bits[64 + i] = (0x3ffd >> (15 - i)) & 1;
    for (let b = 0; b < 80; b++) {
      const end = Math.round((f * 80 + b + 1) * bitLength);
      polarity *= -1;
      if (bits[b]) {
        const mid = Math.round((f * 80 + b + .5) * bitLength);
        output.fill(.7 * polarity, previous, mid);
        polarity *= -1;
        previous = mid;
      }
      output.fill(.7 * polarity, previous, end);
      previous = end;
    }
  }
  return buffer;
}

export function paintSignal(canvas, time, phase, bass, cue) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const hues = [[233, 181, 301], [19, 44, 345], [273, 320, 186]][cue];
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, `hsl(${hues[0]} 58% 15%)`);
  gradient.addColorStop(.58, '#0d0b17');
  gradient.addColorStop(1, `hsl(${hues[2]} 48% 14%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  const beat = (1 - Math.min(1, phase)) ** 7 * .35 + bass * .85;
  ctx.lineWidth = 1;
  for (let lane = 0; lane < 65; lane++) {
    const y = lane / 64 * h, proximity = Math.sin(lane / 64 * Math.PI);
    const intensity = Math.sin(lane * .47 - time * .7) ** 2;
    ctx.strokeStyle = `hsla(${hues[lane % 3] + intensity * 30} 86% ${45 + 30 * intensity}% / ${.2 + .6 * proximity})`;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 5) {
      const u = x / w, twist = Math.sin(u * 12 + lane * .125 + time * .7);
      const bow = Math.sin(u * 7.3 - lane * .08 - time * .66);
      const py = y + proximity * ((32 + beat * 72) * twist * bow + Math.sin(u * 18 + time * .8) * 9);
      if (x === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#efdfc7';
  for (let i = 0; i < 28; i++) {
    const x = ((i * 83 + time * 8) % w), y = ((i * i * 179) % h);
    ctx.globalAlpha = .23 + .5 * Math.sin(i * 3 + time) ** 2;
    ctx.fillRect(x, y, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
}
