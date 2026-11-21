const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const WAV = require('../../cli/wav.js');

const width=320, height=180, fps=12, count=72, sampleRate=48000;

function renderFrame(frame, buffer) {
  const time=frame/fps, points=[
    [86+51*Math.sin(.92*time),76+35*Math.cos(1.18*time),17,[.88,.44,.27]],
    [224+37*Math.sin(time*1.04+.9),92+44*Math.cos(time*.85),20,[.32,.80,.67]],
    [153+20*Math.sin(1.46*time+1.6),127+23*Math.cos(1.36*time),12,[.43,.67,.92]]
  ];
  const pulse=.76+.24*Math.sin(time*Math.PI*4)**2;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const i=(y*width+x)*4, u=x/width, v=y/height;
    const grid=x%24===0||y%24===0 ? .016 : 0;
    const wave=.5+.5*Math.sin(x*.037 + y*.066 + time*.65 + 2*Math.sin(x*.018-time*.4));
    let red=.035+.016*wave+grid, green=.061+.045*wave+grid, blue=.09+.065*(1-v)+grid;
    for (const [cx,cy,radius,color] of points) {
      const dx=x-cx, dy=y-cy;
      const distance=Math.hypot(dx,dy)/radius;
      if (distance>3) continue;
      const bloom=.25*Math.exp(-(distance**2)*.8);
      const shell=(distance<1 ? .72+.19*Math.sin(dx*.41+time*5)*Math.cos(dy*.31) : 0)*pulse;
      const ring=distance<1 && distance>.81 ? .21 : 0;
      red+=color[0]*(bloom+shell+ring);
      green+=color[1]*(bloom+shell+ring);
      blue+=color[2]*(bloom+shell+ring);
    }
    const vignette=1-.44*((u-.5)**2+(v-.5)**2);
    buffer[i]=Math.min(255,Math.round(red*255*vignette));
    buffer[i+1]=Math.min(255,Math.round(green*255*vignette));
    buffer[i+2]=Math.min(255,Math.round(blue*255*vignette));
    buffer[i+3]=255;
  }
}

function track() {
  const samples=new Float32Array(sampleRate*count/fps);
  let phase=0;
  for (let i=0;i<samples.length;i++) {
    const t=i/sampleRate, beat=t%.5, note=[58,72,57,66][Math.floor(t*2)%4];
    phase+=2*Math.PI*(note+28*Math.exp(-beat*22))/sampleRate;
    const attack=1-Math.exp(-beat*135), bass=.77*attack*Math.exp(-beat*7.4)*Math.sin(phase);
    const chord=.075*(Math.sin(t*293.66*Math.PI*2)+.5*Math.sin(t*440*Math.PI*2));
    samples[i]=bass+chord;
  }
  return WAV.encode({ sampleRate, channels:1, samples });
}

const link=(node,port='value')=>({node,port});
const add=(id,op,inputs={})=>({op:'add',id,node:{op,inputs}});
function initial(shader) {
  const ops=[
    add('camera','patch.video'),add('sound','patch.audio'),
    add('spectrum','audio.fft',{source:link('sound'),options:{fps,size:2048,bands:{bass:[45,145]}}}),
    add('bass','patch.band',{bands:link('spectrum','bands'),name:'bass'}),
    add('tracking','patch.track',{source:link('camera'),options:{channel:'luma',threshold:93,minArea:45,maxRegions:8}}),
    add('markings','patch.overlay',{source:link('camera'),tracks:link('tracking'),options:{color:'#f9ebca'}}),
    add('trails','patch.trail',{source:link('markings','ink'),length:.17}),
    add('mix','patch.composite',{source:link('camera'),layer:link('trails')}),
    shader
      ? add('finish','patch.shader',{source:link('mix'),amount:link('bass'),wgsl:shader})
      : add('finish','fx.compositeVideo',{source:link('mix'),options:{lumaBandwidth:.9,chromaBandwidth:.56,artifacts:.32}}),
    {op:'wire',from:'finish:value',to:'$picture'},
    {op:'wire',from:'tracking:value',to:'$tracks'},
    {op:'wire',from:'spectrum:bands',to:'$bands'}
  ];
  return ops;
}
function main(directory, executable='ffmpeg') {
  if (!directory) throw new Error('Usage: node examples/patch-tooling/demo.cjs <new-output-dir> [ffmpeg]');
  const out=path.resolve(directory);
  fs.mkdirSync(out,{recursive:false});
  const wave=path.join(out,'pulse.wav'), video=path.join(out,'night-current-input.mp4');
  fs.writeFileSync(wave,track());
  const pixels=Buffer.alloc(width*height*4*count), stride=width*height*4;
  for (let frame=0;frame<count;frame++) renderFrame(frame,pixels.subarray(frame*stride,(frame+1)*stride));
  execFileSync(executable,['-nostdin','-loglevel','error','-f','rawvideo','-pixel_format','rgba',
    '-video_size',width+'x'+height,'-framerate',String(fps),'-i','pipe:0','-i',wave,
    '-c:v','libx264','-pix_fmt','yuv420p','-crf','15','-c:a','aac','-shortest','-movflags','+faststart',video],{input:pixels});
  const shader=fs.readFileSync(path.join(__dirname,'ripple.wgsl'),'utf8');
  fs.writeFileSync(path.join(out,'ripple.wgsl'),shader);
  const entry=path.resolve(__dirname,'../../cli/ink-studio.js');
  const cli=(...args)=>execFileSync(process.execPath,[entry,'patch',...args],{cwd:out,stdio:['ignore','pipe','inherit']});
  for (const [name,code] of [['night-current',null],['night-current-wgsl',shader]]) {
    const file=name+'.json', changes=name+'-edits.json';
    fs.writeFileSync(path.join(out,changes),JSON.stringify(initial(code),null,2)+'\n');
    cli('init',file);
    cli('apply',file,changes);
    cli('bind',file,'bass:value','trails:length','--id','sustain','--from','.04,.65','--to','.075,.64');
    fs.writeFileSync(path.join(out,name+'.dot'),cli('plan',file,'--dot'));
  }
  process.stdout.write('Wrote Night Current input, two graph projects, edit journals and DOT wiring to '+out+'\n');
}

try { main(process.argv[2],process.argv[3]); }
catch (error) { console.error(error.message); process.exitCode=1; }
