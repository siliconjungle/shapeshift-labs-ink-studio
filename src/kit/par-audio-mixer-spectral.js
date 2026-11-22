/* Block convolution and frozen STFT frames on the mixer sample grid. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check,db}=P.musicInstruments;
  const tau=2*Math.PI, wrap=phase=>phase-tau*Math.round(phase/tau);
  const pair=size=>({re:new Float64Array(size),im:new Float64Array(size)});
  function convolution(raw,rate,time,asset) {
    check(fields(raw,['type','wet','impulse','fromSample','toSample','reverse','preDelayMs','gainDb','rateCompensate']),
      'Unknown convolution parameter');
    const pcm=asset(raw.impulse), total=pcm.samples.length/pcm.channels;
    const {fromSample=0,toSample=total,reverse=false,preDelayMs=0,rateCompensate=false}=raw, step=pcm.sampleRate/rate;
    check(integer(fromSample,0,total-1) && integer(toSample,fromSample+1,total) &&
      typeof reverse==='boolean' && typeof rateCompensate==='boolean' && finite(preDelayMs,0,1000) && finite(step,1/128,16),
    'Invalid impulse slice, predelay or resampling ratio');
    const frames=Math.ceil((toSample-fromSample)/step), delay=Math.round(preDelayMs*rate/1000);
    check(integer(frames,1,Math.min(rate*8,262144)),'Convolution impulse exceeds eight seconds or its PCM budget');
    const size=Math.min(65536,2**Math.ceil(Math.log2(Math.max(64,frames*2))));
    const hop=size/2, partitions=Math.ceil(frames/hop), gain=time.lane(raw.gainDb,0,-48,18,'convolution gain');
    const resampler=S.pcmReader(pcm,fromSample,toSample,step);
    function block(input,output) {
      const transform=S.fftSetup({sampleRate:rate},{size,window:'rect'},size,1).transform;
      const sample=[0,0], impulse=[new Float64Array(frames),new Float64Array(frames)];
      for (let i=0;i<frames;i++) {
        resampler.read(fromSample+i*step,sample);
        const at=reverse ? frames-1-i : i;
        impulse[0][at]=sample[0]; impulse[1][at]=sample[1];
      }
      const inputFrames=input.length/2, end=Math.min(output.length/2,inputFrames+frames-1+delay);
      for (let ch=0;ch<2;ch++) {
        const kernels=Array.from({length:partitions},(_,part)=>{
          const row=pair(size);
          row.re.set(impulse[ch].subarray(part*hop,(part+1)*hop));
          transform(row.re,row.im,0,1,-1);
          return row;
        });
        const history=Array.from({length:partitions},()=>pair(size)), sum=pair(size);
        for (let at=0,block=0;at+delay<end;at+=hop,block++) {
          const next=history[block%partitions];
          next.re.fill(0); next.im.fill(0);
          for (let i=0;i<hop && i+at<inputFrames;i++) next.re[i]=input[2*(i+at)+ch];
          transform(next.re,next.im,0,1,-1);
          sum.re.fill(0); sum.im.fill(0);
          for (let part=0;part<partitions && part<=block;part++) {
            const source=history[(block-part)%partitions], kernel=kernels[part];
            for (let bin=0;bin<size;bin++) {
              const a=source.re[bin], b=source.im[bin], c=kernel.re[bin], d=kernel.im[bin];
              sum.re[bin]+=a*c-b*d; sum.im[bin]+=a*d+b*c;
            }
          }
          transform(sum.re,sum.im,0,1,1);
          for (let i=0;i<size && i+at+delay<end;i++) output[2*(i+at+delay)+ch]+=sum.re[i]/size;
        }
      }
      const trim=gain.reader(), amplitude=rateCompensate ? step : 1;
      for (let i=0;i<end;i++) {
        const scale=amplitude*db(trim(i));
        output[2*i]*=scale; output[2*i+1]*=scale;
      }
      return {impulse:raw.impulse,impulseFrames:frames,predelayFrames:delay,fftSize:size,partitions,...(rateCompensate && {rateCompensation:step})};
    }
    return {tail:frames-1+delay,cost:3*Math.log2(size)+8*partitions,block};
  }
  function freeze(raw,rate,time) {
    check(fields(raw,['type','wet','at','until','length','size','fadeMs']) &&
      (raw.until===undefined || raw.length===undefined),'Invalid spectral freeze settings');
    const {size=2048,fadeMs=35}=raw;
    check(integer(size,256,8192) && !(size&(size-1)) && finite(fadeMs,0,500),'Invalid freeze FFT size or crossfade');
    const when=time.position(raw.at ?? {samples:0}), at=time.frame(when);
    const end=time.frame(raw.until===undefined ? time.offset(when,raw.length ?? {seconds:1}) : time.position(raw.until));
    check(integer(at,0,rate*3600) && integer(end,at+1,Math.min(rate*3600,at+30*rate)),
      'Freeze needs a positive hold of up to thirty seconds');
    const half=size/2,hop=size/4, bins=half+1, fade=Math.min(Math.round(fadeMs*rate/1000),(end-at)/2);
    function block(input,output) {
      output.set(input.subarray(0,output.length));
      const last=Math.min(end,output.length/2);
      if (last<=at || at>=input.length/2+half) return {captureSample:at,releaseSample:end,synthesizedFrames:0};
      const {weights,transform}=S.fftSetup({sampleRate:rate},{size},size,2);
      const captured=Array.from({length:2},(_,ch)=>{
        const now=pair(size), previous=pair(size), angle=new Float64Array(bins),
          advance=new Float64Array(bins), magnitude=new Float64Array(bins);
        for (let i=0;i<size;i++) {
          const j=at-half+i;
          now.re[i]=(input[2*j+ch] ?? 0)*weights[i];
          previous.re[i]=(input[2*(j-hop)+ch] ?? 0)*weights[i];
        }
        transform(now.re,now.im,0,1,-1);
        transform(previous.re,previous.im,0,1,-1);
        for (let k=0;k<bins;k++) {
          const expected=tau*k*hop/size;
          angle[k]=Math.atan2(now.im[k],now.re[k]);
          advance[k]=expected+wrap(angle[k]-Math.atan2(previous.im[k],previous.re[k])-expected);
          magnitude[k]=Math.hypot(now.re[k],now.im[k]);
        }
        return {angle,advance,magnitude};
      });
      const frequency=Float64Array.from({length:bins},(_,i)=>{
        const ref=captured[0].magnitude[i]>=captured[1].magnitude[i] ? captured[0] : captured[1];
        return ref.advance[i];
      });
      const frozen=new Float64Array(2*(last-at)), weight=new Float64Array(last-at), spectrum=pair(size);
      for (let step=-half/hop;at+step*hop<last+half;step++) {
        const begin=at+step*hop-half, first=Math.max(0,at-begin), stop=Math.min(size,last-begin);
        for (let i=first;i<stop;i++) weight[begin+i-at]+=weights[i]**2;
        for (let ch=0;ch<2;ch++) {
          const {angle,magnitude}=captured[ch];
          for (let k=0;k<bins;k++) {
            const phase=angle[k]+step*frequency[k];
            spectrum.re[k]=Math.cos(phase)*magnitude[k];
            spectrum.im[k]=k===0 || k===half ? 0 : Math.sin(phase)*magnitude[k];
            if (k>0 && k<half) {
              spectrum.re[size-k]=spectrum.re[k]; spectrum.im[size-k]=-spectrum.im[k];
            }
          }
          transform(spectrum.re,spectrum.im,0,1,1);
          for (let i=first;i<stop;i++) frozen[2*(begin+i-at)+ch]+=spectrum.re[i]*weights[i]/size;
        }
      }
      for (let i=at;i<last;i++) {
        const u=fade ? Math.min(1,(i-at)/fade,(end-i-1)/fade) : 1;
        for (let ch=0;ch<2;ch++) {
          const index=2*i+ch, base=output[index], held=frozen[2*(i-at)+ch]/Math.max(1e-12,weight[i-at]);
          output[index]=base+(held-base)*u;
        }
      }
      return {captureSample:at,releaseSample:end,synthesizedFrames:last-at,fftSize:size};
    }
    return {latency:half,tail:end-at,planEnd:inputEnd=>at<inputEnd+half ? Math.max(inputEnd,end) : inputEnd,
      cost:8+4*Math.log2(size),extra:3,block};
  }
  S.soundConvolution=convolution;
  S.spectralFreeze=freeze;
})(KIT.procedural);
