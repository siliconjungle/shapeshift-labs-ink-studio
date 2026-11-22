/* Aligned Broadcast Wave print and decoded-stem recombination evidence. */
const WAV=require('./wav.js');
function print(P,session,assets,stage,{prefix='',allowUnresolved=false}={}) {
  const {audioEditorial,postProduction}=P.mediaGraph, T=P.takeTime;
  const result=audioEditorial.render(session,assets,{stems:true,allowUnresolved});
  const {sampleRate,picture}=session;
  const timeReference=T.create({fps:picture.fps,sampleRate}).at(picture.startFrame ?? 0).firstSample;
  function encode(name,pcm) {
    const file=prefix+name+'.wav';
    const bytes=WAV.encode(pcm,{encoding:'pcm24',bwf:{description:'Ink editorial '+name,timeReference}});
    stage.save(file,bytes);
    return {file,pcm:WAV.decode(bytes,{metadata:true})};
  }
  const mix=encode('mix',result.value);
  const rows=Object.entries(result.stems).map(([track,value])=>[track,encode('stems/'+track,value)]);
  const reference=String(timeReference), tracks=Object.fromEntries(rows.map(([name,row])=>[name,row.pcm]));
  if ([mix.pcm,...Object.values(tracks)].some(value=>value.bwf.timeReference!==reference))
    throw new Error('Printed stem time references differ');
  const evidence=postProduction.verify(mix.pcm,tracks);
  const bound=(rows.length+1)/8388608;
  if (evidence.maxError>bound) throw new Error('Printed stems failed their recombination check');
  return {mix:mix.file,stems:Object.fromEntries(rows.map(([name,row])=>[name,row.file])),
    placement:result.report,verification:{...evidence,timeReference:reference,quantizationBound:bound}};
}
module.exports={print};
