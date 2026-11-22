/* Load the catalog, edit, print and WAV sources used by playable sample recipes. */
const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {isSoundRecipe,readSoundRecipe}=require('./sound-source.js');
const {readAudioPrint}=require('./audio-print.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const text=value=>typeof value==='string' && value.trim().length>0;

function openEdit(file,library,tool) {
  const edit=tool.validate(read(file)), found=library.get(edit.source.id);
  if (found.entry.asset!==edit.source.asset) throw new RangeError('Sample edit source hash does not match the library');
  return edit;
}

function resolveSampleAssets(entries,file,library,kit,{allowWav=false}={}) {
  const P=kit.KIT.procedural,{fields,id,integer,check}=P.musicInstruments;
  const {sampleEdit}=P.mediaGraph;
  const waves=new Map(), recipes=new Map();
  const buffers=new Map(), prints=new Map(), assets={}, sources={};
  let samples=0, originalSamples=0;
  function readSample(name) {
    if (!buffers.has(name)) {
      const source=library.load(name);
      originalSamples+=source.value.samples.length;
      check(originalSamples<=32000000,'Sample recipe exceeds its original PCM budget');
      buffers.set(name,source);
    }
    return buffers.get(name);
  }
  for (const [name,ref] of Object.entries(entries)) {
    check(id(name),'Invalid sample source name');
    if (isSoundRecipe(ref)) {
      const filename=path.resolve(path.dirname(file),ref);
      if (!recipes.has(filename)) recipes.set(filename,readSoundRecipe(filename,P));
      const {value,recipe}=recipes.get(filename);
      assets[name]=value;
      sources[name]={path:ref,recipe};
      samples+=value.samples.length;
      check(samples<=32000000,'Sample recipe exceeds its source PCM budget');
      continue;
    }
    if (allowWav && (typeof ref==='string' || fields(ref,['wav','fromSample','toSample','sha256']) && text(ref.wav))) {
      const row=typeof ref==='string' ? {wav:ref} : ref, filePath=path.resolve(path.dirname(file),row.wav);
      check(row.sha256===undefined || typeof row.sha256==='string' && /^[a-f0-9]{64}$/.test(row.sha256),
        'A WAV hash must be a SHA-256 digest');
      const key=filePath+'\0'+(row.sha256 ?? '');
      if (!waves.has(key)) {
        const pcm=WAV.read(filePath,{sha256:row.sha256});
        originalSamples+=pcm.samples.length;
        check(originalSamples<=32000000,'Sample recipe exceeds its original PCM budget');
        waves.set(key,pcm);
      }
      const pcm=waves.get(key), frames=pcm.samples.length/pcm.channels;
      const {fromSample=0,toSample=frames}=row;
      check(integer(fromSample,0,frames-1) && integer(toSample,fromSample+1,frames),'Invalid WAV slice range');
      assets[name]={...pcm,samples:pcm.samples.subarray(fromSample*pcm.channels,toSample*pcm.channels)};
      sources[name]={wav:row.wav,fromSample,toSample,...(row.sha256!==undefined && {sha256:row.sha256})};
      samples+=assets[name].samples.length;
      check(samples<=32000000,'Sample recipe exceeds its source PCM budget');
      continue;
    }
    check(fields(ref,['sample','asset']) && id(ref.sample) ||
      fields(ref,['edit','slice']) && text(ref.edit) && (ref.slice===undefined || id(ref.slice)) ||
      fields(ref,['print','take','slice']) && text(ref.print) && (ref.slice===undefined || id(ref.slice)),
    'Use a catalog sample, sound recipe, sample edit or printed take for '+name);
    if (ref.print!==undefined) {
      const filePath=path.resolve(path.dirname(file),ref.print);
      if (!prints.has(filePath)) prints.set(filePath,readAudioPrint(filePath,kit));
      const {entry,value}=prints.get(filePath).load(ref.take,ref.slice);
      assets[name]=value;
      sources[name]={id:entry.id,asset:entry.asset,print:ref.print,take:entry.print.take,
        ...(ref.slice!==undefined && {slice:ref.slice})};
    } else if (ref.edit!==undefined) {
      check(library,'Sample edits require a sample library');
      const edit=openEdit(path.resolve(path.dirname(file),ref.edit),library,sampleEdit);
      const {value}=readSample(edit.source.id);
      assets[name]=sampleEdit.render(value,edit,ref.slice===undefined ? {} : {slice:ref.slice}).value;
      sources[name]={id:edit.source.id,asset:edit.source.asset,...ref};
    } else {
      check(library,'Catalog sample references require a sample library');
      const {value,entry}=readSample(ref.sample);
      check(ref.asset===undefined || entry.asset===ref.asset,'Kit sample hash does not match the library');
      assets[name]=value;
      sources[name]={id:entry.id,asset:entry.asset};
    }
    samples+=assets[name].samples.length;
    check(samples<=32000000,'Sample recipe exceeds its source PCM budget');
  }
  return {assets,sources};
}
module.exports={openEdit,resolveSampleAssets};
